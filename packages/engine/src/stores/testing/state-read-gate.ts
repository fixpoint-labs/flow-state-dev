/**
 * A test gate that holds a route open between its resource-state read and
 * whatever it does next, so a test can move the key underneath a request that
 * is already in flight.
 *
 * Route-level race tests need this because the window a versioned write closes
 * is *inside* one request: the route reads a version, then writes conditionally
 * on it. Nothing observable from outside separates a route that carries that
 * version from one that passes `"any"` — both answer the same status codes —
 * so the only way to reach the branch is to move the row while the request is
 * parked mid-read.
 */
import type { ResourceStateStore } from "../types";

/** Handle returned by {@link gateNextStateRead}. */
export interface StateReadGate {
  /** Resolves once the route has read, or after a turn if it never does. */
  whenRead(): Promise<void>;
  /** Let the parked read return, resuming the request. */
  release(): void;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Park the next `get` on `store` until the returned gate is released.
 *
 * Only the next read is gated; every later read passes through, so a route that
 * reads more than once is not deadlocked. The store method is replaced in
 * place, which suits a store built fresh per test — there is no restore.
 *
 * `whenRead` races a turn of the event loop rather than waiting outright, so a
 * route that never reads fails its assertions instead of hanging the suite on a
 * gate nothing will reach.
 */
export function gateNextStateRead(store: ResourceStateStore): StateReadGate {
  let release!: () => void;
  const released = new Promise<void>((r) => {
    release = r;
  });
  let markRead!: () => void;
  const read = new Promise<void>((r) => {
    markRead = r;
  });

  let armed = true;
  const real = store.get.bind(store);
  store.get = async (...args) => {
    const value = await real(...args);
    if (!armed) return value;
    armed = false;
    markRead();
    await released;
    return value;
  };

  return {
    whenRead: async () => {
      await Promise.race([read, tick().then(tick)]);
      armed = false;
    },
    release: () => release(),
  };
}
