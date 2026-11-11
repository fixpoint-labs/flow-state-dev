/**
 * Single SSE stream primitive used by both the in-flight live path and the
 * late-attach reconnect path. Wraps a `TransformStream` so the writable
 * side is a pull-friendly surface (`writeFrame` / `writeRaw` /
 * `writeComment`) and the readable side plugs straight into a `Response`.
 *
 * The unified primitive replaces three code paths that previously hand-built
 * `ReadableStream` controllers and a separate heartbeat wrapper.
 */
import { serializeSSEFrame, type SSEFrame } from "./sse";

const encoder = new TextEncoder();
const PING_FRAME = encoder.encode(": ping\n\n");

/**
 * Default ceiling on the bytes a stream holds that its reader has not taken
 * yet. 4 MiB is sixteen records at the emitter's default 256 KiB record limit
 * (`maxRecordedValueBytes`): far more than a reader that keeps up ever has
 * waiting, and small enough that a stream nobody reads costs little.
 */
export const DEFAULT_MAX_BUFFERED_SSE_BYTES = 4 * 1024 * 1024;

/**
 * Writable surface over an SSE-shaped readable stream.
 */
export interface SSEStreamHandle {
  /** Readable side — suitable as a `Response` body. */
  readonly readable: ReadableStream<Uint8Array>;
  /** Whether the writable side has been closed (locally or via abort). */
  readonly closed: boolean;
  /** Serialize an `SSEFrame` and enqueue it on the wire. */
  writeFrame(frame: SSEFrame): void;
  /**
   * Enqueue a pre-encoded SSE chunk (already in `id:.../event:.../data:...\n\n`
   * form). Used by callers that already have an encoded frame string in hand
   * — e.g. event encoders that share serialization with the completed-request
   * flat-string replay path.
   */
  writeRaw(text: string): void;
  /** Enqueue a `: <text>\n\n` comment frame. */
  writeComment(text: string): void;
  /** Close the writable side; idempotent. */
  close(): void;
  /**
   * Settles once the stream has closed: locally, by abort, by a failed write,
   * or because the reader cancelled it, which is noticed at once rather than
   * at the next write.
   */
  readonly whenClosed: Promise<void>;
}

export interface CreateSSEStreamOptions {
  /**
   * Heartbeat cadence in milliseconds. The stream emits `: ping\n\n` comment
   * frames at this interval to keep proxies and load balancers from closing
   * idle connections. `0`, `undefined`, or a non-finite value disables the
   * heartbeat.
   */
  pingIntervalMs?: number;
  /**
   * When this signal aborts, the stream closes. The signal aborts the wire
   * only — it is the caller's responsibility to decide whether to propagate
   * the abort into any in-flight request execution. (Wire-only abort is the
   * intentional default; see `docs/architecture/streaming.md`.)
   */
  signal?: AbortSignal;
  /**
   * Most bytes the stream holds that its reader has not taken yet. A write
   * that would pass it ends the stream instead: what was already written is
   * delivered, then the stream closes. A reader of a request stream that
   * falls this far behind resumes from its last sequence number (see
   * `docs/architecture/streaming.md`). One frame is always taken onto an
   * empty stream, however large. Default
   * {@link DEFAULT_MAX_BUFFERED_SSE_BYTES}; `Infinity` disables the bound.
   */
  maxBufferedBytes?: number;
}

/**
 * Creates an SSE stream backed by a `TransformStream`. The returned handle
 * exposes a `readable` for transport and write helpers for producers. The
 * heartbeat timer (if enabled) is owned by the handle — it stops on close,
 * abort, or the first failed write.
 */
export function createSSEStream(opts: CreateSSEStreamOptions = {}): SSEStreamHandle {
  const maxBufferedBytes = opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_SSE_BYTES;
  // Counted in bytes, so the writer's `desiredSize` is the bound less what the
  // reader has not taken yet (the readable side holds nothing past that).
  const transform = new TransformStream<Uint8Array, Uint8Array>(
    undefined,
    Number.isFinite(maxBufferedBytes)
      ? new ByteLengthQueuingStrategy({ highWaterMark: maxBufferedBytes })
      : undefined
  );
  const writer = transform.writable.getWriter();

  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let settleClosed!: () => void;
  const whenClosed = new Promise<void>((resolve) => (settleClosed = resolve));

  function cleanup(): void {
    if (closed) return;
    closed = true;
    settleClosed();
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    void writer.close().catch(() => {
      // Already cancelled by the consumer or errored — nothing to do.
    });
  }

  function tryWrite(chunk: Uint8Array): void {
    if (closed) return;
    if (Number.isFinite(maxBufferedBytes)) {
      const spare = writer.desiredSize ?? 0;
      // Something is waiting and this would pass the bound: end the stream.
      if (spare < maxBufferedBytes && chunk.byteLength > spare) {
        cleanup();
        return;
      }
    }
    // Multiple in-flight writes can each reject if the consumer cancels;
    // `cleanup` is idempotent (`if (closed) return`) so duplicate calls
    // from racing rejections are safe.
    void writer.write(chunk).catch(() => {
      cleanup();
    });
  }

  if (
    opts.pingIntervalMs !== undefined &&
    Number.isFinite(opts.pingIntervalMs) &&
    opts.pingIntervalMs > 0
  ) {
    timer = setInterval(() => {
      tryWrite(PING_FRAME);
    }, opts.pingIntervalMs);
  }

  // A reader that cancels errors the writable side: close now, not at the
  // next write, so a producer that only writes now and then lets go at once.
  writer.closed.catch(() => cleanup());

  if (opts.signal !== undefined) {
    if (opts.signal.aborted) {
      cleanup();
    } else {
      opts.signal.addEventListener("abort", cleanup, { once: true });
    }
  }

  return {
    readable: transform.readable,
    get closed(): boolean {
      return closed;
    },
    whenClosed,
    writeFrame(frame: SSEFrame): void {
      tryWrite(encoder.encode(serializeSSEFrame(frame)));
    },
    writeRaw(text: string): void {
      tryWrite(encoder.encode(text));
    },
    writeComment(text: string): void {
      tryWrite(encoder.encode(`: ${text}\n\n`));
    },
    close(): void {
      cleanup();
    }
  };
}
