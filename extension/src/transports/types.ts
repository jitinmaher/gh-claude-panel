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

/**
 * Where the panel iframe sits on the host page.
 *
 * - `docked`: full-height bar on the left or right edge. `width` is in CSS px,
 *   clamped 300..800 by the content script.
 * - `floating`: window with rounded corners and a drop shadow. `left/top` are
 *   viewport coordinates (px); `width/height` are the panel's size.
 *
 * Persisted across tabs via chrome.storage.local; restored on every mount.
 */
export type PanelLayout =
  | { mode: "docked"; side: "left" | "right"; width: number }
  | { mode: "floating"; left: number; top: number; width: number; height: number };

export interface TransportSettings {
  anthropicApiKey?: string;
  anthropicModel?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
  defaultBackend?: BackendId;
  panelLayout?: PanelLayout;
  /**
   * User-added GitHub Enterprise hostnames. Bare hostnames, no scheme.
   * Each one must have a matching chrome.permissions grant — the options
   * page calls chrome.permissions.request() before adding to this list.
   */
  enterpriseHosts?: string[];
  /**
   * Optional GitHub Personal Access Token. Used only when fetching diffs
   * via the GitHub REST API — public repos work without one within the
   * 60-req/hr unauthenticated rate limit; private repos need this set.
   * Scope required: `repo:read` (or fine-grained equivalent: read access
   * to pull request metadata).
   */
  githubToken?: string;
  /**
   * When true, every inserted review comment gets a small markdown
   * footer linking back to this extension. Defaults to true — leave on
   * to give reviewers a visible signal that the comment is AI-drafted.
   * Turn off for a stealthier experience.
   */
  appendDraftedBy?: boolean;
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  mode: "docked",
  side: "right",
  width: 420,
};

export const DEFAULT_SETTINGS: Required<
  Pick<
    TransportSettings,
    | "anthropicModel"
    | "bridgeUrl"
    | "defaultBackend"
    | "panelLayout"
    | "appendDraftedBy"
  >
> = {
  anthropicModel: "claude-sonnet-4-6",
  bridgeUrl: "ws://127.0.0.1:7321",
  defaultBackend: "anthropic-cloud",
  panelLayout: DEFAULT_PANEL_LAYOUT,
  appendDraftedBy: true,
};
