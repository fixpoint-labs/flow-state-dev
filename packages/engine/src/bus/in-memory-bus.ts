/**
 * The in-memory change bus: the default `bus`, and the in-process fan-out a
 * cross-process adapter can compose.
 *
 * It reaches subscribers in this process only, so it never says it crosses
 * processes, and the session stream keeps its timed read beside it.
 */
import type { BusTopic, ChangeBus, ChangeListener, ChangeNotice } from "./types";

/** The key every subscriber of one scope's topics shares. */
function scopeKey(topic: BusTopic): string {
  return `${topic.scope}\u0000${topic.tenantId}\u0000${topic.id}`;
}

let warnedListenerFailure = false;

/** Run one listener; a failing listener never stops the others or the writer. */
function deliver(listener: ChangeListener, notice: ChangeNotice): void {
  try {
    listener(notice);
  } catch (error) {
    if (warnedListenerFailure) return;
    warnedListenerFailure = true;
    console.warn("[flow-state] a change-bus listener threw; later failures are not logged.", error);
  }
}

/**
 * Create a bus that delivers each notice to this process's subscribers, in a
 * microtask after `publish`. `crossesProcesses` is always `false`.
 */
export function createInMemoryBus(): ChangeBus {
  const byScope = new Map<string, Set<{ resource?: string; listener: ChangeListener }>>();

  return {
    crossesProcesses: false,

    publish(notice) {
      const subscribers = byScope.get(scopeKey(notice.topic));
      if (subscribers === undefined) return Promise.resolve();
      for (const subscriber of [...subscribers]) {
        // Unnarrowed subscribers hear every notice under the scope; a narrowed
        // one hears only its own resource.
        if (subscriber.resource !== undefined && subscriber.resource !== notice.topic.resource) continue;
        queueMicrotask(() => {
          if (subscribers.has(subscriber)) deliver(subscriber.listener, notice);
        });
      }
      return Promise.resolve();
    },

    subscribe(topic, listener) {
      const key = scopeKey(topic);
      let subscribers = byScope.get(key);
      if (subscribers === undefined) byScope.set(key, (subscribers = new Set()));
      const subscriber = { ...(topic.resource !== undefined ? { resource: topic.resource } : {}), listener };
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0 && byScope.get(key) === subscribers) byScope.delete(key);
      };
    },

    onCrossingChange() {
      return () => {};
    }
  };
}
