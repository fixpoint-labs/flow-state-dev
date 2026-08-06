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
  /**
   * Resolve once the route has parked at its state read.
   *
   * @throws {StateReadGateTimeoutError} if no read arrives in time.
   */
  whenRead(): Promise<void>;
  /** Let the parked read return, resuming the request. */
  release(): void;
}

/**
 * Thrown when a gated route never reaches its state read.
 *
 * A distinct type because the only honest thing a gate can do on expiry is
 * fail: it cannot tell "this route does not read" from "this read is slow",
 * and every assertion downstream looks identical either way.
 */
export class StateReadGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `gated read never happened — the route did not read state within ${timeoutMs}ms. ` +
        `Either the route under test does not read before it writes, or the store is slower ` +
        `than this gate allows; both make the surrounding race assertions meaningless.`
    );
    this.name = "StateReadGateTimeoutError";
  }
}

/**
 * How long `whenRead` waits before declaring the read will never arrive.
 *
 * Deliberately far longer than any single `get` (a loaded SQLite or Postgres
 * read is orders of magnitude under this) and deliberately shorter than
 * Vitest's 5s default test timeout, so an unmet gate surfaces as this error
 * rather than as a test that hangs until the runner kills it.
 */
const READ_TIMEOUT_MS = 2_000;

/**
 * Park the next `get` on `store` until the returned gate is released.
 *
 * Only the next read is gated; every later read passes through, so a route that
 * reads more than once is not deadlocked. The store method is replaced in
 * place, which suits a store built fresh per test — there is no restore.
 *
 * `whenRead` waits for the read and **throws** if it does not arrive. An
 * earlier version raced two event-loop turns and disarmed the gate when the
 * timers won, which silently turned a slow read into an ungated one: the route
 * then ran to completion while the test believed it was parked, so a race test
 * could pass without ever staging its race. A gate that cannot prove it held
 * the route has to fail rather than guess.
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          read,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new StateReadGateTimeoutError(READ_TIMEOUT_MS)), READ_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        // Disarm and release so a route that reads later is not parked forever
        // behind a gate no one will open, which would turn this failure into a
        // hang during teardown.
        armed = false;
        release();
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    release: () => release(),
  };
}
