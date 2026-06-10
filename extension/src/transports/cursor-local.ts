import { bridgeStream } from "./bridge-ws";
import { AgentTransport, ChatRequest, StreamEvent, TransportSettings } from "./types";

export class CursorLocalTransport implements AgentTransport {
  readonly id = "cursor-local" as const;
  readonly label = "Local Cursor";

  constructor(private readonly settings: TransportSettings) {}

  async isReady(): Promise<boolean> {
    return Boolean(this.settings.bridgeToken);
  }

  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const withModel: ChatRequest = {
      ...req,
      options: {
        ...(req.options ?? {}),
        model: req.options?.model ?? this.settings.anthropicModel,
      },
    };
    return bridgeStream("cursor", withModel, this.settings, signal);
  }
}
