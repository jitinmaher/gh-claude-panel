/**
 * The contract every backend must satisfy.
 *
 * UI consumes streamed deltas via an async iterator regardless of which
 * backend is active. Cancellation goes through AbortSignal.
 */

export type BackendId = "anthropic-cloud" | "claude-local" | "cursor-local";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  system?: string;
  /** Anything we want the model to know about the PR (diff, file list, etc.). */
  contextBlocks?: { label: string; body: string }[];
  /** Free-form options that backends can interpret as they like. */
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "error"; message: string }
  | { type: "done"; usage?: { inputTokens?: number; outputTokens?: number } };

export interface AgentTransport {
  readonly id: BackendId;
  readonly label: string;
  /** True if the user has configured what's needed (API key, token, etc.). */
  isReady(): Promise<boolean>;
  /** Stream a chat completion. Throws on fatal errors before stream starts. */
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface TransportSettings {
  anthropicApiKey?: string;
  anthropicModel?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
  defaultBackend?: BackendId;
}

export const DEFAULT_SETTINGS: Required<
  Pick<TransportSettings, "anthropicModel" | "bridgeUrl" | "defaultBackend">
> = {
  anthropicModel: "claude-sonnet-4-6",
  bridgeUrl: "ws://127.0.0.1:7321",
  defaultBackend: "anthropic-cloud",
};
