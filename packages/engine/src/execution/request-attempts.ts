/**
 * Live run attempts per request id, in this process.
 *
 * One request id can have two runs executing at once: the stale-request sweep
 * marks a slow but live run `interrupted`, and `/continue` starts a second run
 * under the same id while the first is still writing. Both runs share the
 * record, its incarnation and the active-registry entry, which is keyed by the
 * request id alone. So neither run may treat its own end as the request's end:
 * stamping `finalizedAtMs` would let retention free the id under the other
 * run, and deregistering would drop the other run's entry.
 *
 * Only the last attempt to end, in this process, stamps and deregisters. An
 * attempt in another process is judged by its heartbeat, as the stale sweep
 * already does.
 *
 * Attempts are counted per request store, so two store registries in one
 * process (tests, multiple engines) never hold each other's requests open.
 */

const liveAttempts = new WeakMap<object, Map<string, number>>();

/** A started attempt. `end` is idempotent. */
export type RequestAttempt = {
  /**
   * Mark this attempt ended. Returns true when no other attempt of the same
   * request is still live in this process, so this one may stamp and
   * deregister; false when another attempt will. A second call returns false.
   */
  end(): boolean;
};

/** Record the start of a run attempt of `requestId` against `store`. */
export function beginRequestAttempt(store: object, requestId: string): RequestAttempt {
  let counts = liveAttempts.get(store);
  if (counts === undefined) {
    counts = new Map();
    liveAttempts.set(store, counts);
  }
  const map = counts;
  map.set(requestId, (map.get(requestId) ?? 0) + 1);
  let ended = false;
  return {
    end(): boolean {
      if (ended) return false;
      ended = true;
      const remaining = (map.get(requestId) ?? 1) - 1;
      if (remaining <= 0) {
        map.delete(requestId);
        return true;
      }
      map.set(requestId, remaining);
      return false;
    }
  };
}

/** Whether any attempt of `requestId` against `store` is still live in this process. */
export function hasLiveRequestAttempt(store: object, requestId: string): boolean {
  return (liveAttempts.get(store)?.get(requestId) ?? 0) > 0;
}
