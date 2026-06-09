/**
 * DOM-driven insertion of a finding as a GitHub inline review comment.
 *
 * Why DOM and not the REST API: posting via API requires the user's OAuth
 * token. The DOM approach uses the user's existing GitHub session, leaves
 * them in control of when comments actually go live (we click "Start a
 * review", which queues a draft — user submits the batch themselves),
 * and works on both github.com and GHE.
 *
 * GitHub's diff DOM (Files Changed tab):
 *   <tr class="diff-table">
 *     <td data-line-number="42" data-side="RIGHT" class="blob-num">42</td>
 *     <td class="blob-code blob-code-addition">…code…</td>
 *   </tr>
 *
 * Each cell has an "Add a line comment" button (the +) that on click
 * opens a form with a textarea and a "Start a review" submit button.
 *
 * Selectors are brittle by nature — GitHub changes them occasionally.
 * Keep all DOM queries here so we have a single place to update.
 */

export interface InsertRequest {
  file: string;
  line: number;
  side: "LEFT" | "RIGHT";
  text: string;
}

export type InsertResult =
  | { ok: true }
  | { ok: false; reason: string };

const FILES_PATH_RE = /\/pull\/\d+\/files(\/.*)?$/;

export async function insertFindingComment(req: InsertRequest): Promise<InsertResult> {
  // 1. Make sure we're on the Files Changed tab.
  if (!FILES_PATH_RE.test(location.pathname)) {
    const navigated = await navigateToFilesTab();
    if (!navigated) return { ok: false, reason: "could not open Files Changed tab" };
  }

  // 2. Locate the file's diff container.
  const fileContainer = await waitFor(() => findFileContainer(req.file), 4000);
  if (!fileContainer) {
    return { ok: false, reason: `file ${req.file} not in this PR's diff` };
  }

  // 3. Find the target line's <td class="blob-num">.
  const numCell = findLineNumCell(fileContainer, req.line, req.side);
  if (!numCell) {
    return {
      ok: false,
      reason: `line ${req.line} (${req.side}) not in the diff for ${req.file}`,
    };
  }

  // 4. Scroll into view so GitHub's hover handlers attach (some
  //    builds gate the + button on visibility).
  numCell.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  await sleep(150);

  // 5. Click the + button.
  const addBtn = findAddCommentButton(numCell);
  if (!addBtn) return { ok: false, reason: "could not find the + button on that line" };
  addBtn.click();

  // 6. Wait for the inline comment form's textarea to mount.
  const textarea = await waitFor(
    () => findOpenCommentTextarea(numCell.closest("tr")),
    3000,
  );
  if (!textarea) return { ok: false, reason: "comment box didn't open" };

  // 7. Set the value React-style and dispatch input so GitHub's form state updates.
  setReactInputValue(textarea, req.text);
  await sleep(50);

  // 8. Click "Start a review" if available (queues a draft). If only
  //    "Add single comment" is present (no review in progress yet, and
  //    Start-a-review hasn't appeared), prefer Start-a-review.
  const submitBtn = findStartReviewButton(textarea);
  if (!submitBtn) {
    return {
      ok: false,
      reason: "comment text inserted, but 'Start a review' button not found — submit manually",
    };
  }
  submitBtn.click();
  return { ok: true };
}

/** Same-origin navigation that triggers GitHub's Turbo router. */
async function navigateToFilesTab(): Promise<boolean> {
  // The "Files changed" tab is a regular <a>; clicking it is friendlier
  // to Turbo than location.assign.
  const tab = document.querySelector<HTMLAnchorElement>(
    'a[data-tab-item="files_bucket"], a#files_tab, a.tabnav-tab[href$="/files"]',
  );
  if (tab) {
    tab.click();
    // Wait for the URL to update.
    return waitFor(() => FILES_PATH_RE.test(location.pathname), 4000) as Promise<boolean>;
  }
  // Fallback: hard navigate.
  const m = location.pathname.match(/^(\/[^/]+\/[^/]+\/pull\/\d+)/);
  if (!m) return false;
  location.assign(m[1] + "/files");
  return false; // hard nav blows away this script; the user will need to retry.
}

function findFileContainer(path: string): HTMLElement | null {
  // GitHub stores the path on `data-tagsearch-path` (classic) and as
  // text inside the file header. Match either, exact path preferred.
  const all = document.querySelectorAll<HTMLElement>(
    "div.file[data-tagsearch-path], copilot-diff-entry",
  );
  for (const el of Array.from(all)) {
    const attr = el.getAttribute("data-tagsearch-path");
    if (attr === path) return el;
    const linkText = el.querySelector(".file-info a.Link--primary")?.textContent?.trim();
    if (linkText === path) return el;
  }
  // Fallback: case-insensitive contains
  for (const el of Array.from(all)) {
    const attr = el.getAttribute("data-tagsearch-path") ?? "";
    if (attr.toLowerCase() === path.toLowerCase()) return el;
  }
  return null;
}

function findLineNumCell(
  container: HTMLElement,
  line: number,
  side: "LEFT" | "RIGHT",
): HTMLTableCellElement | null {
  // GitHub renders each line as <td class="blob-num blob-num-addition"
  //   data-line-number="42"> in unified view. In split view there are
  // two blob-num cells per row, one with data-side="LEFT" and one
  // data-side="RIGHT".
  const exact = container.querySelector<HTMLTableCellElement>(
    `td.blob-num[data-line-number="${line}"][data-side="${side}"]`,
  );
  if (exact) return exact;
  // Unified view: no data-side; just match line number on the appropriate
  // class (additions on the right, deletions on the left).
  const cls = side === "LEFT" ? "blob-num-deletion" : "blob-num-addition";
  const unified = container.querySelector<HTMLTableCellElement>(
    `td.blob-num.${cls}[data-line-number="${line}"]`,
  );
  if (unified) return unified;
  // Last resort: any cell with that line number.
  return container.querySelector<HTMLTableCellElement>(
    `td.blob-num[data-line-number="${line}"]`,
  );
}

function findAddCommentButton(numCell: HTMLTableCellElement): HTMLElement | null {
  // GitHub puts the add-comment trigger on the line number cell itself
  // (or as a child button). Try a few known selectors.
  const candidates = [
    'button.add-line-comment',
    'button[aria-label*="comment"i]',
    'button[data-original-title*="comment"i]',
    'a.add-line-comment',
  ];
  for (const sel of candidates) {
    const btn = numCell.querySelector<HTMLElement>(sel);
    if (btn) return btn;
  }
  // Some builds attach a button as a sibling.
  const row = numCell.closest("tr");
  if (row) {
    for (const sel of candidates) {
      const btn = row.querySelector<HTMLElement>(sel);
      if (btn) return btn;
    }
  }
  return null;
}

function findOpenCommentTextarea(row: Element | null): HTMLTextAreaElement | null {
  if (!row) return null;
  // After clicking +, GitHub inserts an inline form *after* the row.
  // Scan a few following siblings for the textarea.
  let probe: Element | null = row.nextElementSibling;
  for (let i = 0; i < 6 && probe; i++) {
    const ta = probe.querySelector<HTMLTextAreaElement>(
      'textarea[name="comment[body]"], textarea[name="pull_request_review[body]"], textarea.js-comment-field',
    );
    if (ta) return ta;
    probe = probe.nextElementSibling;
  }
  return null;
}

function findStartReviewButton(textarea: HTMLTextAreaElement): HTMLButtonElement | null {
  const form = textarea.closest("form");
  if (!form) return null;
  // GitHub renders one of: "Start a review" / "Add review comment" /
  // "Add single comment". Prefer the review-starting one.
  const buttons = form.querySelectorAll<HTMLButtonElement>("button");
  let single: HTMLButtonElement | null = null;
  for (const b of Array.from(buttons)) {
    const txt = (b.textContent ?? "").trim().toLowerCase();
    if (txt.includes("start a review") || txt.includes("add review comment")) {
      return b;
    }
    if (txt.includes("add single comment")) {
      single = b;
    }
  }
  return single;
}

/**
 * React-controlled inputs (which GitHub uses in some views) ignore raw
 * value assignments. Use the native setter and dispatch an input event
 * to make sure GitHub's form state updates.
 */
function setReactInputValue(el: HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ──────── tiny utilities ──────── */

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function waitFor<T>(
  fn: () => T | null | false,
  timeoutMs: number,
): Promise<T | null> {
  const start = Date.now();
  let delay = 50;
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (v) return v as T;
    await sleep(delay);
    delay = Math.min(delay * 1.4, 300);
  }
  return null;
}
