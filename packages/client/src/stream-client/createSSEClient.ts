/**
 * SSE stream clients for request and optional user stream consumption.
 */
import type {
  RequestStreamEvent,
  UserStreamEvent
} from "@flow-state-dev/core/items";
import { buildFlowApiUrl, resolveFetch } from "../internal/http";
import type {
  ClientFetch,
  RequestSSECallbacks,
  RequestStreamHandle,
  UserSSECallbacks,
  UserStreamHandle
} from "../types";

/**
 * Configuration for canonical request-stream SSE client creation.
 */
export type CreateSSEClientOptions = RequestSSECallbacks & {
  url: string;
  baseUrl?: string;
  fetcher?: ClientFetch;
  lastEventId?: string;
  startingAfter?: number;
  dedupWindowSize?: number;
};

/**
 * Configuration for optional user-stream SSE client creation.
 */
export type CreateUserSSEClientOptions = UserSSECallbacks & {
  url: string;
  baseUrl?: string;
  fetcher?: ClientFetch;
  lastEventId?: string;
  startingAfter?: number;
  dedupWindowSize?: number;
};

type Frame = {
  id?: string;
  event?: string;
  data?: string;
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
 * Creates a request-stream SSE client that parses frames and dispatches typed callbacks.
 */
export function createSSEClient(options: CreateSSEClientOptions): RequestStreamHandle {
  const fetcher = resolveFetch(options.fetcher);
  const controller = new AbortController();
  const deduper = createSlidingEventDeduper(
    options.dedupWindowSize ?? DEFAULT_DEDUP_WINDOW_SIZE
  );
  let closed = false;
  let lastEventId = options.lastEventId;

  const url = buildFlowApiUrl({
    baseUrl: options.baseUrl,
    path: options.url,
    query:
      options.startingAfter === undefined
        ? undefined
        : {
            starting_after: options.startingAfter
          }
  });

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
        const parsed = JSON.parse(frame.data) as RequestStreamEvent;
        const key = requestEventKey(parsed);
        if (deduper.seen(key)) {
          return;
        }

        dispatchRequestEvent(parsed, options);
      } catch (error) {
        options.onError?.(normalizeError(error));
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
 * Creates a user-stream SSE client for optional capability-gated updates.
 */
export function createUserSSEClient(
  options: CreateUserSSEClientOptions
): UserStreamHandle {
  const fetcher = resolveFetch(options.fetcher);
  const controller = new AbortController();
  const deduper = createSlidingEventDeduper(
    options.dedupWindowSize ?? DEFAULT_DEDUP_WINDOW_SIZE
  );
  let closed = false;
  let lastEventId = options.lastEventId;

  const url = buildFlowApiUrl({
    baseUrl: options.baseUrl,
    path: options.url,
    query:
      options.startingAfter === undefined
        ? undefined
        : {
            starting_after: options.startingAfter
          }
  });

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
        options.onError?.(normalizeError(error));
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
      throw new Error(`SSE request failed (${response.status}) ${response.statusText || ""}`.trim());
    }

    if (response.body === null) {
      const text = await response.text();
      for (const frame of parseFrames(text)) {
        options.onFrame(frame);
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

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
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    options.onError(normalizeError(error));
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

    for (const line of lines) {
      if (line.startsWith(":")) {
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
      } else if (key === "event") {
        frame.event = valuePart;
      } else if (key === "data") {
        dataLines.push(valuePart);
      }
    }

    if (dataLines.length > 0) {
      frame.data = dataLines.join("\n");
    }

    if (frame.id !== undefined || frame.event !== undefined || frame.data !== undefined) {
      frames.push(frame);
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
    event.type === "request.failed"
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

  if (event.type === "content.added") {
    callbacks.onContentAdded?.(event);
    return;
  }

  if (event.type === "content.delta") {
    callbacks.onContentDelta?.(event);
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

function isAbortError(value: unknown): boolean {
  return (
    value instanceof DOMException && value.name === "AbortError"
  ) || (value instanceof Error && value.name === "AbortError");
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Unknown SSE client error");
}
