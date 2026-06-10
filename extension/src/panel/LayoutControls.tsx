import { useCallback, useEffect, useState } from "react";
import { PanelLayout } from "../transports/types";

/**
 * Drag handle + dock-side toggles + float toggle.
 *
 * All commands are posted to the parent (content script), which owns the
 * iframe's actual position. The content script broadcasts the resulting
 * layout back via "gh-claude-layout" so we can highlight the active side.
 */
export function LayoutControls() {
  const [layout, setLayout] = useState<PanelLayout | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "gh-claude-layout") {
        setLayout(e.data.layout as PanelLayout);
      }
    };
    window.addEventListener("message", onMsg);
    // Ask the parent for the current layout on mount.
    window.parent.postMessage({ type: "gh-claude-request-layout" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const dockedSide = layout?.mode === "docked" ? layout.side : null;
  const isFloating = layout?.mode === "floating";

  const onGripPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // Tell the parent where in the iframe the user grabbed — content script
    // uses this to keep the panel offset from the cursor as it drags.
    window.parent.postMessage(
      {
        type: "gh-claude-drag-start",
        offsetX: e.clientX,
        offsetY: e.clientY,
      },
      "*",
    );
  }, []);

  const dock = (side: "left" | "right") =>
    window.parent.postMessage({ type: "gh-claude-dock", side }, "*");

  const toggleFloat = () =>
    window.parent.postMessage({ type: "gh-claude-toggle-floating" }, "*");

  return (
    <div className="layout-controls">
      <button
        type="button"
        className="layout-grip"
        onPointerDown={onGripPointerDown}
        title="Drag to move (drop near an edge to dock)"
        aria-label="Drag panel"
      >
        {/* 6-dot grip glyph */}
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
          <circle cx="2" cy="2" r="1.2" />
          <circle cx="8" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" />
          <circle cx="8" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" />
          <circle cx="8" cy="12" r="1.2" />
        </svg>
      </button>
      <button
        type="button"
        className={`icon-btn layout-btn ${dockedSide === "left" ? "active" : ""}`}
        onClick={() => dock("left")}
        title="Dock left"
        aria-label="Dock panel to the left"
      >
        ⬅
      </button>
      <button
        type="button"
        className={`icon-btn layout-btn ${dockedSide === "right" ? "active" : ""}`}
        onClick={() => dock("right")}
        title="Dock right"
        aria-label="Dock panel to the right"
      >
        ➡
      </button>
      <button
        type="button"
        className={`icon-btn layout-btn ${isFloating ? "active" : ""}`}
        onClick={toggleFloat}
        title={isFloating ? "Dock right" : "Float anywhere"}
        aria-label={isFloating ? "Dock the panel" : "Float the panel"}
      >
        ⊞
      </button>
    </div>
  );
}
