import { spawn } from "node:child_process";
import { Adapter } from "./types";
import { ChatRequest, ServerMsg } from "../protocol";

/**
 * Cursor's agent CLI invocation is not fully stable in public docs. This
 * adapter shells out to `cursor-agent` (the headless CLI Cursor ships)
 * and streams its stdout back as plain-text deltas.
 *
 * If your Cursor install uses a different binary name or flags, set
 * GH_CLAUDE_CURSOR_BIN and GH_CLAUDE_CURSOR_ARGS environment variables.
 *
 *   GH_CLAUDE_CURSOR_BIN=cursor-agent
 *   GH_CLAUDE_CURSOR_ARGS="--non-interactive --stream"
 */
export class CursorAdapter implements Adapter {
  async *run(req: ChatRequest, abort: AbortSignal): AsyncIterable<ServerMsg> {
    const bin = process.env.GH_CLAUDE_CURSOR_BIN ?? "cursor-agent";
    const extra = (process.env.GH_CLAUDE_CURSOR_ARGS ?? "")
      .split(/\s+/)
      .filter(Boolean);

    // Forward the user's chosen model if one was passed through. The
    // cursor-agent CLI accepts --model <id>; omit when not specified.
    const modelArgs = req.options?.model ? ["--model", req.options.model] : [];

    const prompt = buildPrompt(req);

    const child = spawn(bin, [...extra, ...modelArgs, prompt], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const cleanup = () => {
      try {
        child.kill("SIGTERM");
      } catch { /* already gone */ }
    };
    abort.addEventListener("abort", cleanup);

    let stderrBuf = "";
    child.stderr?.on("data", (d) => {
      stderrBuf += d.toString();
    });

    const chunks: string[] = [];
    let waiter: (() => void) | null = null;
    let done = false;

    child.stdout!.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"));
      if (waiter) {
        waiter();
        waiter = null;
      }
    });

    const exitPromise = new Promise<number>((resolve) => {
      child.on("exit", (code) => {
        done = true;
        if (waiter) {
          waiter();
          waiter = null;
        }
        resolve(code ?? 0);
      });
    });

    try {
      while (!done || chunks.length > 0) {
        if (chunks.length === 0) {
          if (done) break;
          await new Promise<void>((r) => (waiter = r));
          continue;
        }
        const text = chunks.shift()!;
        if (text) yield { type: "delta", text };
      }
      const code = await exitPromise;
      if (code !== 0) {
        yield {
          type: "error",
          message: `cursor-agent exited with code ${code}: ${stderrBuf.slice(0, 500)}`,
        };
      }
      yield { type: "done" };
    } finally {
      cleanup();
    }
  }
}

function buildPrompt(req: ChatRequest): string {
  const parts: string[] = [];
  if (req.system) parts.push(req.system);
  if (req.contextBlocks?.length) {
    for (const b of req.contextBlocks) parts.push(`## ${b.label}\n\n${b.body}`);
  }
  for (const m of req.messages) {
    parts.push(`### ${m.role}\n${m.content}`);
  }
  return parts.join("\n\n");
}
