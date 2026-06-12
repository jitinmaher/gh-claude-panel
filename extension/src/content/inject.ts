/**
 * Content script. Runs on every github.com page.
 *
 * Strategy: mount a single iframe whose position and dimensions are driven by
 * a PanelLayout value stored in chrome.storage.local. Three modes:
 *
 *   - docked right (default): full-height bar pinned to the right edge.
 *   - docked left: full-height bar on the left edge.
 *   - floating: window with rounded corners, dragged anywhere on the page.
 *
 * Dragging is initiated from a grip inside the iframe (panel header) via
 * postMessage. The actual mouse tracking happens on a transparent overlay
 * added to the host page — that's because mouse events stop reaching the
 * iframe once the cursor moves over a different element, but they will
 * always reach an overlay we own.
 *
 * Survives Turbo / pjax navigation because the iframe is appended to <body>
 * which Turbo doesn't replace.
 */

import { extractPRContextWithDiffFetch, parsePRUrl } from "../github/pr-context";
import {
  DOM_UNAVAILABLE,
  insertViaDom,
  previewFindingLocation,
} from "../github/review-insert";
import { DEFAULT_PANEL_LAYOUT, PanelLayout } from "../transports/types";

const PANEL_ID = "gh-claude-panel-root";
const RESIZE_HANDLE_ID = "gh-claude-resize-handle";
const DRAG_OVERLAY_ID = "gh-claude-drag-overlay";

// Layout constants — tweak here, all references downstream pick them up.
const SNAP_THRESHOLD_PX = 80; // distance from edge that triggers dock-snap
const MIN_DOCKED_WIDTH = 300;
const MAX_DOCKED_WIDTH = 800;
const FLOATING_MIN_WIDTH = 320;
const FLOATING_MIN_HEIGHT = 240;
const FLOATING_EDGE_MARGIN = 16; // floating panel can't get within 16px of viewport edge
const RESIZE_HANDLE_WIDTH = 6;

// In-memory layout — synced from storage on first load.
let layout: PanelLayout = { ...DEFAULT_PANEL_LAYOUT };

async function loadLayoutFromStorage(): Promise<void> {
  try {
    const { panelLayout } = (await chrome.storage.local.get(["panelLayout"])) as {
      panelLayout?: PanelLayout;
    };
    if (panelLayout) layout = panelLayout;
  } catch {
    /* extension context invalidated — keep defaults */
  }
}

async function saveLayoutToStorage(): Promise<void> {
  try {
    await chrome.storage.local.set({ panelLayout: layout });
  } catch {
    /* ignore */
  }
}

function ensurePanel(): HTMLIFrameElement {
  let frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (frame) return frame;

  frame = document.createElement("iframe");
  frame.id = PANEL_ID;
  frame.src = chrome.runtime.getURL("src/panel/index.html");
  Object.assign(frame.style, {
    position: "fixed",
    border: "none",
    background: "white",
    zIndex: "2147483646",
    colorScheme: "light dark",
    transition: "transform 180ms ease-out",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(frame);
  applyLayout(frame);
  return frame;
}

/**
 * Write `layout` to the iframe's inline styles. Idempotent — call after
 * any layout mutation. The off-screen `transform` (when closed) is applied
 * separately in setOpen so we don't have to remember every callsite.
 */
function applyLayout(frame: HTMLIFrameElement) {
  // Wipe any properties that previous modes may have set.
  for (const k of ["top", "right", "bottom", "left", "width", "height"] as const) {
    frame.style[k] = "";
  }
  frame.style.borderRadius = "";
  frame.style.boxShadow = "";
  frame.style.borderLeft = "";
  frame.style.borderRight = "";

  if (layout.mode === "docked") {
    const w = clamp(layout.width, MIN_DOCKED_WIDTH, MAX_DOCKED_WIDTH);
    frame.style.top = "0";
    frame.style.height = "100vh";
    frame.style.width = `${w}px`;
    if (layout.side === "right") {
      frame.style.right = "0";
      frame.style.borderLeft = "1px solid rgba(0,0,0,0.1)";
      frame.style.boxShadow = "-4px 0 12px rgba(0,0,0,0.08)";
    } else {
      frame.style.left = "0";
      frame.style.borderRight = "1px solid rgba(0,0,0,0.1)";
      frame.style.boxShadow = "4px 0 12px rgba(0,0,0,0.08)";
    }
  } else {
    // floating
    const { vw, vh } = viewport();
    const w = clamp(layout.width, FLOATING_MIN_WIDTH, vw - 2 * FLOATING_EDGE_MARGIN);
    const h = clamp(layout.height, FLOATING_MIN_HEIGHT, vh - 2 * FLOATING_EDGE_MARGIN);
    const left = clamp(layout.left, FLOATING_EDGE_MARGIN, vw - w - FLOATING_EDGE_MARGIN);
    const top = clamp(layout.top, FLOATING_EDGE_MARGIN, vh - h - FLOATING_EDGE_MARGIN);
    frame.style.left = `${left}px`;
    frame.style.top = `${top}px`;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    frame.style.borderRadius = "10px";
    frame.style.boxShadow = "0 12px 32px rgba(0,0,0,0.20)";
  }
  // Tell the panel iframe the current layout so it can adjust UI affordances.
  frame.contentWindow?.postMessage({ type: "gh-claude-layout", layout }, "*");
  // Resize handle position depends on dock state.
  positionResizeHandle();
}

/** Off-screen transform for hide/show. Computed per-layout so the slide-out goes the right direction. */
function hiddenTransform(): string {
  if (layout.mode === "docked") {
    return layout.side === "right" ? "translateX(100%)" : "translateX(-100%)";
  }
  // Floating: just fade out via scale + opacity isn't worth it; slide right.
  return "translate(120%, 0)";
}

function setOpen(open: boolean) {
  const frame = ensurePanel();
  frame.style.transform = open ? "translate(0, 0)" : hiddenTransform();
  frame.dataset.open = String(open);
  document.documentElement.dataset.ghClaudePanelOpen = String(open);
  if (open) positionResizeHandle();
  else removeResizeHandle();
}

function isOpen(): boolean {
  return document.getElementById(PANEL_ID)?.dataset.open === "true";
}

function togglePanel() {
  ensurePanel();
  setOpen(!isOpen());
}

/* ─────────── Resize handle (docked mode only) ─────────── */

function ensureResizeHandle(): HTMLDivElement {
  let handle = document.getElementById(RESIZE_HANDLE_ID) as HTMLDivElement | null;
  if (handle) return handle;
  handle = document.createElement("div");
  handle.id = RESIZE_HANDLE_ID;
  Object.assign(handle.style, {
    position: "fixed",
    top: "0",
    height: "100vh",
    width: `${RESIZE_HANDLE_WIDTH}px`,
    cursor: "ew-resize",
    zIndex: "2147483647", // above the iframe so we get the pointer event
    background: "transparent",
  } satisfies Partial<CSSStyleDeclaration>);
  handle.addEventListener("pointerdown", startResize);
  document.body.appendChild(handle);
  return handle;
}

function removeResizeHandle() {
  document.getElementById(RESIZE_HANDLE_ID)?.remove();
}

function positionResizeHandle() {
  if (layout.mode !== "docked" || !isOpen()) {
    removeResizeHandle();
    return;
  }
  const handle = ensureResizeHandle();
  if (layout.side === "right") {
    // Handle sits on the panel's left edge.
    handle.style.left = `${viewport().vw - layout.width}px`;
    handle.style.right = "";
  } else {
    // Handle on panel's right edge.
    handle.style.left = `${layout.width - RESIZE_HANDLE_WIDTH}px`;
    handle.style.right = "";
  }
}

function startResize(e: PointerEvent) {
  if (layout.mode !== "docked") return;
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = layout.width;
  const side = layout.side;
  const overlay = addDragOverlay("ew-resize");

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const newWidth = side === "right" ? startWidth - dx : startWidth + dx;
    layout = {
      mode: "docked",
      side,
      width: clamp(newWidth, MIN_DOCKED_WIDTH, MAX_DOCKED_WIDTH),
    };
    const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
    if (frame) applyLayout(frame);
  };
  const up = () => {
    overlay.remove();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    saveLayoutToStorage();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

/* ─────────── Drag (move panel) ─────────── */

/** Mouse-event overlay covering the whole viewport. Used for both drag and resize so the iframe stops swallowing events. */
function addDragOverlay(cursor: string): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = DRAG_OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    cursor,
    zIndex: "2147483647",
    background: "transparent",
    userSelect: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlay);
  return overlay;
}

function startDrag(grabOffsetX: number, grabOffsetY: number) {
  const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (!frame) return;
  // Switch to floating immediately so we have an absolute (left, top) basis to move from.
  // Snap-back to a dock happens on drop.
  const rect = frame.getBoundingClientRect();
  if (layout.mode === "docked") {
    layout = {
      mode: "floating",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    applyLayout(frame);
  }

  const overlay = addDragOverlay("grabbing");
  // Subtle visual cue while dragging.
  frame.style.transition = "none";
  frame.style.opacity = "0.92";

  const move = (ev: PointerEvent) => {
    const { vw, vh } = viewport();
    const w = (layout as Extract<PanelLayout, { mode: "floating" }>).width;
    const h = (layout as Extract<PanelLayout, { mode: "floating" }>).height;
    const left = clamp(ev.clientX - grabOffsetX, FLOATING_EDGE_MARGIN, vw - w - FLOATING_EDGE_MARGIN);
    const top = clamp(ev.clientY - grabOffsetY, FLOATING_EDGE_MARGIN, vh - h - FLOATING_EDGE_MARGIN);
    layout = { mode: "floating", left, top, width: w, height: h };
    applyLayout(frame);
  };

  const up = (ev: PointerEvent) => {
    overlay.remove();
    frame.style.transition = "transform 180ms ease-out";
    frame.style.opacity = "1";
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);

    // Snap-to-edge check.
    const { vw } = viewport();
    const dropX = ev.clientX;
    if (dropX < SNAP_THRESHOLD_PX) {
      layout = { mode: "docked", side: "left", width: snapToDockWidth() };
    } else if (dropX > vw - SNAP_THRESHOLD_PX) {
      layout = { mode: "docked", side: "right", width: snapToDockWidth() };
    }
    // else: stays floating with the position from the last move()
    applyLayout(frame);
    saveLayoutToStorage();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

/** When snapping to dock, prefer the panel's current width (clamped); fall back to default. */
function snapToDockWidth(): number {
  const w = layout.mode === "floating" ? layout.width : layout.width;
  return clamp(w, MIN_DOCKED_WIDTH, MAX_DOCKED_WIDTH);
}

/* ─────────── Explicit layout commands from header buttons ─────────── */

function dockTo(side: "left" | "right") {
  const width = layout.mode === "docked" ? layout.width : clamp(layout.width ?? 420, MIN_DOCKED_WIDTH, MAX_DOCKED_WIDTH);
  layout = { mode: "docked", side, width };
  const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (frame) applyLayout(frame);
  saveLayoutToStorage();
}

function toggleFloating() {
  const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (!frame) return;
  if (layout.mode === "docked") {
    // Drop to a sensible floating default: 80% of viewport height, current width, top-center.
    const { vw, vh } = viewport();
    const w = layout.width;
    const h = Math.min(720, vh - 2 * FLOATING_EDGE_MARGIN);
    layout = {
      mode: "floating",
      left: Math.max(FLOATING_EDGE_MARGIN, Math.round((vw - w) / 2)),
      top: FLOATING_EDGE_MARGIN * 4,
      width: w,
      height: h,
    };
  } else {
    layout = { mode: "docked", side: "right", width: clamp(layout.width, MIN_DOCKED_WIDTH, MAX_DOCKED_WIDTH) };
  }
  applyLayout(frame);
  saveLayoutToStorage();
}

/* ─────────── Listener wiring ─────────── */

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

function showToast(text: string) {
  const existing = document.getElementById("gh-claude-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "gh-claude-toast";
  el.textContent = text;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#1f2328",
    color: "#ffffff",
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: "500",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
    zIndex: "2147483647",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 180ms ease",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "1"));
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, 2400);
}

/**
 * Insert posts a single inline comment on the line. Two paths:
 *
 *   1. Drive GitHub's own UI on the classic /files viewer (click +,
 *      fill, "Add single comment"). GitHub re-renders the comment in
 *      place — appears LIVE, no page refresh.
 *   2. If the DOM can't be driven (new /changes viewer), fall back to
 *      the REST API and soft-refresh the diff so the comment shows up
 *      without a full reload.
 */
async function handleInsertFinding(req: {
  findingId?: string;
  file?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  text: string;
}) {
  if (!req.file || !req.line) {
    await copyToClipboardFallback(req.text, "no file/line — copied to clipboard");
    postInsertResult(req.findingId, false, "no file/line");
    return;
  }
  const side = req.side ?? "RIGHT";

  const parsed = parsePRUrl();
  if (!parsed) {
    await copyToClipboardFallback(req.text, "not on a PR page — copied to clipboard");
    postInsertResult(req.findingId, false, "not on a PR page");
    return;
  }

  // 1. Try GitHub's own UI — the only way the comment renders live.
  const dom = await insertViaDom({ file: req.file, line: req.line, side, text: req.text });
  if (dom.ok) {
    showToast(`Comment posted on ${req.file}:${req.line}`);
    postInsertResult(req.findingId, true);
    return;
  }
  // A real DOM failure (form found but submit button missing) — surface it.
  if (dom.reason !== DOM_UNAVAILABLE) {
    await copyToClipboardFallback(req.text, `${dom.reason} — copied to clipboard`);
    postInsertResult(req.findingId, false, dom.reason);
    return;
  }

  // 2. DOM unavailable (new /changes viewer) — post via REST API, then
  //    soft-refresh the diff so the comment appears without a full reload.
  let resp: { ok: boolean; error?: string } | undefined;
  try {
    resp = await chrome.runtime.sendMessage({
      type: "postLiveComment",
      host: parsed.host,
      owner: parsed.owner,
      repo: parsed.repo,
      number: parsed.number,
      path: req.file,
      line: req.line,
      side,
      body: req.text,
    });
  } catch (err) {
    resp = { ok: false, error: (err as Error).message };
  }

  if (resp?.ok) {
    showToast(`Comment posted on ${req.file}:${req.line}`);
    postInsertResult(req.findingId, true);
    void softRefreshDiff();
    return;
  }

  const reason = resp?.error ?? "couldn't post the comment";
  await copyToClipboardFallback(req.text, `${reason} — copied to clipboard`);
  postInsertResult(req.findingId, false, reason);
}

/**
 * Re-fetch the diff in-page (no full reload, panel survives) so an
 * API-posted comment shows up. GitHub's React router refetches when its
 * own tab link is clicked; we click whichever diff tab is current.
 */
async function softRefreshDiff(): Promise<void> {
  const tab = document.querySelector<HTMLAnchorElement>(
    'a[href$="/changes"], a[href$="/files"], a[data-tab-item="files_bucket"], a#files_tab',
  );
  // Clicking the already-active tab re-triggers GitHub's data fetch in
  // most builds. Harmless if it doesn't.
  tab?.click();
}

/** Tell the panel iframe whether the insertion succeeded so the finding
 * card can flip into its "Inserted" state. No-op if the panel iframe
 * isn't mounted (shouldn't happen — the message originated there). */
function postInsertResult(
  findingId: string | undefined,
  ok: boolean,
  reason?: string,
): void {
  if (!findingId) return;
  const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  frame?.contentWindow?.postMessage(
    { type: "gh-claude-insert-result", findingId, ok, reason },
    "*",
  );
}

async function handlePreviewFinding(req: {
  file?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}) {
  if (!req.file || !req.line) {
    showToast("no file/line to preview");
    return;
  }
  const result = await previewFindingLocation({
    file: req.file,
    line: req.line,
    side: req.side ?? "RIGHT",
  });
  if (!result.ok) showToast(result.reason);
}

async function copyToClipboardFallback(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard might be blocked — toast still informs the user */
  }
  showToast(message);
}

window.addEventListener("message", async (e) => {
  const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (!frame || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (!d || typeof d.type !== "string") return;

  if (d.type === "gh-claude-close") {
    setOpen(false);
    return;
  }
  if (d.type === "gh-claude-request-pr") {
    const context = await extractPRContextWithDiffFetch();
    frame.contentWindow?.postMessage({ type: "gh-claude-pr-context", context }, "*");
    return;
  }
  if (d.type === "gh-claude-insert-finding") {
    await handleInsertFinding(d);
    return;
  }
  if (d.type === "gh-claude-preview-finding") {
    await handlePreviewFinding(d);
    return;
  }
  if (d.type === "gh-claude-toast" && typeof d.text === "string") {
    showToast(d.text);
    return;
  }
  // Layout commands from the panel header.
  if (d.type === "gh-claude-drag-start" && typeof d.offsetX === "number" && typeof d.offsetY === "number") {
    startDrag(d.offsetX, d.offsetY);
    return;
  }
  if (d.type === "gh-claude-dock" && (d.side === "left" || d.side === "right")) {
    dockTo(d.side);
    return;
  }
  if (d.type === "gh-claude-toggle-floating") {
    toggleFloating();
    return;
  }
  if (d.type === "gh-claude-request-layout") {
    frame.contentWindow?.postMessage({ type: "gh-claude-layout", layout }, "*");
    return;
  }
});

window.addEventListener("resize", () => {
  // Keep floating panel on-screen if the window shrinks.
  const frame = document.getElementById(PANEL_ID) as HTMLIFrameElement | null;
  if (!frame) return;
  applyLayout(frame);
});

/* ─────────── Utilities ─────────── */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function viewport(): { vw: number; vh: number } {
  return { vw: window.innerWidth, vh: window.innerHeight };
}

/* ─────────── Boot ─────────── */

(async () => {
  await loadLayoutFromStorage();
  // Pre-mount hidden so opening is instant.
  const frame = ensurePanel();
  frame.style.transform = hiddenTransform();
})();
