import { useEffect } from "react";

/**
 * Sync the iframe's typography and color-scheme with the host GitHub page.
 *
 * Why: the panel iframe is a separate document, so it doesn't inherit
 * GitHub's font stack or theme. Without this hook the panel looks like a
 * generic web page next to GitHub's chrome.
 *
 * What we sync:
 *   - body font-family and font-size (computed from parent's <body>)
 *   - GitHub's theme attributes (data-color-mode, data-light-theme,
 *     data-dark-theme) copied onto the panel's <html> so any future
 *     primer-style tokens we adopt resolve correctly
 *   - a `data-host-theme` attribute we can hook CSS off of
 *
 * Cross-origin: panel iframe is loaded from chrome-extension://, parent is
 * github.com (or a GHE host). Same-origin reads of parent.document fail
 * normally, but extensions get an exemption when `host_permissions`
 * covers the parent — which we have.
 */
export function useHostTheme() {
  useEffect(() => {
    let cancelled = false;

    const apply = () => {
      if (cancelled) return;
      try {
        const parentDoc = window.parent.document;
        const parentHtml = parentDoc.documentElement;
        const parentBody = parentDoc.body;
        if (!parentBody) return;

        const cs = window.parent.getComputedStyle(parentBody);
        document.documentElement.style.setProperty(
          "--host-font-family",
          cs.fontFamily,
        );
        document.documentElement.style.setProperty(
          "--host-font-size",
          cs.fontSize,
        );

        // GitHub puts data-color-mode="auto|light|dark" on <html>. Mirror it
        // so our scoped CSS can react to user toggles, not just OS settings.
        const colorMode = parentHtml.getAttribute("data-color-mode");
        const lightTheme = parentHtml.getAttribute("data-light-theme");
        const darkTheme = parentHtml.getAttribute("data-dark-theme");
        if (colorMode) {
          document.documentElement.setAttribute("data-color-mode", colorMode);
        }
        if (lightTheme) {
          document.documentElement.setAttribute("data-light-theme", lightTheme);
        }
        if (darkTheme) {
          document.documentElement.setAttribute("data-dark-theme", darkTheme);
        }

        // Resolve the effective scheme so CSS can do .host-dark / .host-light
        const prefersDark =
          window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches;
        const effective =
          colorMode === "dark"
            ? "dark"
            : colorMode === "light"
              ? "light"
              : prefersDark
                ? "dark"
                : "light";
        document.documentElement.setAttribute("data-host-theme", effective);
      } catch {
        // Cross-origin access blocked — fall back to CSS defaults.
      }
    };

    apply();

    // Re-sync if GitHub toggles theme or remounts content (Turbo nav).
    const mo = new MutationObserver(apply);
    try {
      mo.observe(window.parent.document.documentElement, {
        attributes: true,
        attributeFilter: ["data-color-mode", "data-light-theme", "data-dark-theme"],
      });
    } catch {
      /* cross-origin observer failed — ignore */
    }

    return () => {
      cancelled = true;
      mo.disconnect();
    };
  }, []);
}
