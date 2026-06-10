/**
 * Centralised GitHub DOM selectors so v2 (issues, files, commits) can extend
 * cleanly and the rest of the code doesn't dig through the DOM.
 *
 * GitHub ships React + Turbo, so selectors can shift between deploys.
 * Keep this file short and document each selector's purpose.
 */

/**
 * GitHub hosts the extension recognizes.
 *
 * `STATIC_HOSTS` is the compile-time list — only github.com. It ships
 * pre-permitted in the manifest so the extension works out of the box on
 * public GitHub without any setup.
 *
 * Enterprise hosts (github.acme.com, etc.) are added at runtime by the
 * user through the options page. They live in chrome.storage.local under
 * `enterpriseHosts: string[]` and the user grants per-host permission via
 * chrome.permissions.request() — no rebuild, no sideload edits.
 *
 * Use the helpers below (`loadAllHosts`, `buildPRUrlRegex`) anywhere
 * code needs the merged static + dynamic list.
 */
export const STATIC_HOSTS = ["github.com"] as const;

/** Read the user's runtime-added enterprise hosts from storage. */
export async function loadEnterpriseHosts(): Promise<string[]> {
  try {
    const { enterpriseHosts } = (await chrome.storage.local.get(["enterpriseHosts"])) as {
      enterpriseHosts?: string[];
    };
    return Array.isArray(enterpriseHosts) ? enterpriseHosts.filter(isValidHost) : [];
  } catch {
    return [];
  }
}

/** Merged list of static + user-added hosts. */
export async function loadAllHosts(): Promise<string[]> {
  return [...STATIC_HOSTS, ...(await loadEnterpriseHosts())];
}

/** Build the PR-URL regex from an explicit host list. */
export function buildPRUrlRegex(hosts: readonly string[]): RegExp {
  const group = hosts.map((h) => h.replace(/\./g, "\\.")).join("|");
  return new RegExp(`^https:\\/\\/(?:${group})\\/[^/]+\\/[^/]+\\/pull\\/\\d+`);
}

/**
 * Basic hostname validation: lowercase letters, digits, dots, hyphens.
 * Rejects schemes, paths, ports — we expect bare hostnames only.
 */
export function isValidHost(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s)
  );
}

export const SELECTORS = {
  /** Title heading on the PR conversation page. */
  prTitle: "bdi.js-issue-title, h1.gh-header-title bdi",
  /**
   * Container for each file diff. Multiple selectors to cover GitHub's
   * three known PR viewers:
   *   - Classic /files: <div class="file" data-tagsearch-path="...">
   *   - Copilot-era /files: <copilot-diff-entry>
   *   - New /changes (React): <div data-file-path="..."> / [data-testid="diff-file"]
   * Whichever the page currently renders, we querySelectorAll the union.
   */
  fileDiff:
    "div.file[data-tagsearch-path], copilot-diff-entry, [data-file-path], [data-testid='diff-file']",
  /** Path of the file rendered in a given diff container. */
  fileDiffPath: "[data-path], .file-info a.Link--primary",
  /** All diff <table> rows including added/removed/context lines. */
  fileDiffRows: "table.diff-table tr",
  /** PR number badge in the header. */
  prNumber: "span.gh-header-number",
  /** Author of the PR. */
  prAuthor: "a.author",
} as const;
