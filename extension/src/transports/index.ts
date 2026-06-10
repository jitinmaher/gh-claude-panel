import { AnthropicCloudTransport } from "./anthropic";
import { ClaudeLocalTransport } from "./claude-local";
import { CursorLocalTransport } from "./cursor-local";
import { AgentTransport, BackendId, DEFAULT_SETTINGS, TransportSettings } from "./types";

export * from "./types";
export * from "./models";

export function makeTransport(
  id: BackendId,
  settings: TransportSettings,
): AgentTransport {
  switch (id) {
    case "anthropic-cloud":
      return new AnthropicCloudTransport(settings);
    case "claude-local":
      return new ClaudeLocalTransport(settings);
    case "cursor-local":
      return new CursorLocalTransport(settings);
  }
}

export const BACKENDS: { id: BackendId; label: string }[] = [
  { id: "anthropic-cloud", label: "Anthropic Cloud" },
  { id: "claude-local", label: "Local Claude Code" },
  { id: "cursor-local", label: "Local Cursor" },
];

export async function loadSettings(): Promise<TransportSettings> {
  const stored = (await chrome.storage.local.get([
    "anthropicApiKey",
    "anthropicModel",
    "bridgeUrl",
    "bridgeToken",
    "defaultBackend",
    "panelLayout",
    "enterpriseHosts",
    "githubToken",
    "appendDraftedBy",
  ])) as TransportSettings;
  return {
    anthropicModel: stored.anthropicModel ?? DEFAULT_SETTINGS.anthropicModel,
    bridgeUrl: stored.bridgeUrl ?? DEFAULT_SETTINGS.bridgeUrl,
    defaultBackend: stored.defaultBackend ?? DEFAULT_SETTINGS.defaultBackend,
    panelLayout: stored.panelLayout ?? DEFAULT_SETTINGS.panelLayout,
    enterpriseHosts: stored.enterpriseHosts ?? [],
    anthropicApiKey: stored.anthropicApiKey,
    bridgeToken: stored.bridgeToken,
    githubToken: stored.githubToken,
    appendDraftedBy: stored.appendDraftedBy ?? DEFAULT_SETTINGS.appendDraftedBy,
  };
}

export async function saveSettings(patch: Partial<TransportSettings>): Promise<void> {
  await chrome.storage.local.set(patch);
}
