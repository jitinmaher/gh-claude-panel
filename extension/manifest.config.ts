import { defineManifest } from "@crxjs/vite-plugin";

/**
 * The static manifest only knows about public github.com. GitHub Enterprise
 * hosts (github.acme.com, etc.) are added at runtime by the user through
 * the options page, which calls chrome.permissions.request() — Chrome shows
 * a native permission prompt and, on approval, the SW dynamically registers
 * the content script for that host.
 *
 * `optional_host_permissions: ["https://*\/*"]` declares the *pattern space*
 * the SW is allowed to request from; it does NOT grant access to anything
 * at install time. (Chrome MV3 requires this declaration even though the
 * actual access is opt-in per host.)
 */
export default defineManifest({
  manifest_version: 3,
  name: "Pat Before I Merge",
  version: "0.1.0",
  description:
    "Side-panel that pats your PR before you merge it — uses Claude (cloud), local Claude Code, or local Cursor to flag bugs and suggest review comments, all without leaving GitHub.",
  action: {
    default_title: "Toggle Pat Before I Merge",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://github.com/*"],
      js: ["src/content/inject.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: [
    "https://github.com/*",
    "https://api.github.com/*",
    "https://api.anthropic.com/*",
    "http://127.0.0.1/*",
    "ws://127.0.0.1/*",
  ],
  optional_host_permissions: ["https://*/*"],
  web_accessible_resources: [
    {
      resources: ["src/panel/index.html", "icons/*"],
      // Match the union of static + every host the user might grant at
      // runtime. The pattern below covers https://anything/*, which is
      // safe here because the resources are extension-private (only
      // pages with permission can actually load them).
      matches: ["https://*/*"],
    },
  ],
});
