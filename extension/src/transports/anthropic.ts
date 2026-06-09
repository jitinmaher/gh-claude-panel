import {
  AgentTransport,
  ChatRequest,
  DEFAULT_SETTINGS,
  StreamEvent,
  TransportSettings,
} from "./types";

/**
 * Direct streaming to api.anthropic.com using the Messages API.
 *
 * Note: Anthropic requires either an OAuth token or an x-api-key header.
 * For a personal prototype we accept x-api-key + a header that opts in
 * to direct browser access ("anthropic-dangerous-direct-browser-access").
 * Production usage should proxy through a server.
 */
export class AnthropicCloudTransport implements AgentTransport {
  readonly id = "anthropic-cloud" as const;
  readonly label = "Anthropic Cloud";

  constructor(private readonly settings: TransportSettings) {}

  async isReady(): Promise<boolean> {
    return Boolean(this.settings.anthropicApiKey);
  }

  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const apiKey = this.settings.anthropicApiKey;
    if (!apiKey) {
      yield {
        type: "error",
        message:
          "No Anthropic API key configured. Open the extension options and paste a key.",
      };
      return;
    }

    const model = this.settings.anthropicModel ?? DEFAULT_SETTINGS.anthropicModel;
    const system = buildSystem(req);

    const body = {
      model,
      max_tokens: req.options?.maxTokens ?? 4096,
      temperature: req.options?.temperature ?? 1,
      system,
      stream: true,
      messages: req.messages.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      })),
    };

    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { type: "error", message: `Network error: ${(err as Error).message}` };
      return;
    }

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      yield {
        type: "error",
        message: `Anthropic API ${resp.status}: ${text.slice(0, 500)}`,
      };
      return;
    }

    yield* parseSSE(resp.body, signal);
  }
}

function buildSystem(req: ChatRequest): string {
  const parts: string[] = [];
  if (req.system) parts.push(req.system);
  if (req.contextBlocks?.length) {
    parts.push("# Context from the current GitHub page\n");
    for (const block of req.contextBlocks) {
      parts.push(`## ${block.label}\n\n${block.body}\n`);
    }
  }
  return parts.join("\n");
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let lineBreak = buffer.indexOf("\n\n");
      while (lineBreak !== -1) {
        const rawEvent = buffer.slice(0, lineBreak);
        buffer = buffer.slice(lineBreak + 2);
        const ev = parseEvent(rawEvent);
        if (ev) yield ev;
        lineBreak = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "done" };
}

function parseEvent(raw: string): StreamEvent | null {
  // Anthropic SSE: alternating "event: <name>" and "data: <json>" lines.
  let dataLine = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) dataLine = line.slice(5).trim();
  }
  if (!dataLine) return null;
  try {
    const parsed = JSON.parse(dataLine);
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
      return { type: "delta", text: parsed.delta.text as string };
    }
    if (parsed.type === "message_stop") {
      return { type: "done" };
    }
    if (parsed.type === "error") {
      return { type: "error", message: parsed.error?.message ?? "Unknown error" };
    }
  } catch {
    /* malformed line, skip */
  }
  return null;
}
