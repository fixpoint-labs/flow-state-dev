/**
 * Shared live-tail registry for the SQLite request store.
 *
 * The naive implementation ran one poll loop per SSE subscriber: N clients
 * tailing one request issued N identical `SELECT … WHERE sequence_number > ?`
 * queries every poll interval. This registry collapses that to ONE shared loop
 * per request, fanned out to every subscriber by its own cursor:
 *
 *  - First subscriber for a request id starts the loop; the last one to leave
 *    tears it down (reference counting).
 *  - Each tick issues a single `readEvents` from the minimum cursor across
 *    subscribers, then delivers to each subscriber only the events past its own
 *    cursor — so a late joiner never re-sees earlier events.
 *  - The write path can `wake()` the loop after a commit, giving near-instant
 *    latency in the common single-process case. The interval poll remains the
 *    correctness backstop, so a write from another process (multiple servers on
 *    one SQLite file) is still delivered on the next tick.
 *
 * Per-subscriber delivery is bounded: a slow SSE consumer fails alone rather
 * than growing memory unbounded for everyone on the request. The package keeps
 * a TYPE-ONLY dependency on `@flow-state-dev/server` (enforced by
 * `scripts/validate-package-boundaries.mjs`), so the overflow surfaces as a
 * plain `Error` rather than the server's `StoreSubscriptionError` value.
 */
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { SubscribeToEventsOptions } from "@flow-state-dev/server";

/** Default subscription poll interval (ms). */
export const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_LIVENESS_TIMEOUT_MS = 30_000;
/** Bounded per-subscriber buffer; mirrors the in-memory store's default. */
const DEFAULT_MAX_PENDING_EVENTS = 1000;

type ReadEventsFn = (
  requestId: string,
  fromSequence?: number
) => Promise<RequestStreamEvent[]>;

/** Whether an event marks the end of a request event stream. */
function isTerminalRequestStreamEvent(event: RequestStreamEvent): boolean {
  switch (event.type) {
    case "request.completed":
    case "request.failed":
    case "request.aborted":
    case "request.incomplete":
    case "request.suspended":
      return true;
    case "request.interrupted":
      return (event as { status?: string }).status === "interrupted";
    default:
      return false;
  }
}

/** Build a non-persisted liveness-timeout event for stalled subscriptions. */
function synthesizeRequestInterrupted(
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

/** Per-subscriber state held by the shared loop. */
type Subscriber = {
  /** Highest sequence number delivered to this subscriber, or undefined if none yet. */
  lastSeen: number | undefined;
  /** Last time real events were delivered; drives the liveness timeout. */
  lastTickAt: number;
  livenessMs: number;
  signal: AbortSignal | undefined;
  /** Events delivered by the loop, awaiting the generator to drain them. */
  buffer: RequestStreamEvent[];
  capacity: number;
  /** Set when a terminal (real or synthesized) event has been queued. */
  terminated: boolean;
  /** Set when delivery failed (overflow or read error); the generator throws it. */
  error: Error | undefined;
  /** Resolver that unblocks the awaiting generator; no-op when not waiting. */
  wake: () => void;
};

/** Per-request shared loop state. */
type Tail = {
  subscribers: Set<Subscriber>;
  /** Resolver to break the inter-tick sleep early (wake nudge / teardown). */
  sleepResolve: (() => void) | undefined;
  sleepTimer: ReturnType<typeof setTimeout> | undefined;
};

export type LiveTailRegistry = {
  /** Subscribe to a request's event stream via the shared loop. */
  subscribe(
    requestId: string,
    options: SubscribeToEventsOptions
  ): AsyncIterableIterator<RequestStreamEvent>;
  /** Nudge the shared loop for a request to tick now (called after a write). */
  wake(requestId: string): void;
};

/**
 * Create a live-tail registry over a `readEvents` function. One registry is
 * created per request store; it owns the shared loops for all request ids.
 */
export function createLiveTailRegistry(
  readEvents: ReadEventsFn,
  pollIntervalMs: number
): LiveTailRegistry {
  const tails = new Map<string, Tail>();

  /** Break a tail's inter-tick sleep early (wake nudge or teardown). */
  function wakeTail(tail: Tail): void {
    tail.sleepResolve?.();
  }

  /** Sleep until the poll interval elapses or the tail is woken. */
  function sleepOrWake(tail: Tail): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        if (tail.sleepTimer !== undefined) clearTimeout(tail.sleepTimer);
        tail.sleepTimer = undefined;
        tail.sleepResolve = undefined;
        resolve();
      };
      tail.sleepResolve = done;
      tail.sleepTimer = setTimeout(done, pollIntervalMs);
    });
  }

  /** One shared poll: read once from the min cursor, fan out per subscriber. */
  async function tick(requestId: string, tail: Tail): Promise<void> {
    if (tail.subscribers.size === 0) return;
    const subs = [...tail.subscribers].filter((s) => !s.terminated && s.error === undefined);
    if (subs.length === 0) return;

    // Read once from the lowest cursor any subscriber needs. If any subscriber
    // has seen nothing yet (undefined cursor), read the whole log.
    let fromStart = false;
    let minSeen = Number.POSITIVE_INFINITY;
    for (const s of subs) {
      if (s.lastSeen === undefined) {
        fromStart = true;
        break;
      }
      if (s.lastSeen < minSeen) minSeen = s.lastSeen;
    }

    let rows: RequestStreamEvent[];
    try {
      rows = await readEvents(requestId, fromStart ? undefined : minSeen);
    } catch (err) {
      for (const s of subs) {
        s.error = err instanceof Error ? err : new Error(String(err));
        s.wake();
      }
      return;
    }

    const now = Date.now();
    for (const s of subs) {
      const relevant =
        s.lastSeen === undefined
          ? rows
          : rows.filter((e) => e.sequence_number > (s.lastSeen as number));

      if (relevant.length > 0) {
        if (s.buffer.length + relevant.length > s.capacity) {
          s.error = new Error(
            `store-sqlite live-tail: subscriber buffer overflow for request ${requestId} ` +
              `(capacity ${s.capacity}). The consumer is too slow to keep up with the event stream.`
          );
          s.wake();
          continue;
        }
        for (const e of relevant) s.buffer.push(e);
        s.lastSeen = relevant[relevant.length - 1].sequence_number;
        s.lastTickAt = now;
        if (relevant.some(isTerminalRequestStreamEvent)) s.terminated = true;
        s.wake();
      } else if (now - s.lastTickAt > s.livenessMs) {
        s.buffer.push(synthesizeRequestInterrupted(requestId, s.lastSeen ?? 0));
        s.terminated = true;
        s.wake();
      }
    }
  }

  /** Run the shared loop for a tail until its last subscriber leaves. */
  function startPump(requestId: string, tail: Tail): void {
    void (async () => {
      while (tails.get(requestId) === tail && tail.subscribers.size > 0) {
        await tick(requestId, tail);
        if (tail.subscribers.size === 0) break;
        await sleepOrWake(tail);
      }
      // Refcount teardown: only delete if this is still the mapped tail and
      // empty (a new subscriber may have re-created it).
      if (tails.get(requestId) === tail && tail.subscribers.size === 0) {
        tails.delete(requestId);
      }
    })();
  }

  async function* subscribe(
    requestId: string,
    options: SubscribeToEventsOptions
  ): AsyncIterableIterator<RequestStreamEvent> {
    const livenessMs = options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;

    // Phase 1 — one-time catch-up from this subscriber's own cursor.
    const initial = await readEvents(requestId, options.fromSequence);
    let lastSeen = options.fromSequence;
    for (const event of initial) {
      yield event;
      lastSeen = event.sequence_number;
      if (isTerminalRequestStreamEvent(event)) return;
    }
    if (options.signal?.aborted) return;

    // Phase 2 — join the shared loop; wait on a per-subscriber buffer.
    const sub: Subscriber = {
      lastSeen,
      lastTickAt: Date.now(),
      livenessMs,
      signal: options.signal,
      buffer: [],
      capacity: options.maxPendingEvents ?? DEFAULT_MAX_PENDING_EVENTS,
      terminated: false,
      error: undefined,
      wake: () => {}
    };

    let tail = tails.get(requestId);
    if (tail === undefined) {
      tail = { subscribers: new Set(), sleepResolve: undefined, sleepTimer: undefined };
      tails.set(requestId, tail);
    }
    tail.subscribers.add(sub);
    if (tail.subscribers.size === 1) startPump(requestId, tail);

    const onAbort = (): void => sub.wake();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        if (options.signal?.aborted) return;
        if (sub.error !== undefined) throw sub.error;
        if (sub.buffer.length === 0) {
          await new Promise<void>((resolve) => {
            sub.wake = resolve;
          });
          sub.wake = () => {};
          continue;
        }
        const batch = sub.buffer;
        sub.buffer = [];
        // A `wake()` that fires while we're draining (sub.wake is the no-op
        // here, not the parked resolver) is safely dropped: the loop re-checks
        // `sub.buffer.length` at the top and drains anything pushed meanwhile.
        for (const event of batch) {
          yield event;
          if (isTerminalRequestStreamEvent(event)) return;
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      tail.subscribers.delete(sub);
      // Tear down synchronously when the last subscriber leaves. Deferring the
      // `tails.delete` to the pump's async continuation would leave a window in
      // which a rejoining subscriber reuses this dying tail and starts a second
      // pump over it. Deleting here means a concurrent rejoin always creates a
      // fresh tail; waking lets the old pump observe the map change, exit its
      // loop, and clear its sleep timer immediately.
      if (tail.subscribers.size === 0 && tails.get(requestId) === tail) {
        tails.delete(requestId);
        wakeTail(tail);
      }
    }
  }

  function wake(requestId: string): void {
    const tail = tails.get(requestId);
    if (tail !== undefined) wakeTail(tail);
  }

  return { subscribe, wake };
}
