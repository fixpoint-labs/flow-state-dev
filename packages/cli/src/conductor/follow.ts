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
   * Leaving the running set does not abort — the journal's terminal
   * event closes the iterator, so the last hunks and the final message
   * still arrive on a poll-based store.
   */
  sync(requestIds: readonly string[]): void;
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
        active.delete(requestId);
        finished.add(requestId);
        options.onEnd?.(requestId);
      }
    })();
  };

  return {
    sync(requestIds) {
      for (const id of requestIds) {
        if (finished.has(id) || active.has(id)) continue;
        start(id);
      }
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
