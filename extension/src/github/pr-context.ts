import { GITHUB_HOSTS, PR_URL_RE, SELECTORS } from "./selectors";

export interface PRContext {
  url: string;
  /** Hostname — "github.com" or a GHE host like "github.intuit.com". */
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
 * on both live document and parsed Document instances.
 */
function collectDiffLines(fileEl: HTMLElement): string {
  const rows = fileEl.querySelectorAll<HTMLTableRowElement>(SELECTORS.fileDiffRows);
  if (rows.length === 0) return "";
  const lines: string[] = [];
  rows.forEach((row) => {
    const cls = row.className;
    let prefix = " ";
    if (cls.includes("blob-expanded") || cls.includes("js-expandable-line")) return;
    if (cls.includes("blob-code-deletion")) prefix = "-";
    else if (cls.includes("blob-code-addition")) prefix = "+";
    const codeCell = row.querySelector("td.blob-code, td.blob-code-inner");
    if (!codeCell) return;
    const text = (codeCell.textContent ?? "").replace(/\n+/g, "");
    lines.push(prefix + text);
  });
  return lines.join("\n");
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
 * the user is on.
 *
 * Strategy: if the current DOM has 0 files (e.g. user is on Conversation,
 * Commits, or Checks), fetch the PR's /files HTML page (same-origin,
 * uses session cookies natively — no CORS, no API tokens, no extra
 * host permissions). Parse the HTML with DOMParser and re-run our
 * normal diff selectors on the parsed document.
 *
 * Why not the .diff endpoint or /pulls/N/files API:
 *   - .diff redirects to patch-diff.githubusercontent.com which doesn't
 *     send Access-Control-Allow-Origin headers, so even SW fetches fail
 *   - The REST API requires auth for private repos and is rate-limited
 */
export async function extractPRContextWithDiffFetch(): Promise<PRContext | null> {
  const base = extractPRContext();
  if (!base) return null;
  if (base.files.length > 0) return base;

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

function buildFilesUrl(prUrl: string): string {
  const cleaned = prUrl
    .split("#")[0]
    .split("?")[0]
    .replace(/\/(files|commits|checks)(\/.*)?$/, "");
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
