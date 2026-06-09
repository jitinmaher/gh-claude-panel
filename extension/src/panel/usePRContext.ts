import { useEffect, useState } from "react";
import { PRContext } from "../github/pr-context";

/**
 * The panel runs inside an iframe at chrome-extension://.../panel/index.html.
 * That means `document.location` is the extension page, not the GitHub page.
 * To read PR DOM we have to ask the content script (parent frame) to scrape
 * for us and post the result back.
 */
export function usePRContext(): PRContext | null {
  const [ctx, setCtx] = useState<PRContext | null>(null);

  useEffect(() => {
    const request = () => {
      window.parent.postMessage({ type: "gh-claude-request-pr" }, "*");
    };

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "gh-claude-pr-context") {
        setCtx(e.data.context ?? null);
      }
    };

    window.addEventListener("message", onMessage);
    request();
    // Re-poll periodically because GitHub uses Turbo navigation.
    const interval = setInterval(request, 2500);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(interval);
    };
  }, []);

  return ctx;
}
