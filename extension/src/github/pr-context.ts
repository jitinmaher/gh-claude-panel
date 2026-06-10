import {
  STATIC_HOSTS,
  SELECTORS,
  buildPRUrlRegex,
  loadEnterpriseHosts,
} from "./selectors";

/**
 * Cached merged host list + PR-URL regex. Initialized at module load with
 * the static host (so isPRPage/parsePRUrl work synchronously from the
 * first call), then refreshed when storage finishes loading and on every
 * change. The cache is process-local — content script and SW each hold
 * their own copy and keep them in sync via chrome.storage.onChanged.
 */
let cachedHosts: string[] = [...STATIC_HOSTS];
let cachedPRRegex: RegExp = buildPRUrlRegex(cachedHosts);

function refreshHostCache(hosts: string[]): void {
  cachedHosts = hosts;
  cachedPRRegex = buildPRUrlRegex(hosts);
}

// Initial async load — async, but isPRPage/parsePRUrl already work
// against just github.com until this completes.
loadEnterpriseHosts().then((enterprise) => {
  refreshHostCache([...STATIC_HOSTS, ...enterprise]);
});

// Keep the cache fresh when the user adds or removes a host from the
// options page. Works in both content-script and SW contexts.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enterpriseHosts) return;
    const next = Array.isArray(changes.enterpriseHosts.newValue)
      ? (changes.enterpriseHosts.newValue as string[])
      : [];
    refreshHostCache([...STATIC_HOSTS, ...next]);
  });
} catch {
  /* chrome.storage may not be available in some test contexts */
}

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
  return cachedPRRegex.test(url);
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
  // The regex from buildPRUrlRegex matches up to /pull/N but doesn't
  // capture owner/repo/number — build a capturing variant from the same
  // host list every call. Cheap; happens at most once per page navigation.
  const group = cachedHosts.map((h) => h.replace(/\./g, "\\.")).join("|");
  const re = new RegExp(
    `^https:\\/\\/(${group})\\/([^/]+)\\/([^/]+)\\/pull\\/(\\d+)`,
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
 * Async wrapper that ensures we get the diff regardless of which PR
 * tab the user is on or which DOM viewer GitHub has rolled out.
 *
 * Strategy (best-effort, in order):
 *
 *   1. Live DOM scrape. Works instantly on the classic /files viewer.
 *      May also catch the new /changes viewer if its DOM matches our
 *      selectors.
 *
 *   2. GitHub REST API. Hits api.github.com/repos/.../pulls/N with
 *      `Accept: application/vnd.github.v3.diff` for raw unified diff.
 *      Works across viewers (api is decoupled from frontend). For
 *      private repos, the user must set a PAT in options. On GHE, the
 *      API lives at <host>/api/v3, no PAT needed for repos visible to
 *      the user's session — but cookies don't cross to the API origin
 *      on github.com, so a PAT is mandatory for private github.com.
 *
 *   3. /files HTML scrape. Last-resort; fetches the legacy server-
 *      rendered HTML and re-runs our selectors against the parsed doc.
 *      Useful if the user is signed-in and the API path is rate-limited.
 *
 * The `.diff` endpoint (e.g. github.com/X/Y/pull/N.diff) is NOT used:
 * it redirects to patch-diff.githubusercontent.com, which doesn't send
 * Access-Control-Allow-Origin, so the cross-origin redirect fails CORS.
 */
export async function extractPRContextWithDiffFetch(): Promise<PRContext | null> {
  const base = extractPRContext();
  if (!base) return null;
  if (base.files.length > 0) return base;

  // 2. REST API.
  const apiResult = await fetchDiffViaRestApi(base.host, base.owner, base.repo, base.number);
  if (apiResult && apiResult.files.length > 0) {
    return {
      ...base,
      files: apiResult.files,
      totalDiffChars: apiResult.totalDiffChars,
    };
  }

  // 3. /files HTML scrape.
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
 * Fetch the PR's unified diff via the GitHub REST API.
 *
 * Endpoint (github.com): `https://api.github.com/repos/{o}/{r}/pulls/{n}`
 * Endpoint (GHE):        `https://<host>/api/v3/repos/{o}/{r}/pulls/{n}`
 *
 * The `Accept: application/vnd.github.v3.diff` header switches the
 * response body to raw unified diff text instead of the usual JSON.
 *
 * Auth:
 *   - Public github.com repos work without a token (60/hr per IP).
 *   - Private github.com repos require a PAT in settings.githubToken.
 *   - GHE: a PAT is recommended; session cookies don't work because
 *     the API host (when api.<host> exists) is a different origin.
 */
async function fetchDiffViaRestApi(
  host: string,
  owner: string,
  repo: string,
  num: number,
): Promise<{ files: { path: string; diff: string }[]; totalDiffChars: number } | null> {
  const apiBase =
    host === "github.com"
      ? "https://api.github.com"
      : `https://${host}/api/v3`;
  const url = `${apiBase}/repos/${owner}/${repo}/pulls/${num}`;

  // Pull token lazily so we don't have to thread settings through the
  // call site (which lives in the content script and doesn't know about
  // the panel's settings).
  let token: string | undefined;
  try {
    const { githubToken } = (await chrome.storage.local.get(["githubToken"])) as {
      githubToken?: string;
    };
    token = githubToken;
  } catch {
    /* storage unavailable — proceed unauthenticated */
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3.diff",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      // 401/403 → token missing or insufficient
      // 404 → wrong host (GHE that doesn't expose /api/v3) or private repo
      //   without a token. Either way, our caller falls back to /files HTML.
      return null;
    }
    const text = await resp.text();
    if (!text || text.startsWith("{")) {
      // The Accept header was ignored and we got JSON instead of the
      // diff body. Skip; fall back to HTML scrape.
      return null;
    }
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
    let inHunk = false;
    const out_lines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const hunk = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (hunk) {
        leftLine = parseInt(hunk[1], 10);
        rightLine = parseInt(hunk[2], 10);
        inHunk = true;
        out_lines.push(raw);
        continue;
      }
      // Skip headers we don't want to render line-numbered: file mode,
      // ---/+++ markers, index hashes, "Binary files differ", etc. These
      // only appear before the first hunk, so guard on !inHunk to avoid
      // misclassifying a code line that happens to start with one of
      // these tokens.
      if (
        !inHunk &&
        (raw.startsWith("index ") ||
          raw.startsWith("--- ") ||
          raw.startsWith("+++ ") ||
          raw.startsWith("new file mode") ||
          raw.startsWith("deleted file mode") ||
          raw.startsWith("similarity index") ||
          raw.startsWith("rename from") ||
          raw.startsWith("rename to") ||
          raw.startsWith("old mode") ||
          raw.startsWith("Binary files"))
      ) {
        continue;
      }
      // "\ No newline at end of file" is metadata, not a content line —
      // never advances the counters.
      if (raw.startsWith("\\ No newline")) {
        continue;
      }
      if (!inHunk) {
        // Pre-hunk noise we didn't explicitly match (e.g. the extended
        // header on rename/copy). Drop without counting.
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
      } else if (raw === "") {
        // A blank CONTEXT line. In a well-formed unified diff this is
        // " " (space + empty), but trailing-whitespace stripping during
        // transport turns it into "". It is still an unchanged line and
        // MUST advance both counters — dropping it silently desyncs every
        // subsequent line number, which sends inserted comments to the
        // wrong row.
        //
        // Exception: the final element from text.split("\n") is the empty
        // string after the diff's trailing newline — not a real line.
        const isTrailingArtifact = i === lines.length - 1;
        if (!isTrailingArtifact) {
          out_lines.push(`${String(rightLine).padStart(5, " ")}  `);
          leftLine++;
          rightLine++;
        }
      }
      // else: a line we don't recognize inside a hunk — drop without
      // counting (shouldn't happen for valid diffs).
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
