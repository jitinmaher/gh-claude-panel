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
    return bridgeStream("claude", req, this.settings, signal);
  }
}
