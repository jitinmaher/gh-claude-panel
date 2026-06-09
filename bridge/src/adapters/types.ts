import { ChatRequest, ServerMsg } from "../protocol";

export interface Adapter {
  /** Streams ServerMsg events. Yields {type:"done"} when finished. */
  run(req: ChatRequest, abort: AbortSignal): AsyncIterable<ServerMsg>;
}
