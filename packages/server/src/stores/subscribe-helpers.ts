/**
 * Shared helpers for `RequestStore.subscribeToEvents` implementations.
 *
 * Two concerns split out so every backend (memory bus, SQLite poll,
 * filesystem poll, Postgres LISTEN/NOTIFY, PGlite poll) sees the same
 * terminal-event predicate and synthesizes the same liveness-timeout
 * sentinel.
 */
import type { RequestStreamEvent } from "@flow-state-dev/core/items";

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
