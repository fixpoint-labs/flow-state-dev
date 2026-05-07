/**
 * LiveRequestStream — bridges `ResponseEmitter` events to an SSE-shaped
 * `ReadableStream` for transport. Each emitted event is encoded and written
 * to the underlying `SSEStreamHandle`; the handle owns frame serialization,
 * the heartbeat timer, and lifecycle.
 */
import type { RequestStreamEventWithId } from "./response-emitter";
import { encodeStreamEvent } from "./encode-event";
import {
  createInternalResponseEmitter,
  ResponseEmitter
} from "./response-emitter";
import type { InternalStreamingSeams } from "./internal/seams";
import { createClientEventFilter } from "./client-filter";
import { createSSEStream } from "./sse-stream";

export type LiveRequestStream = {
  readonly requestId: string;
  readonly emitter: ResponseEmitter;
  readonly readable: ReadableStream<Uint8Array>;
  close(): void;
};

export type CreateLiveRequestStreamOptions = {
  requestId: string;
  maxBufferSize?: number;
  internalSeams?: InternalStreamingSeams;
  /**
   * SSE heartbeat interval in milliseconds. When set to a positive number,
   * the stream emits periodic `: ping\n\n` comment frames so proxies / load
   * balancers don't close the idle connection and clients have a wire-level
   * inactivity signal. `0`, `undefined`, or a non-positive value disables
   * the heartbeat.
   */
  sseHeartbeatMs?: number;
};

/**
 * Creates a LiveRequestStream that bridges a `ResponseEmitter` to an
 * SSE-shaped readable stream. Events that pass the client-visible filter are
 * forwarded to the underlying handle; trace items are dropped at this layer.
 */
export function createLiveRequestStream(
  options: CreateLiveRequestStreamOptions
): LiveRequestStream {
  const { requestId } = options;

  const handle = createSSEStream({
    pingIntervalMs: options.sseHeartbeatMs
  });

  const shouldForward = createClientEventFilter();

  const onEvent = (event: RequestStreamEventWithId): void => {
    if (handle.closed) {
      return;
    }
    if (!shouldForward(event)) {
      return;
    }
    handle.writeRaw(encodeStreamEvent(event));
  };

  const emitter = createInternalResponseEmitter({
    requestId,
    maxBufferSize: options.maxBufferSize,
    onEvent,
    internalSeams: options.internalSeams
  });

  return {
    requestId,
    emitter,
    readable: handle.readable,
    close: () => handle.close()
  };
}
