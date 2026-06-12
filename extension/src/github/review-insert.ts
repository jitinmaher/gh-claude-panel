/**
 * DOM helpers for "Show in diff" — scrolling to and highlighting a line
 * in GitHub's rendered diff.
 *
 * Comment *posting* is no longer done via the DOM; it goes through the
 * REST API (see background/index.ts → postLiveComment). This module is
 * now read-only: it locates a line in the page and flashes it.
 *
 * GitHub's classic diff DOM (Files changed tab):
 *   <tr class="diff-table">
 *     <td data-line-number="42" data-side="RIGHT" class="blob-num">42</td>
 *     <td class="blob-code blob-code-addition">…code…</td>
 *   </tr>
 *
 * Selectors are brittle by nature — GitHub changes them occasionally.
 * Keep all DOM queries here so we have a single place to update.
 */

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

  // Classic viewer: find the <td class="blob-num"> inside the file's
  // diff container and flash its row.
  const fileContainer = await waitFor(() => findFileContainer(req.file), 2500);
  if (fileContainer) {
    const numCell = findLineNumCell(fileContainer, req.line, req.side);
    const row = numCell?.closest("tr");
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      flashHighlight(row as HTMLElement);
      return { ok: true };
    }
  }

  // New /changes React viewer (and a generic fallback): the classic
  // blob-num cells aren't present, but line elements still carry a
  // data-line-number attribute somewhere in the document. Find one for
  // the requested line and flash its nearest row-ish ancestor.
  const lineEl = await waitFor(() => findLineElementAnywhere(req.line, req.side), 2500);
  if (lineEl) {
    const target = (lineEl.closest("tr") as HTMLElement | null) ?? lineEl;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    flashHighlight(target);
    return { ok: true };
  }

  return { ok: false, reason: notFoundReason(`line ${req.line} not found for ${req.file}`) };
}

/**
 * Document-wide search for a diff line element carrying data-line-number.
 * Used on the new /changes viewer where there's no classic blob-num cell.
 * Best-effort: matches the line number, and prefers the requested side
 * when a data-side attribute is present.
 */
function findLineElementAnywhere(line: number, side: "LEFT" | "RIGHT"): HTMLElement | null {
  const sideMatch = document.querySelector<HTMLElement>(
    `[data-line-number="${line}"][data-side="${side}"]`,
  );
  if (sideMatch) return sideMatch;
  return document.querySelector<HTMLElement>(`[data-line-number="${line}"]`);
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
    // Highlight both the row's <td> cells (classic table viewer) and the
    // element itself (new viewer, where the target is a div, not a tr).
    style.textContent = `
      .gh-claude-flash,
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
// render the per-file diff. Either one is a valid place to preview a line.
const DIFF_VIEW_RE = /\/pull\/\d+\/(files|changes)(\/.*)?$/;

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
