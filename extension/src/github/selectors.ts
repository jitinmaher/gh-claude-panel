/**
 * Centralised GitHub DOM selectors so v2 (issues, files, commits) can extend
 * cleanly and the rest of the code doesn't dig through the DOM.
 *
 * GitHub ships React + Turbo, so selectors can shift between deploys.
 * Keep this file short and document each selector's purpose.
 */

/**
 * Hosts we treat as "GitHub". Add more GHE hosts here AND in
 * manifest.config.ts (content_scripts + host_permissions + WAR).
 */
export const GITHUB_HOSTS = ["github.com", "github.intuit.com"] as const;

const HOST_GROUP = GITHUB_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|");

export const PR_URL_RE = new RegExp(
  `^https:\\/\\/(?:${HOST_GROUP})\\/[^/]+\\/[^/]+\\/pull\\/\\d+`,
);

export const SELECTORS = {
  /** Title heading on the PR conversation page. */
  prTitle: "bdi.js-issue-title, h1.gh-header-title bdi",
  /** Container for each file diff on the "Files changed" tab. */
  fileDiff: "div.file[data-tagsearch-path], copilot-diff-entry",
  /** Path of the file rendered in a given diff container. */
  fileDiffPath: "[data-path], .file-info a.Link--primary",
  /** All diff <table> rows including added/removed/context lines. */
  fileDiffRows: "table.diff-table tr",
  /** PR number badge in the header. */
  prNumber: "span.gh-header-number",
  /** Author of the PR. */
  prAuthor: "a.author",
} as const;
