/**
 * SSE stream readers for request, session and user streams.
 *
 * The openers here take a resolved URL and the fetcher of the client that
 * opens them: `createClient` is their only caller, so every stream goes
 * through the one transport a client holds. `createSSEClientFromResponse` is
 * the pure reader for a stream a POST already returned (inline streaming).
 */
import { toError } from "@flow-state-dev/contracts/helpers";
import type {
  RequestStreamEvent,
  SessionStreamEvent,
  UserStreamEvent
} from "@flow-state-dev/core/items";
import type {
  ClientFetch,
  RequestSSECallbacks,
  RequestStreamHandle,
  SessionSSECallbacks,
  SessionStreamHandle,
  UserSSECallbacks,
  UserStreamHandle
} from "../types";
import { ClientHttpError } from "../types";

/** Where an opener connects, and through what: the opening client's transport. */
type StreamTarget = {
  fetcher: ClientFetch;
  /** The stream's URL, query included. */
  url: string;
};

/** Resume options a request or user stream takes. */
export type StreamResumeOptions = {
  /** Resume after this event id (sent as `Last-Event-ID`). Ignored when `startingAfter` is set. */
  lastEventId?: string;
  /** Resume after this sequence number. */
  startingAfter?: number;
  /** How many recent event keys are remembered to drop a duplicate. Default 1000. */
  dedupWindowSize?: number;
};

type Frame = {
  id?: string;
  event?: string;
  data?: string;
  /** True when the frame contained only SSE comment lines (`: ...`). */
  comment?: boolean;
};

const DEFAULT_DEDUP_WINDOW_SIZE = 1000;

function createSlidingEventDeduper(windowSize: number): {
  seen: (key: string) => boolean;
  clear: () => void;
} {
  const boundedWindow = Number.isFinite(windowSize)
    ? Math.max(1, Math.floor(windowSize))
    : DEFAULT_DEDUP_WINDOW_SIZE;
  const order: string[] = [];
  const values = new Set<string>();

  return {
    seen: (key: string): boolean => {
      if (values.has(key)) {
        return true;
      }

      values.add(key);
      order.push(key);

      while (order.length > boundedWindow) {
        const oldest = order.shift();
        if (oldest !== undefined) {
          values.delete(oldest);
        }
      }

      return false;
    },
    clear: (): void => {
      order.length = 0;
      values.clear();
    }
  };
}

/**
 * Options for creating an SSE client from a pre-fetched Response (inline streaming).
 * Used when the POST action response itself is the SSE stream.
 */
export type CreateSSEClientFromResponseOptions = RequestSSECallbacks & {
  response: Response;
  dedupWindowSize?: number;
};

/**
 * Creates a request-stream SSE client from an existing Response object.
 * Used for inline streaming where the POST action response returns SSE directly
 * instead of a 202 JSON response. This eliminates the need for a separate GET
 * stream connection — essential on serverless platforms where POST and GET may
 * hit different instances.
 */
export function createSSEClientFromResponse(
  options: CreateSSEClientFromResponseOptions
): RequestStreamHandle {
  const controller = new AbortController();
  const deduper = createSlidingEventDeduper(
    options.dedupWindowSize ?? DEFAULT_DEDUP_WINDOW_SIZE
  );
  let closed = false;
  let errored = false;
  let lastEventId: string | undefined;

  if (!options.response.ok) {
    const error = new ClientHttpError(
      `SSE response failed (${options.response.status}) ${options.response.statusText || ""}`.trim(),
      { status: options.response.status, body: undefined }
    );
    queueMicrotask(() => options.onError?.(error));
    return {
      close: () => {},
      get lastEventId() { return undefined; }
    };
  }

  void consumeSSEResponse({
    response: options.response,
    signal: controller.signal,
    onFrame: (frame) => {
      if (closed) return;
      if (frame.comment === true) {
        options.onHeartbeat?.();
        return;
      }
      if (frame.id !== undefined) lastEventId = frame.id;
      if (frame.data === undefined) return;
      try {
        const parsed = JSON.parse(frame.data) as RequestStreamEvent;
        const key = requestEventKey(parsed);
        if (deduper.seen(key)) return;
        dispatchRequestEvent(parsed, options);
      } catch (error) {
        errored = true;
        options.onError?.(toError(error, "Unknown SSE client error"));
      }
    },
    onError: (error) => {
      if (closed) return;
      errored = true;
      options.onError?.(error);
    }
  }).then(() => {
    // The body ended without an abort (local close()) or an error — e.g. the
    // server closed the connection after a pre-transition failure with no
    // terminal request-status event. A caller relying solely on
    // onRequestStatus/onError to know the stream is done would otherwise
    // never find out.
    if (!closed && !errored) options.onClose?.();
  });

  return {
    close: () => {
      if (closed) return;
      closed = true;
      deduper.clear();
      controller.abort();
    },
    get lastEventId() {
      return lastEventId;
    }
  };
}

/**
 * Opens a request stream: parses frames and dispatches typed callbacks.
 * Internal; `request.stream()` is the public way in.
 */
export function openRequestStream(
  target: StreamTarget,
  options: RequestSSECallbacks & StreamResumeOptions
): RequestStreamHandle {
  const { fetcher, url } = target;
  const controller = new AbortController();
  const deduper = createSlidingEventDeduper(
    options.dedupWindowSize ?? DEFAULT_DEDUP_WINDOW_SIZE
  );
  let closed = false;
  let lastEventId = options.lastEventId;

  void consumeSSE({
    fetcher,
    url,
    signal: controller.signal,
    headers:
      lastEventId === undefined || options.startingAfter !== undefined
        ? undefined
        : {
            "last-event-id": lastEventId
          },
    onFrame: (frame) => {
      if (closed) {
        return;
      }

      if (frame.comment === true) {
        options.onHeartbeat?.();
        return;
      }

      if (frame.id !== undefined) {
        lastEventId = frame.id;
      }

      if (frame.data === undefined) {
        return;
      }

      try {
        const parsed = JSON.parse(frame.data) as RequestStreamEvent;
        const key = requestEventKey(parsed);
        if (deduper.seen(key)) {
          return;
        }

        dispatchRequestEvent(parsed, options);
      } catch (error) {
        options.onError?.(toError(error, "Unknown SSE client error"));
      }
    },
    onError: (error) => {
      if (!closed) {
        options.onError?.(error);
      }
    }
  });

  return {
    close: () => {
      if (closed) {
        return;
      }

      closed = true;
      deduper.clear();
      controller.abort();
    },
    get lastEventId() {
      return lastEventId;
    }
  };
}

/**
 * Opens the user stream for optional capability-gated updates.
 * Internal; `client.stream()` is the public way in.
 */
export function openUserStream(
  target: StreamTarget,
  options: UserSSECallbacks & StreamResumeOptions
): UserStreamHandle {
  const { fetcher, url } = target;
  const controller = new AbortController();
  const deduper = createSlidingEventDeduper(
    options.dedupWindowSize ?? DEFAULT_DEDUP_WINDOW_SIZE
  );
  let closed = false;
  let lastEventId = options.lastEventId;

  void consumeSSE({
    fetcher,
    url,
    signal: controller.signal,
    headers:
      lastEventId === undefined || options.startingAfter !== undefined
        ? undefined
        : {
            "last-event-id": lastEventId
          },
    onFrame: (frame) => {
      if (closed) {
        return;
      }

      if (frame.id !== undefined) {
        lastEventId = frame.id;
      }

      if (frame.data === undefined) {
        return;
      }

      try {
        const parsed = JSON.parse(frame.data) as UserStreamEvent;
        const key = userEventKey(parsed);
        if (deduper.seen(key)) {
          return;
        }

        dispatchUserEvent(parsed, options);
      } catch (error) {
        options.onError?.(toError(error, "Unknown SSE client error"));
      }
    },
    onError: (error) => {
      if (!closed) {
        options.onError?.(error);
      }
    }
  });

  return {
    close: () => {
      if (closed) {
        return;
      }

      closed = true;
      deduper.clear();
      controller.abort();
    },
    get lastEventId() {
      return lastEventId;
    }
  };
}

/**
 * Configuration for following a whole session over
 * `GET /api/flows/sessions/:sessionId/stream`.
 */
export type SessionStreamOptions = SessionSSECallbacks & {
    /**
     * A server time to start from: one an earlier connection heard
     * (`handle.lastAt`), or the session snapshot's `at` when the stream follows a
     * snapshot. The server's first read reaches a few seconds before it.
     * Omitted, it reaches back about a minute.
     */
    since?: number;
    /**
     * The session snapshot's `sessionCreatedAt`, when the stream follows a
     * snapshot. Every connection then follows that session only: once its id
     * holds another session, the server answers 404 and the client stops.
     */
    sessionCreatedAt?: number;
    /** The session snapshot's type filter, so the stream sends what the snapshot shows. */
    itemTypes?: string[];
    /** Reconnect backoff: `initialDelayMs` (default 1000) doubling to `maxDelayMs` (default 30000). */
    retry?: { initialDelayMs?: number; maxDelayMs?: number };
};

/**
 * Answers that mean the stream is not there for this caller: refused, absent,
 * not built, or (409) a session kept before records named their owner, which
 * stays refused until it is migrated. Retrying cannot change them.
 */
const SESSION_STREAM_STOP_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 409, 501]);

/**
 * Follow a whole session (internal; `client.sessions.stream()` is the public
 * way in): every finished item any request in it keeps, and a
 * notice whenever its unfinished runs change.
 *
 * The connection is expected to drop: the network, a host's time limit, the
 * server's own close after at most 15 minutes. Each time, the client
 * reconnects with backoff and hands back the last server time it heard, so
 * nothing kept in between is missed; `onReconnecting` says each try is coming,
 * and how many there have been since the stream last delivered. The stream starts a few seconds before
 * `since`, so an item can arrive again: across a reconnect, or when the
 * snapshot that gave `since` already held it. An item a request emits more
 * than once under one id arrives once per emission. Tell items apart by
 * `requestId` and `item.id` and keep the copy that sorts later by
 * `compareItemOrder`.
 *
 * A 401, 403, 404, 409 or 501 stops the client for good, quietly: `onStop`
 * fires, `onError` does not, and nothing is retried.
 */
export function openSessionStream(
  target: {
    fetcher: ClientFetch;
    /** The stream's URL for one connection: the opener adds the query. */
    url: (query: { since?: number; session_created_at?: number; item_types?: string }) => string;
  },
  options: SessionStreamOptions
): SessionStreamHandle {
  const { fetcher } = target;
  const initialDelayMs = options.retry?.initialDelayMs ?? 1_000;
  const maxDelayMs = options.retry?.maxDelayMs ?? 30_000;
  const itemTypes =
    options.itemTypes === undefined || options.itemTypes.length === 0
      ? undefined
      : options.itemTypes.join(",");
  let lastAt = options.since;
  let stopped = false;
  let attempt = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reconnectLater = (): void => {
    if (stopped) return;
    const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, delay);
    options.onReconnecting?.({ attempt });
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    const current = new AbortController();
    controller = current;
    try {
      const response = await fetcher(
        target.url({ since: lastAt, session_created_at: options.sessionCreatedAt, item_types: itemTypes }),
        { method: "GET", headers: { accept: "text/event-stream" }, signal: current.signal }
      );
      if (SESSION_STREAM_STOP_STATUSES.has(response.status)) {
        void response.body?.cancel().catch(() => {});
        stopped = true;
        options.onStop?.({ status: response.status });
        return;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
      } else {
        await readSSEBody({
          response,
          signal: current.signal,
          onFrame: (frame) => {
            if (stopped || frame.data === undefined) return;
            let event: SessionStreamEvent;
            try {
              event = JSON.parse(frame.data) as SessionStreamEvent;
            } catch (error) {
              options.onError?.(toError(error, "Unparseable session stream event"));
              return;
            }
            lastAt = event.at;
            attempt = 0;
            dispatchSessionEvent(event, options);
          }
        });
      }
    } catch (error) {
      if (stopped || isAbortError(error)) return;
      // A dropped connection is expected; reconnect below.
    }
    reconnectLater();
  };

  void connect();

  return {
    close: () => {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      controller?.abort();
    },
    get lastAt() {
      return lastAt;
    },
    get stopped() {
      return stopped;
    }
  };
}

/**
 * Reads SSE frames from a Response body. Shared by both the GET SSE client
 * and the inline streaming (POST response) client.
 */
async function readSSEBody(options: {
  response: Response;
  signal: AbortSignal;
  onFrame: (frame: Frame) => void;
}): Promise<void> {
  if (options.response.body === null) {
    const text = await options.response.text();
    for (const frame of parseFrames(text)) {
      options.onFrame(frame);
    }
    return;
  }

  const reader = options.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Abort listener to cancel the reader when the handle is closed.
  const onAbort = () => { reader.cancel().catch(() => {}); };
  options.signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      const split = splitCompleteFrames(buffer);
      buffer = split.remainder;

      for (const frameText of split.frames) {
        for (const frame of parseFrames(frameText)) {
          options.onFrame(frame);
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      for (const frame of parseFrames(buffer)) {
        options.onFrame(frame);
      }
    }
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Consumes SSE from a pre-fetched Response (inline streaming from POST).
 */
async function consumeSSEResponse(options: {
  response: Response;
  signal: AbortSignal;
  onFrame: (frame: Frame) => void;
  onError: (error: Error) => void;
}): Promise<void> {
  try {
    await readSSEBody(options);
  } catch (error) {
    if (isAbortError(error)) return;
    options.onError(toError(error, "Unknown SSE client error"));
  }
}

async function consumeSSE(options: {
  fetcher: ClientFetch;
  url: string;
  signal: AbortSignal;
  headers?: Record<string, string>;
  onFrame: (frame: Frame) => void;
  onError: (error: Error) => void;
}): Promise<void> {
  try {
    const response = await options.fetcher(options.url, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        ...(options.headers ?? {})
      },
      signal: options.signal
    });

    if (!response.ok) {
      throw new ClientHttpError(
        `SSE request failed (${response.status}) ${response.statusText || ""}`.trim(),
        { status: response.status, body: await response.text().catch(() => undefined) }
      );
    }

    await readSSEBody({
      response,
      signal: options.signal,
      onFrame: options.onFrame
    });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    options.onError(toError(error, "Unknown SSE client error"));
  }
}

function splitCompleteFrames(value: string): {
  frames: string[];
  remainder: string;
} {
  const normalized = value.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  if (parts.length === 0) {
    return {
      frames: [],
      remainder: normalized
    };
  }

  return {
    frames: parts.slice(0, -1),
    remainder: parts[parts.length - 1]
  };
}

function parseFrames(value: string): Frame[] {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const blocks = normalized.split(/\n\n+/g);
  const frames: Frame[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const frame: Frame = {};
    const dataLines: string[] = [];
    let sawComment = false;
    let sawNonComment = false;

    for (const line of lines) {
      if (line.startsWith(":")) {
        sawComment = true;
        continue;
      }

      const separatorIndex = line.indexOf(":");
      const key = separatorIndex < 0 ? line : line.slice(0, separatorIndex);
      const rawValue = separatorIndex < 0 ? "" : line.slice(separatorIndex + 1);
      const valuePart = rawValue.startsWith(" ")
        ? rawValue.slice(1)
        : rawValue;

      if (key === "id") {
        frame.id = valuePart;
        sawNonComment = true;
      } else if (key === "event") {
        frame.event = valuePart;
        sawNonComment = true;
      } else if (key === "data") {
        dataLines.push(valuePart);
        sawNonComment = true;
      }
    }

    if (dataLines.length > 0) {
      frame.data = dataLines.join("\n");
    }

    if (frame.id !== undefined || frame.event !== undefined || frame.data !== undefined) {
      frames.push(frame);
    } else if (sawComment && !sawNonComment) {
      // Comment-only frame (SSE heartbeat: `: ping\n\n`).
      frames.push({ comment: true });
    }
  }

  return frames;
}

function requestEventKey(event: RequestStreamEvent): string {
  return `${event.stream}:${event.requestId}:${event.sequence_number}`;
}

function userEventKey(event: UserStreamEvent): string {
  return `${event.stream}:${event.userId}:${event.sequence_number}`;
}

function dispatchRequestEvent(
  event: RequestStreamEvent,
  callbacks: RequestSSECallbacks
): void {
  callbacks.onEvent?.(event);

  if (event.type === "request.created") {
    callbacks.onRequestCreated?.(event);
    return;
  }

  if (
    event.type === "request.in_progress" ||
    event.type === "request.completed" ||
    event.type === "request.incomplete" ||
    event.type === "request.failed" ||
    event.type === "request.suspended" ||
    event.type === "request.interrupted" ||
    event.type === "request.aborted"
  ) {
    callbacks.onRequestStatus?.(event);
    return;
  }

  if (event.type === "item.added") {
    callbacks.onItemAdded?.(event);
    return;
  }

  if (event.type === "item.done") {
    callbacks.onItemDone?.(event);
    return;
  }

  if (event.type === "item.updated") {
    callbacks.onItemUpdated?.(event);
    return;
  }

  if (event.type === "content.added") {
    callbacks.onContentAdded?.(event);
    return;
  }

  if (event.type === "content.delta") {
    callbacks.onContentDelta?.(event);
    return;
  }

  if (event.type === "content.audio.delta") {
    callbacks.onContentAudioDelta?.(event);
    return;
  }

  if (event.type === "content.done") {
    callbacks.onContentDone?.(event);
    return;
  }

  if (event.type === "resource.changed") {
    callbacks.onResourceChanged?.(event);
    return;
  }

  if (event.type === "session.metadata.changed") {
    callbacks.onSessionMetadataChanged?.(event);
    return;
  }

  if (event.type === "debug") {
    callbacks.onDebug?.(event);
  }
}

function dispatchUserEvent(event: UserStreamEvent, callbacks: UserSSECallbacks): void {
  callbacks.onEvent?.(event);

  if (event.type === "resource.changed") {
    callbacks.onResourceChanged?.(event);
    return;
  }

  if (event.type === "scope.state.changed") {
    callbacks.onScopeStateChanged?.(event);
    return;
  }

  if (event.type === "debug") {
    callbacks.onDebug?.(event);
  }
}

function dispatchSessionEvent(
  event: SessionStreamEvent,
  callbacks: SessionSSECallbacks
): void {
  callbacks.onEvent?.(event);
  if (event.type === "session.item") {
    callbacks.onItem?.(event);
    return;
  }
  if (event.type === "session.runs") {
    callbacks.onRuns?.(event);
  }
}

function isAbortError(value: unknown): boolean {
  return (
    value instanceof DOMException && value.name === "AbortError"
  ) || (value instanceof Error && value.name === "AbortError");
}
