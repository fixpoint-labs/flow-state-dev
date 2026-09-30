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

type LiveRequest = {
  count: number;
  /**
   * The incarnation of the terminal record an ended attempt left unstamped
   * for a later one, if any.
   */
  unstampedIncarnation?: string;
};

const liveAttempts = new WeakMap<object, Map<string, LiveRequest>>();

/** A started attempt. `end` is idempotent. */
export type RequestAttempt = {
  /**
   * Mark this attempt ended. Returns true when no other attempt of the same
   * request is still live in this process, so this one may stamp and
   * deregister; false when another attempt will. A second call returns false.
   */
  end(): boolean;
  /**
   * Hand the stamp of the terminal record written as `incarnation` to
   * whichever attempt ends last. Called by an attempt whose `end` returned
   * false.
   */
  leaveStamp(incarnation: string | undefined): void;
  /** The incarnation an earlier attempt left for this one to stamp. */
  leftToStamp(): string | undefined;
};

/** Record the start of a run attempt of `requestId` against `store`. */
export function beginRequestAttempt(store: object, requestId: string): RequestAttempt {
  let requests = liveAttempts.get(store);
  if (requests === undefined) {
    requests = new Map();
    liveAttempts.set(store, requests);
  }
  const map = requests;
  let live = map.get(requestId);
  if (live === undefined) {
    live = { count: 0 };
    map.set(requestId, live);
  }
  const state = live;
  state.count += 1;
  let ended = false;
  return {
    end(): boolean {
      if (ended) return false;
      ended = true;
      state.count -= 1;
      if (state.count <= 0) {
        if (map.get(requestId) === state) map.delete(requestId);
        return true;
      }
      return false;
    },
    leaveStamp(incarnation: string | undefined): void {
      if (incarnation !== undefined) state.unstampedIncarnation = incarnation;
    },
    leftToStamp(): string | undefined {
      return state.unstampedIncarnation;
    }
  };
}

/** Whether any attempt of `requestId` against `store` is still live in this process. */
export function hasLiveRequestAttempt(store: object, requestId: string): boolean {
  return (liveAttempts.get(store)?.get(requestId)?.count ?? 0) > 0;
}
