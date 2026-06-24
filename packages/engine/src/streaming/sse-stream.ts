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
}

/**
 * Creates an SSE stream backed by a `TransformStream`. The returned handle
 * exposes a `readable` for transport and write helpers for producers. The
 * heartbeat timer (if enabled) is owned by the handle — it stops on close,
 * abort, or the first failed write.
 */
export function createSSEStream(opts: CreateSSEStreamOptions = {}): SSEStreamHandle {
  const transform = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transform.writable.getWriter();

  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function cleanup(): void {
    if (closed) return;
    closed = true;
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
