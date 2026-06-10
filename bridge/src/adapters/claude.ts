import { spawn } from "node:child_process";
import { Adapter } from "./types";
import { ChatRequest, ServerMsg } from "../protocol";

/**
 * Wraps the `claude` CLI in --print --output-format=stream-json mode.
 *
 * We construct a single prompt by stringifying the messages and prepending
 * the system + context blocks. The CLI's --print mode treats the prompt as
 * a one-shot non-interactive task and streams JSONL events to stdout.
 */
export class ClaudeAdapter implements Adapter {
  async *run(req: ChatRequest, abort: AbortSignal): AsyncIterable<ServerMsg> {
    const prompt = buildPrompt(req);
    // Default allow-list keeps Claude unblocked for read-only PR-review work.
    // Override via GH_CLAUDE_ALLOWED_TOOLS (comma-separated).
    const allowed =
      process.env.GH_CLAUDE_ALLOWED_TOOLS ??
      "Bash(gh:*),Bash(git:*),Read,Glob,Grep,WebFetch";

    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      allowed,
    ];
    // Forward the user's chosen model if one was passed through. The
    // `claude` CLI accepts --model <id>; omit when not specified so the
    // CLI's own default (usually the user's last interactive choice or
    // ANTHROPIC_MODEL env var) takes over.
    if (req.options?.model) {
      args.push("--model", req.options.model);
    }
    // Pipe the prompt over stdin rather than argv: avoids quoting issues
    // with multi-line prompts containing shell-special chars (backticks,
    // newlines, hashes). The CLI accepts either, but stdin is the safer
    // channel for arbitrary text.

    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin?.end(prompt);
    let stderrBuf = "";

    const cleanup = () => {
      try {
        child.kill("SIGTERM");
      } catch { /* already gone */ }
    };
    abort.addEventListener("abort", cleanup);

    child.stderr?.on("data", (d) => {
      stderrBuf += d.toString();
    });

    const stdout = child.stdout!;
    let buffer = "";
    let done = false;

    const lines: string[] = [];
    let waiter: (() => void) | null = null;

    stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) lines.push(line);
        idx = buffer.indexOf("\n");
      }
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
      while (!done || lines.length > 0) {
        if (lines.length === 0) {
          if (done) break;
          await new Promise<void>((r) => (waiter = r));
          continue;
        }
        const line = lines.shift()!;
        const ev = parseClaudeEvent(line);
        if (ev) yield ev;
      }
      const code = await exitPromise;
      if (code !== 0) {
        yield {
          type: "error",
          message: `claude CLI exited with code ${code}: ${stderrBuf.slice(0, 500)}`,
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
    parts.push("# Context from the current GitHub page");
    for (const b of req.contextBlocks) {
      parts.push(`## ${b.label}\n\n${b.body}`);
    }
  }
  parts.push("# Conversation so far");
  for (const m of req.messages) {
    parts.push(`### ${m.role}\n\n${m.content}`);
  }
  return parts.join("\n\n");
}

function parseClaudeEvent(line: string): ServerMsg | null {
  let obj: {
    type?: string;
    subtype?: string;
    is_error?: boolean;
    message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
    result?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string } | string;
  };
  try {
    obj = JSON.parse(line);
  } catch {
    // Not JSON — ignore. The CLI's stream-json output is always one JSON
    // object per line; non-JSON usually means a Node warning or similar.
    return null;
  }

  if (obj.type === "assistant" && obj.message?.content) {
    const blocks = obj.message.content;
    const text = blocks
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
    if (text) return { type: "delta", text };
    const toolUse = blocks.find((c) => c.type === "tool_use");
    if (toolUse) {
      return {
        type: "tool_use",
        name: toolUse.name ?? "tool",
        input: toolUse.input,
      };
    }
  }
  if (obj.type === "result") {
    if (obj.is_error || obj.subtype === "error") {
      const msg =
        typeof obj.error === "string"
          ? obj.error
          : obj.error?.message ?? obj.result ?? "Claude CLI error";
      return { type: "error", message: msg };
    }
    return {
      type: "done",
      usage: {
        inputTokens: obj.usage?.input_tokens,
        outputTokens: obj.usage?.output_tokens,
      },
    };
  }
  // system / rate_limit_event / user-replay / etc. — ignore.
  return null;
}
