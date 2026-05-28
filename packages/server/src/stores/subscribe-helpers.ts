/**
 * Shared helpers for `RequestStore.subscribeToEvents` implementations.
 *
 * Two concerns split out so every backend (memory bus, SQLite poll,
 * filesystem poll, Postgres LISTEN/NOTIFY, PGlite poll) sees the same
 * terminal-event predicate and synthesizes the same liveness-timeout
 * sentinel.
 */
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { RequestStatus, SubscribeToEventsOptions } from "./types";

const DEFAULT_LIVENESS_TIMEOUT_MS = 30_000;

/** Whether a request status is past the in-flight phase. */
export function isTerminalRequestStatus(status: RequestStatus | undefined): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "incomplete" ||
    status === "interrupted" ||
    status === "aborted"
  );
}

/**
 * Whether an event marks the end of the per-request stream. Iterators
 * yield the event then return after one of these.
 *
 * `request.interrupted` only counts as terminal when its `status` field
 * is `"interrupted"` — the intermediate `request.${RequestStatus}`
 * transitions otherwise pass through.
 */
export function isTerminalRequestStreamEvent(
  event: RequestStreamEvent
): boolean {
  switch (event.type) {
    case "request.completed":
    case "request.failed":
    case "request.aborted":
    case "request.incomplete":
      return true;
    case "request.interrupted":
      return (event as { status?: string }).status === "interrupted";
    default:
      return false;
  }
}

/**
 * Build an in-iterator `request.interrupted` event for liveness-timeout
 * surfacing. Not persisted — this represents the subscriber's view of an
 * apparent originating-process death, not durable state.
 *
 * Caller must pass the last real `sequence_number` yielded (or `0` if
 * nothing has been yielded yet). Reusing the last-seen sequence is
 * deliberate: SSE clients echo this id back as `Last-Event-ID` on
 * auto-reconnect, and the resume cursor returns events strictly greater
 * than that. If the writer was actually still alive and persisted a real
 * event at `lastSeen + 1`, advancing the synthetic past it would cause
 * the reconnecting subscriber to skip that real event (the synthetic is
 * never persisted, so it can't collide in catch-up).
 */
export function synthesizeRequestInterrupted(
  requestId: string,
  sequenceNumber: number
): RequestStreamEvent {
  return {
    stream: "request",
    type: "request.interrupted",
    status: "interrupted",
    requestId,
    sequence_number: sequenceNumber,
    ts: Date.now()
  } as RequestStreamEvent;
}

/** Abort-aware sleep used by polling subscription loops. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type ReadEventsFn = (
  requestId: string,
  fromSequence?: number
) => Promise<RequestStreamEvent[]>;

/**
 * Shared polling subscription loop for the SQLite, filesystem, and
 * Postgres-without-`liveTailPool` backends. Yields the catch-up phase via
 * `readEvents`, then polls on `pollIntervalMs` until aborted, terminal,
 * or stalled past `livenessTimeoutMs` (synthesizes a `request.interrupted`).
 */
export async function* pollEvents(
  readEvents: ReadEventsFn,
  requestId: string,
  options: SubscribeToEventsOptions,
  pollIntervalMs: number
): AsyncIterableIterator<RequestStreamEvent> {
  const livenessMs = options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;

  const initial = await readEvents(requestId, options.fromSequence);
  let lastSeen = options.fromSequence;
  for (const event of initial) {
    yield event;
    lastSeen = event.sequence_number;
    if (isTerminalRequestStreamEvent(event)) return;
  }

  let lastTickAt = Date.now();

  while (!options.signal?.aborted) {
    await abortableSleep(pollIntervalMs, options.signal);
    if (options.signal?.aborted) return;

    const next = await readEvents(requestId, lastSeen);
    if (next.length > 0) {
      lastTickAt = Date.now();
      for (const event of next) {
        yield event;
        lastSeen = event.sequence_number;
        if (isTerminalRequestStreamEvent(event)) return;
      }
    } else if (Date.now() - lastTickAt > livenessMs) {
      yield synthesizeRequestInterrupted(requestId, lastSeen ?? 0);
      return;
    }
  }
}
