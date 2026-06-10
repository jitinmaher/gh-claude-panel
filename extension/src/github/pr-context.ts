import { GITHUB_HOSTS, PR_URL_RE, SELECTORS } from "./selectors";

export interface PRContext {
  url: string;
  /** Hostname — "github.com" or whatever GHE host the page is on. */
  host: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  files: { path: string; diff: string }[];
  /** Total characters across all collected diffs (for budget warnings). */
  totalDiffChars: number;
}

export function isPRPage(url: string = location.href): boolean {
  return PR_URL_RE.test(url);
}

/**
 * Extract the diff text from one of GitHub's `.file` containers. Works
 * on both the live document and a parsed Document.
 *
 * Each output line is prefixed with the post-image line number (the
 * "RIGHT" side) so the model has a real coordinate to reference. Format:
 *
 *   @@ hunk header @@
 *   42  context line
 *   43- old line
 *      + new line  (added lines get the line number too)
 *
 * For added lines we emit the right-side number; for deleted lines, the
 * left-side. Context lines show the right-side. The 5-char zero-padded
 * gutter keeps things scannable for the model and the human.
 *
 * GitHub's DOM stores numbers on adjacent <td class="blob-num"> cells:
 *   - Unified view: two blob-num cells per row, first = LEFT, second = RIGHT
 *   - Split view: same structure but the cells live in separate <tr>s
 * The data-line-number attribute is the source of truth either way.
 */
function collectDiffLines(fileEl: HTMLElement): string {
  const rows = fileEl.querySelectorAll<HTMLTableRowElement>(SELECTORS.fileDiffRows);
  if (rows.length === 0) return "";
  const out: string[] = [];
  rows.forEach((row) => {
    const cls = row.className;
    if (cls.includes("blob-expanded") || cls.includes("js-expandable-line")) return;

    // Hunk header rows (the "@@ -10,7 +10,9 @@ …" line) sit alone in a
    // single <td colspan> and have no blob-code-addition/deletion class.
    if (cls.includes("js-expandable-line") || cls.includes("hunk-header")) return;
    const hunkCell = row.querySelector("td.blob-num-hunk, td.blob-code-hunk");
    if (hunkCell) {
      const text = (hunkCell.textContent ?? "").trim();
      if (text) out.push(text);
      return;
    }

    let prefix = " ";
    if (cls.includes("blob-code-deletion")) prefix = "-";
    else if (cls.includes("blob-code-addition")) prefix = "+";

    const numCells = row.querySelectorAll<HTMLTableCellElement>("td.blob-num");
    // First num cell = LEFT, second = RIGHT (unified view convention).
    const leftN = numCells[0]?.getAttribute("data-line-number") ?? "";
    const rightN = numCells[1]?.getAttribute("data-line-number") ?? leftN;
    const lineNum = prefix === "-" ? leftN : rightN;
    const gutter = lineNum ? lineNum.padStart(5, " ") : "     ";

    const codeCell = row.querySelector("td.blob-code, td.blob-code-inner");
    if (!codeCell) return;
    const text = (codeCell.textContent ?? "").replace(/\n+/g, "");
    out.push(`${gutter} ${prefix}${text}`);
  });
  return out.join("\n");
}

export function parsePRUrl(url: string = location.href):
  | { host: string; owner: string; repo: string; number: number }
  | null {
  const hostGroup = GITHUB_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|");
  const re = new RegExp(
    `^https:\\/\\/(${hostGroup})\\/([^/]+)\\/([^/]+)\\/pull\\/(\\d+)`,
  );
  const m = url.match(re);
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3], number: Number(m[4]) };
}

/**
 * Synchronous DOM scrape. Works on the Files Changed tab where each file's
 * diff is rendered. On other tabs (Conversation, Commits) the diff DOM isn't
 * present, so this returns 0 files — callers should fall back to
 * extractPRContextWithDiffFetch().
 */
export function extractPRContext(): PRContext | null {
  const parsed = parsePRUrl();
  if (!parsed) return null;

  const title =
    document.querySelector(SELECTORS.prTitle)?.textContent?.trim() ?? "(no title)";
  const author =
    document.querySelector(SELECTORS.prAuthor)?.textContent?.trim() ?? "(unknown)";

  const files: PRContext["files"] = [];
  let totalDiffChars = 0;

  const fileEls = document.querySelectorAll<HTMLElement>(SELECTORS.fileDiff);
  fileEls.forEach((el) => {
    const path =
      el.querySelector(SELECTORS.fileDiffPath)?.textContent?.trim() ??
      el.getAttribute("data-tagsearch-path") ??
      "(unknown path)";
    const diff = collectDiffLines(el);
    if (diff) {
      files.push({ path, diff });
      totalDiffChars += diff.length;
    }
  });

  return {
    url: location.href,
    host: parsed.host,
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    title,
    author,
    files,
    totalDiffChars,
  };
}

/**
 * Async wrapper that ensures we get the diff regardless of which PR tab
 * the user is on or which DOM viewer GitHub has rolled out.
 *
 * GitHub has been migrating PR pages to a new diff viewer at
 * /pull/N/changes (replacing /pull/N/files) that renders the diff in
 * React, with a different DOM structure than the classic .file containers
 * our selectors were written for. To stay viewer-agnostic, we:
 *
 *   1. Try the live DOM with both classic and new-viewer selectors.
 *   2. If 0 files, fetch <pr-url>.diff (raw unified diff text). This
 *      endpoint redirects to patch-diff.githubusercontent.com — content
 *      scripts running in the github.com origin can follow that redirect
 *      because they inherit page-origin cookies and CORS context for
 *      same-site responses. The extension-iframe origin can't, which is
 *      why we route through the content script.
 *   3. As a last resort, fetch the /files HTML page and re-scrape it.
 *
 * Order: live DOM (fastest) → .diff text (most reliable, raw bytes) →
 * /files HTML (legacy fallback).
 */
export async function extractPRContextWithDiffFetch(): Promise<PRContext | null> {
  const base = extractPRContext();
  if (!base) return null;
  if (base.files.length > 0) return base;

  // Try the raw .diff endpoint first — same-origin, parser-friendly, and
  // doesn't depend on which DOM viewer GitHub is shipping this week.
  const diffResult = await fetchUnifiedDiff(base.url);
  if (diffResult && diffResult.files.length > 0) {
    return { ...base, files: diffResult.files, totalDiffChars: diffResult.totalDiffChars };
  }

  // Fallback: scrape the /files HTML.
  const filesUrl = buildFilesUrl(base.url);
  try {
    const resp = await fetch(filesUrl, { credentials: "include" });
    if (!resp.ok) return base;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const { files, totalDiffChars } = scrapeFilesFromDoc(doc);
    if (files.length === 0) return base;
    return { ...base, files, totalDiffChars };
  } catch {
    return base;
  }
}

/**
 * Fetch GitHub's raw unified-diff for the PR and parse it into per-file
 * blocks. Each file is annotated with the post-image line numbers in the
 * gutter, matching the format collectDiffLines() produces, so the model
 * sees a consistent layout regardless of which path produced it.
 */
async function fetchUnifiedDiff(
  prUrl: string,
): Promise<{ files: { path: string; diff: string }[]; totalDiffChars: number } | null> {
  const diffUrl = prUrl
    .split("#")[0]
    .split("?")[0]
    .replace(/\/(files|changes|commits|checks)(\/.*)?$/, "") + ".diff";
  try {
    const resp = await fetch(diffUrl, { credentials: "include" });
    if (!resp.ok) return null;
    const text = await resp.text();
    const files = parseUnifiedDiffWithLineNumbers(text);
    const totalDiffChars = files.reduce((n, f) => n + f.diff.length, 0);
    return { files, totalDiffChars };
  } catch {
    return null;
  }
}

/**
 * Parse a raw unified diff (`git format-patch` style) and emit one entry
 * per file, with lines prefixed by post-image line number — same shape
 * collectDiffLines() produces from the DOM.
 *
 * Tracks left/right line counters per hunk so:
 *   - context (' '): right number
 *   - addition ('+'): right number
 *   - deletion ('-'): left number
 *
 * Hunk headers (`@@ -L,n +R,m @@`) re-seed the counters.
 */
function parseUnifiedDiffWithLineNumbers(text: string): { path: string; diff: string }[] {
  const out: { path: string; diff: string }[] = [];
  const blocks = text.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n");
    const header = lines[0] ?? "";
    const m = header.match(/ b\/(.+)$/);
    const path = m ? m[1] : "(unknown)";

    let leftLine = 0;
    let rightLine = 0;
    const out_lines: string[] = [];

    for (const raw of lines) {
      const hunk = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (hunk) {
        leftLine = parseInt(hunk[1], 10);
        rightLine = parseInt(hunk[2], 10);
        out_lines.push(raw);
        continue;
      }
      // Skip headers we don't want to render line-numbered: file mode,
      // ---/+++ markers, index hashes, "Binary files differ", etc.
      if (
        raw.startsWith("index ") ||
        raw.startsWith("--- ") ||
        raw.startsWith("+++ ") ||
        raw.startsWith("new file mode") ||
        raw.startsWith("deleted file mode") ||
        raw.startsWith("similarity index") ||
        raw.startsWith("rename from") ||
        raw.startsWith("rename to") ||
        raw.startsWith("Binary files") ||
        raw.startsWith("\\ No newline")
      ) {
        continue;
      }
      if (raw.startsWith("+")) {
        out_lines.push(`${String(rightLine).padStart(5, " ")} +${raw.slice(1)}`);
        rightLine++;
      } else if (raw.startsWith("-")) {
        out_lines.push(`${String(leftLine).padStart(5, " ")} -${raw.slice(1)}`);
        leftLine++;
      } else if (raw.startsWith(" ")) {
        out_lines.push(`${String(rightLine).padStart(5, " ")}  ${raw.slice(1)}`);
        leftLine++;
        rightLine++;
      }
      // else: blank or unknown line — drop
    }
    out.push({ path, diff: out_lines.join("\n") });
  }
  return out;
}

function buildFilesUrl(prUrl: string): string {
  const cleaned = prUrl
    .split("#")[0]
    .split("?")[0]
    .replace(/\/(files|changes|commits|checks)(\/.*)?$/, "");
  return `${cleaned}/files`;
}

function scrapeFilesFromDoc(doc: Document): {
  files: { path: string; diff: string }[];
  totalDiffChars: number;
} {
  const files: { path: string; diff: string }[] = [];
  let totalDiffChars = 0;
  const fileEls = doc.querySelectorAll<HTMLElement>(SELECTORS.fileDiff);
  fileEls.forEach((el) => {
    const path =
      el.querySelector(SELECTORS.fileDiffPath)?.textContent?.trim() ??
      el.getAttribute("data-tagsearch-path") ??
      "(unknown path)";
    const diff = collectDiffLines(el);
    if (diff) {
      files.push({ path, diff });
      totalDiffChars += diff.length;
    }
  });
  return { files, totalDiffChars };
}


/**
 * Compose context blocks suitable for handing to a model. Truncates per-file
 * when the total budget is exceeded so we don't blow the context window.
 */
export function buildContextBlocks(
  ctx: PRContext,
  maxChars = 60_000,
): { label: string; body: string }[] {
  const header =
    `PR #${ctx.number} in ${ctx.owner}/${ctx.repo} (${ctx.host})\n` +
    `Title: ${ctx.title}\n` +
    `Author: ${ctx.author}\n` +
    `URL: ${ctx.url}\n` +
    `Files changed: ${ctx.files.length}`;

  const blocks: { label: string; body: string }[] = [
    { label: "PR metadata", body: header },
  ];

  let remaining = maxChars;
  for (const f of ctx.files) {
    if (remaining <= 0) {
      blocks.push({
        label: "(truncated)",
        body: `${ctx.files.length - blocks.length + 1} more files omitted — diff exceeded ${maxChars} chars.`,
      });
      break;
    }
    const body = f.diff.length > remaining ? f.diff.slice(0, remaining) + "\n... (truncated)" : f.diff;
    blocks.push({ label: `Diff: ${f.path}`, body });
    remaining -= body.length;
  }
  return blocks;
}
