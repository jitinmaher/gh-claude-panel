import { WebSocketServer, WebSocket } from "ws";
import { ClaudeAdapter } from "./adapters/claude";
import { CursorAdapter } from "./adapters/cursor";
import { Adapter } from "./adapters/types";
import { ClientMsg, ServerMsg } from "./protocol";

interface Options {
  port: number;
  host: string;
  token: string;
}

export function startServer(opts: Options) {
  const wss = new WebSocketServer({ port: opts.port, host: opts.host });

  wss.on("listening", () => {
    console.log(`[bridge] listening on ws://${opts.host}:${opts.port}`);
  });

  wss.on("connection", (ws, req) => {
    // Localhost binding already restricts most attackers, but double-check
    // the remote address.
    const remote = req.socket.remoteAddress ?? "";
    if (!remote.includes("127.0.0.1") && !remote.includes("::1")) {
      console.warn(`[bridge] rejecting non-local connection from ${remote}`);
      ws.close(1008, "non-local");
      return;
    }

    handleConnection(ws, opts.token);
  });

  return wss;
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleConnection(ws: WebSocket, expectedToken: string) {
  let authed = false;
  let abortCtrl: AbortController | null = null;

  ws.on("message", async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "Malformed JSON" });
      return;
    }

    if (msg.type === "auth") {
      if (msg.token === expectedToken) {
        authed = true;
        send(ws, { type: "ready" });
      } else {
        send(ws, { type: "error", message: "Invalid token" });
        ws.close(1008, "invalid token");
      }
      return;
    }

    if (!authed) {
      send(ws, { type: "error", message: "Not authenticated" });
      ws.close(1008, "auth required");
      return;
    }

    if (msg.type === "cancel") {
      abortCtrl?.abort();
      return;
    }

    if (msg.type === "chat") {
      abortCtrl?.abort();
      abortCtrl = new AbortController();
      const adapter: Adapter =
        msg.adapter === "claude" ? new ClaudeAdapter() : new CursorAdapter();
      try {
        for await (const ev of adapter.run(msg.request, abortCtrl.signal)) {
          send(ws, ev);
          if (ev.type === "done" || ev.type === "error") break;
        }
      } catch (err) {
        send(ws, { type: "error", message: (err as Error).message });
      }
    }
  });

  ws.on("close", () => {
    abortCtrl?.abort();
  });
}
