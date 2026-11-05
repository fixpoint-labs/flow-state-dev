/**
 * The in-memory change bus: the default `bus`, and the in-process fan-out a
 * cross-process adapter can compose.
 *
 * It is the bus for an app that runs as one process. Every change is made in
 * the process its subscribers are in, so it reaches them all and says it
 * crosses processes: the session stream drops its timed read, and a client
 * stops its fallback poll while its socket is open. An app that writes its
 * stores from several processes (several servers, a worker, `fsdev run` or
 * `fsdev chat` on the same SQLite file) needs a bus that crosses, such as the
 * Postgres bus; on this one, the other processes' changes don't push.
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
 * Create a bus that delivers each notice to this process's subscribers, in
 * one microtask after `publish` (one per publish, however many subscribe).
 * `crossesProcesses` is always `true`: the app it serves runs as one process.
 */
export function createInMemoryBus(): ChangeBus {
  const byScope = new Map<string, Set<{ resource?: string; listener: ChangeListener }>>();

  return {
    crossesProcesses: true,

    publish(notice) {
      const subscribers = byScope.get(scopeKey(notice.topic));
      if (subscribers === undefined) return Promise.resolve();
      // Unnarrowed subscribers hear every notice under the scope; a narrowed
      // one hears only its own resource.
      const hearing = [...subscribers].filter(
        (subscriber) => subscriber.resource === undefined || subscriber.resource === notice.topic.resource
      );
      if (hearing.length === 0) return Promise.resolve();
      queueMicrotask(() => {
        // One that unsubscribed since the publish no longer hears it.
        for (const subscriber of hearing) if (subscribers.has(subscriber)) deliver(subscriber.listener, notice);
      });
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
