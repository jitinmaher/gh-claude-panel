import { defineManifest } from "@crxjs/vite-plugin";

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
      matches: [
        "https://github.com/*",
        "https://github.intuit.com/*",
      ],
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
    "https://github.intuit.com/*",
    "https://api.anthropic.com/*",
    "http://127.0.0.1/*",
    "ws://127.0.0.1/*",
  ],
  web_accessible_resources: [
    {
      resources: ["src/panel/index.html", "icons/*"],
      matches: [
        "https://github.com/*",
        "https://github.intuit.com/*",
      ],
    },
  ],
});
