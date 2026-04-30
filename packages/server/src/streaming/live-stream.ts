/**
 * LiveRequestStream — bridges ResponseEmitter events to a ReadableStream for SSE transport.
 *
 * When the ResponseEmitter emits an event via its onEvent callback, the event is
 * SSE-encoded and enqueued to the ReadableStream controller. The SSE endpoint returns
 * the readable side as the Response body — delivering events to the client in real-time.
 */
import type { RequestStreamEventWithId } from "./response-emitter";
import { encodeStreamEvent } from "./encode-event";
import {
  createInternalResponseEmitter,
  ResponseEmitter
} from "./response-emitter";
import type { InternalStreamingSeams } from "./internal/seams";
import { createClientEventFilter } from "./client-filter";
import { injectHeartbeat } from "./heartbeat";

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
   * the readable stream emits periodic `: ping\n\n` comment frames to keep
   * proxies/load balancers from closing idle connections and to give
   * clients a wire-level signal for inactivity watchdogs. When 0, undefined,
   * or negative, the stream is returned unwrapped.
   */
  sseHeartbeatMs?: number;
};

const encoder = new TextEncoder();

/**
 * Creates a LiveRequestStream that bridges a ResponseEmitter to a ReadableStream.
 *
 * The emitter's onEvent callback SSE-encodes each event and enqueues it to the
 * stream controller. The readable side can be returned directly as an SSE Response body.
 */
export function createLiveRequestStream(
  options: CreateLiveRequestStreamOptions
): LiveRequestStream {
  const { requestId } = options;

  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;

  const rawReadable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    }
  });

  const readable =
    options.sseHeartbeatMs !== undefined && options.sseHeartbeatMs > 0
      ? injectHeartbeat(rawReadable, options.sseHeartbeatMs)
      : rawReadable;

  const shouldForward = createClientEventFilter();

  const onEvent = (event: RequestStreamEventWithId): void => {
    if (closed || controller === undefined) {
      return;
    }

    if (!shouldForward(event)) {
      return;
    }

    try {
      const sseFrame = encodeStreamEvent(event);
      controller.enqueue(encoder.encode(sseFrame));
    } catch (err) {
      console.warn("[flow-state] LiveStream event delivery failed:", err);
      closed = true;
    }
  };

  const emitter = createInternalResponseEmitter({
    requestId,
    maxBufferSize: options.maxBufferSize,
    onEvent,
    internalSeams: options.internalSeams
  });

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    try {
      controller?.close();
    } catch {
      // Controller may already be closed (e.g. client disconnected)
    }
  }

  return {
    requestId,
    emitter,
    readable,
    close
  };
}
