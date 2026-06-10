/**
 * Centralised GitHub DOM selectors so v2 (issues, files, commits) can extend
 * cleanly and the rest of the code doesn't dig through the DOM.
 *
 * GitHub ships React + Turbo, so selectors can shift between deploys.
 * Keep this file short and document each selector's purpose.
 */

/**
 * Hosts we treat as "GitHub". This is the canonical list — the background
 * service worker imports it from here, the PR-URL regex below is built
 * from it, and the panel reads it for theme sync.
 *
 * To support another GHE host (e.g. github.acme.com):
 *   1. Add the bare hostname here.
 *   2. Add `https://<host>/*` to manifest.config.ts in three places:
 *      content_scripts[].matches, host_permissions, and
 *      web_accessible_resources[].matches.
 *   3. `npm run build:ext` and reload the extension.
 *
 * Chrome MV3 doesn't allow wildcard host_permissions, so each GHE host
 * must be declared explicitly at install time.
 *
 * github.intuit.com ships pre-configured as a working example — replace
 * or remove as needed.
 */
export const GITHUB_HOSTS = ["github.com", "github.intuit.com"] as const;

const HOST_GROUP = GITHUB_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|");

export const PR_URL_RE = new RegExp(
  `^https:\\/\\/(?:${HOST_GROUP})\\/[^/]+\\/[^/]+\\/pull\\/\\d+`,
);

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
