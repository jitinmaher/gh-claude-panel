import { bridgeStream } from "./bridge-ws";
import { AgentTransport, ChatRequest, StreamEvent, TransportSettings } from "./types";

export class ClaudeLocalTransport implements AgentTransport {
  readonly id = "claude-local" as const;
  readonly label = "Local Claude Code";

  constructor(private readonly settings: TransportSettings) {}

  async isReady(): Promise<boolean> {
    return Boolean(this.settings.bridgeToken);
  }

  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    // Forward the user's chosen model from settings so the bridge can pass
    // it to `claude --model <id>`. Keep any caller-supplied options too.
    const withModel: ChatRequest = {
      ...req,
      options: {
        ...(req.options ?? {}),
        model: req.options?.model ?? this.settings.anthropicModel,
      },
    };
    return bridgeStream("claude", withModel, this.settings, signal);
  }
}
