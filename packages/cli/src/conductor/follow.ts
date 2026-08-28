/**
 * Follow a detached run's request stream.
 *
 * `status` puts the child's `requestId` on the row. This subscribes through
 * the same `RequestStore.subscribeToEvents` the HTTP attach route uses —
 * catch-up plus live tail, store-driven, no second host. It is not resume:
 * it does not continue a coding session, it watches the journal that
 * session already writes.
 */
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { RequestStreamEventWithId, StoreRegistry } from "@flow-state-dev/engine";

export interface ChildFollow {
  /**
   * Start a tail for each id that is not already tailed or finished.
   * Settled ids are valid — subscribe-from-0 catch-up fills a finished
   * attempt when the operator opens the board or selects that row.
   * Leaving the running set does not abort; the journal's terminal
   * event closes the iterator.
   */
  sync(requestIds: readonly string[]): void;
  /**
   * Deliver each id's persisted journal, then resolve.
   *
   * An active tail waits until that journal ends. An id we have never
   * tailed is replayed from `getEvents` and does not wait — a missing
   * or still-open journal is not a hang. Ids already delivered are
   * skipped so a second drain does not reprint the attempt.
   */
  drain(requestIds: readonly string[]): Promise<void>;
  /** True if this process started a tail for the id (still open or already ended). */
  followed(requestId: string): boolean;
  /** Abort every tail. */
  stop(): void;
}

export function createChildFollow(options: {
  stores: StoreRegistry;
  onEvent: (event: RequestStreamEventWithId) => void;
  /** Fires once the journal ends or the tail is aborted. */
  onEnd?: (requestId: string) => void;
}): ChildFollow {
  const active = new Map<string, AbortController>();
  const finished = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();

  const notifyEnd = (requestId: string): void => {
    active.delete(requestId);
    finished.add(requestId);
    options.onEnd?.(requestId);
    const pending = waiters.get(requestId);
    if (pending === undefined) return;
    waiters.delete(requestId);
    for (const resolve of pending) resolve();
  };

  const waitUntilEnded = (requestId: string): Promise<void> =>
    new Promise((resolve) => {
      if (finished.has(requestId) && !active.has(requestId)) {
        resolve();
        return;
      }
      const list = waiters.get(requestId) ?? [];
      list.push(resolve);
      waiters.set(requestId, list);
      if (finished.has(requestId) && !active.has(requestId)) {
        const pending = waiters.get(requestId);
        if (pending === undefined) return;
        waiters.delete(requestId);
        for (const next of pending) next();
      }
    });

  const start = (requestId: string): void => {
    const controller = new AbortController();
    active.set(requestId, controller);
    void (async () => {
      try {
        const subscription = options.stores.request.subscribeToEvents(requestId, {
          fromSequence: 0,
          signal: controller.signal,
        });
        for await (const event of subscription) {
          options.onEvent(withEventId(event));
        }
      } catch {
        // Aborted tails and a missing journal are not operator errors.
      } finally {
        notifyEnd(requestId);
      }
    })();
  };

  const replay = async (requestId: string): Promise<void> => {
    const events = await options.stores.request.getEvents(requestId);
    for (const event of events) {
      options.onEvent(withEventId(event));
    }
    finished.add(requestId);
  };

  return {
    sync(requestIds) {
      for (const id of requestIds) {
        if (id === "" || finished.has(id) || active.has(id)) continue;
        start(id);
      }
    },
    async drain(requestIds) {
      const unique = [...new Set(requestIds.filter((id) => id !== ""))];
      await Promise.all(
        unique.map(async (id) => {
          if (active.has(id)) {
            await waitUntilEnded(id);
            return;
          }
          if (finished.has(id)) return;
          await replay(id);
        }),
      );
    },
    followed(requestId) {
      return active.has(requestId) || finished.has(requestId);
    },
    stop() {
      for (const [id, controller] of active) {
        controller.abort();
        finished.add(id);
        active.delete(id);
      }
    },
  };
}

function withEventId(event: RequestStreamEvent): RequestStreamEventWithId {
  const existing = (event as RequestStreamEventWithId).id;
  if (typeof existing === "string" && existing !== "") return event as RequestStreamEventWithId;
  return { ...event, id: `${event.requestId}:${event.sequence_number}` };
}
