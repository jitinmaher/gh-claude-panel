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

/**
 * A signal value the DOM inserter returns when the page DOM can't be
 * driven at all (the new /changes React viewer, or the file/line wasn't
 * found in the rendered diff). The caller should try the REST API path
 * instead of treating it as a hard failure.
 */
export const DOM_UNAVAILABLE = "dom-unavailable";

export interface PreviewRequest {
  file: string;
  line: number;
  side: "LEFT" | "RIGHT";
}

export type PreviewResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Scroll the matching diff row into view and flash a highlight on it.
 * Read-only — does not click any buttons or open any forms.
 */
export async function previewFindingLocation(req: PreviewRequest): Promise<PreviewResult> {
  if (!DIFF_VIEW_RE.test(location.pathname)) {
    const navigated = await navigateToDiffView();
    if (!navigated) {
      return { ok: false, reason: "open the Files changed tab, then try again" };
    }
  }

  const fileContainer = await waitFor(() => findFileContainer(req.file), 4000);
  if (!fileContainer) {
    return { ok: false, reason: `file ${req.file} not in this PR's diff` };
  }

  const numCell = findLineNumCell(fileContainer, req.line, req.side);
  if (!numCell) {
    return {
      ok: false,
      reason: notFoundReason(`line ${req.line} not found for ${req.file}`),
    };
  }

  const row = numCell.closest("tr");
  if (!row) return { ok: false, reason: notFoundReason("diff row not found") };

  // Scroll the row into view, biased toward the top third so the user
  // has some visual context above it.
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  flashHighlight(row);
  return { ok: true };
}

/**
 * Pulse a yellow highlight on a diff row. Implemented by injecting a
 * one-off <style> tag and toggling a class — avoids needing to add CSS
 * to the host page permanently.
 */
function flashHighlight(row: HTMLElement) {
  const styleId = "gh-claude-flash-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .gh-claude-flash > td {
        animation: gh-claude-flash-anim 2.2s ease-out;
      }
      @keyframes gh-claude-flash-anim {
        0%   { background-color: rgba(255, 213, 0, 0.55); }
        60%  { background-color: rgba(255, 213, 0, 0.30); }
        100% { background-color: transparent; }
      }
    `;
    document.head.appendChild(style);
  }
  row.classList.remove("gh-claude-flash"); // restart if already flashing
  // Force reflow so the animation restarts on rapid re-clicks.
  void (row as HTMLElement).offsetWidth;
  row.classList.add("gh-claude-flash");
  setTimeout(() => row.classList.remove("gh-claude-flash"), 2400);
}

// Both the classic "/files" tab and the newer "/changes" React viewer
// render the per-file diff. Either one is a valid place to insert/preview.
const DIFF_VIEW_RE = /\/pull\/\d+\/(files|changes)(\/.*)?$/;

export async function insertFindingComment(req: InsertRequest): Promise<InsertResult> {
  // 1. Make sure we're on a diff view (Files changed or Changes).
  if (!DIFF_VIEW_RE.test(location.pathname)) {
    const navigated = await navigateToDiffView();
    // Not on a diff view and couldn't switch — let the caller try the API.
    if (!navigated) return { ok: false, reason: DOM_UNAVAILABLE };
  }

  // 2. Locate the file's diff container. If the rendered DOM doesn't
  //    expose it (e.g. the new /changes React viewer), signal the caller
  //    to fall back to the REST API rather than failing outright.
  const fileContainer = await waitFor(() => findFileContainer(req.file), 4000);
  if (!fileContainer) return { ok: false, reason: DOM_UNAVAILABLE };

  // 3. Find the target line's <td class="blob-num">.
  const numCell = findLineNumCell(fileContainer, req.line, req.side);
  if (!numCell) return { ok: false, reason: DOM_UNAVAILABLE };

  // 4. Scroll into view so GitHub's hover handlers attach (some
  //    builds gate the + button on visibility).
  numCell.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  await sleep(150);

  // 5. Click the + button.
  const addBtn = findAddCommentButton(numCell);
  if (!addBtn) return { ok: false, reason: DOM_UNAVAILABLE };
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

/**
 * Switch to the diff view (Files changed / Changes) via in-page SPA
 * navigation only. Clicks the tab anchor and lets GitHub's Turbo/React
 * router swap the content without a page load.
 *
 * IMPORTANT: this NEVER does a hard navigation (location.assign). A full
 * page reload destroys the panel iframe and the user's entire chat
 * session — losing a review they may have spent real time on. If we
 * can't find a clickable tab to do an in-page switch, we return false
 * and the caller falls back to copying the comment to the clipboard.
 * A lost review is never an acceptable cost for "insert on line."
 */
async function navigateToDiffView(): Promise<boolean> {
  const tab = document.querySelector<HTMLAnchorElement>(
    [
      'a[data-tab-item="files_bucket"]',
      "a#files_tab",
      'a.tabnav-tab[href$="/files"]',
      'a[href$="/changes"]',
      'a[href*="/files"]',
      'a[href*="/changes"]',
    ].join(", "),
  );
  if (!tab) return false;
  tab.click();
  const ok = await waitFor(() => DIFF_VIEW_RE.test(location.pathname), 4000);
  return ok === true;
}

/**
 * Build a not-found reason, appending an actionable hint when we're on
 * the new React "/changes" viewer — its DOM doesn't expose the classic
 * blob-num/blob-code cells our row-finder needs, so switching to the
 * classic "Files changed" tab usually makes Insert / Show-in-diff work.
 */
function notFoundReason(base: string): string {
  if (/\/changes(\/.*)?$/.test(location.pathname)) {
    return `${base} — try the classic "Files changed" tab (the new diff view isn't supported yet)`;
  }
  return base;
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
