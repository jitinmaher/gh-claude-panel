/**
 * Shared wire-protocol types between the extension and the bridge.
 * Keep this file pure types — no runtime deps — so the extension TS could
 * import it later without bringing in Node.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  system?: string;
  contextBlocks?: { label: string; body: string }[];
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export type ClientMsg =
  | { type: "auth"; token: string }
  | { type: "chat"; adapter: "claude" | "cursor"; request: ChatRequest }
  | { type: "cancel" };

export type ServerMsg =
  | { type: "ready" }
  | { type: "delta"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "error"; message: string }
  | { type: "done"; usage?: { inputTokens?: number; outputTokens?: number } };
