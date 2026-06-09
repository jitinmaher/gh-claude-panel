import { ChatRequest, StreamEvent, TransportSettings } from "./types";

/**
 * Shared WebSocket plumbing for the local Claude / Cursor bridges.
 *
 * Wire protocol (extension → bridge):
 *   { type: "auth", token: string }
 *   { type: "chat", adapter: "claude" | "cursor", request: ChatRequest }
 *   { type: "cancel" }
 *
 * Wire protocol (bridge → extension):
 *   { type: "ready" }                                 — auth accepted
 *   { type: "delta", text: string }
 *   { type: "tool_use", name: string, input: unknown }
 *   { type: "error", message: string }
 *   { type: "done", usage?: {...} }
 */
export async function* bridgeStream(
  adapter: "claude" | "cursor",
  req: ChatRequest,
  settings: TransportSettings,
  signal: AbortSignal,
): AsyncIterable<StreamEvent> {
  const url = settings.bridgeUrl ?? "ws://127.0.0.1:7321";
  const token = settings.bridgeToken;
  if (!token) {
    yield {
      type: "error",
      message: "Bridge token not configured. Start the bridge and paste its token in options.",
    };
    return;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    yield { type: "error", message: `Could not open ${url}: ${(err as Error).message}` };
    return;
  }

  const queue: StreamEvent[] = [];
  let resolveNext: ((ev: StreamEvent | null) => void) | null = null;
  let closed = false;

  const push = (ev: StreamEvent) => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r(ev);
    } else {
      queue.push(ev);
    }
  };

  const closeStream = () => {
    if (closed) return;
    closed = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r(null);
    }
  };

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "auth", token }));
    ws.send(JSON.stringify({ type: "chat", adapter, request: req }));
  });

  ws.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(typeof e.data === "string" ? e.data : "");
      if (msg.type === "ready") return;
      if (
        msg.type === "delta" ||
        msg.type === "tool_use" ||
        msg.type === "error" ||
        msg.type === "done"
      ) {
        push(msg as StreamEvent);
        if (msg.type === "done" || msg.type === "error") closeStream();
      }
    } catch {
      /* ignore malformed */
    }
  });

  ws.addEventListener("error", () => {
    push({ type: "error", message: "WebSocket error contacting bridge" });
    closeStream();
  });

  ws.addEventListener("close", () => {
    closeStream();
  });

  signal.addEventListener("abort", () => {
    try {
      ws.send(JSON.stringify({ type: "cancel" }));
    } catch {
      /* ws may already be closed */
    }
    closeStream();
  });

  try {
    while (!closed || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      const ev = await new Promise<StreamEvent | null>((r) => (resolveNext = r));
      if (ev === null) break;
      yield ev;
    }
  } finally {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
}
