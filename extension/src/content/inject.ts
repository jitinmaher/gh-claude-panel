/**
 * Content script. Runs on every github.com page.
 *
 * Strategy: mount a single iframe pinned to the right edge. The iframe loads
 * panel/index.html from the extension (web_accessible_resources). All UI lives
 * inside the iframe so GitHub's CSP and React re-renders can't disturb it.
 *
 * Survives Turbo / pjax navigation because the iframe is appended to <body>
 * which Turbo doesn't replace.
 */

const PANEL_ID = "gh-claude-panel-root";
const PANEL_WIDTH = 420;

function ensurePanel(): HTMLIFrameElement {
  let frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (frame) return frame;

  frame = document.createElement("iframe");
  frame.id = PANEL_ID;
  frame.src = chrome.runtime.getURL("src/panel/index.html");
  Object.assign(frame.style, {
    position: "fixed",
    top: "0",
    right: "0",
    width: `${PANEL_WIDTH}px`,
    height: "100vh",
    border: "none",
    borderLeft: "1px solid rgba(0,0,0,0.1)",
    boxShadow: "-4px 0 12px rgba(0,0,0,0.08)",
    background: "white",
    zIndex: "2147483646",
    transform: "translateX(100%)",
    transition: "transform 180ms ease-out",
    colorScheme: "light dark",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(frame);
  return frame;
}

function setOpen(open: boolean) {
  const frame = ensurePanel();
  frame.style.transform = open ? "translateX(0)" : "translateX(100%)";
  frame.dataset.open = String(open);
  // Tell the page we have an open panel so the panel iframe can read it.
  document.documentElement.dataset.ghClaudePanelOpen = String(open);
}

function isOpen(): boolean {
  return document.getElementById(PANEL_ID)?.dataset.open === "true";
}

function togglePanel() {
  ensurePanel();
  setOpen(!isOpen());
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "togglePanel") {
    togglePanel();
    sendResponse({ ok: true });
  }
  if (msg?.type === "closePanel") {
    setOpen(false);
    sendResponse({ ok: true });
  }
  return true;
});

// Cross-frame bridge between panel iframe and GitHub page.
// We must dynamically import the scraper because content scripts and the
// iframe live in different JS realms.
import { extractPRContextWithDiffFetch } from "../github/pr-context";

window.addEventListener("message", async (e) => {
  const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (!frame || e.source !== frame.contentWindow) return;
  if (e.data?.type === "gh-claude-close") {
    setOpen(false);
    return;
  }
  if (e.data?.type === "gh-claude-request-pr") {
    const context = await extractPRContextWithDiffFetch();
    frame.contentWindow?.postMessage({ type: "gh-claude-pr-context", context }, "*");
  }
});

// Pre-mount the iframe (hidden) so opening is instant.
ensurePanel();
