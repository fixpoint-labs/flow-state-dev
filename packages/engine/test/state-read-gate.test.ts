/**
 * Tests for the race-staging gate itself.
 *
 * The gate is shared test infrastructure exported from
 * `@flow-state-dev/engine/testing`, and every route race test's meaning rests
 * on it: if it does not actually hold the route at its state read, the test
 * around it asserts against a race that was never staged and passes anyway.
 *
 * Its first version raced two event-loop turns and disarmed itself when the
 * timers won, so a read slower than a couple of macrotasks was silently let
 * through — invisible against an in-memory store, reachable against a real
 * disk-backed one and under CI load. These two cases exist so that failure
 * mode cannot come back unnoticed.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src";
import { gateNextStateRead, StateReadGateTimeoutError } from "../src/testing";

describe("gateNextStateRead", () => {
  it("fails loudly when the gated route never reads, rather than disarming", async () => {
    const stores = createInMemoryStores();
    const gate = gateNextStateRead(stores.resourceState);

    // Nothing reads. The only honest outcome is an error: a gate that returns
    // normally here tells its caller the route is parked when it is not.
    await expect(gate.whenRead()).rejects.toThrow(StateReadGateTimeoutError);
  }, 10_000);

  it("still parks a read that takes many event-loop turns", async () => {
    const stores = createInMemoryStores();
    const real = stores.resourceState.get.bind(stores.resourceState);
    stores.resourceState.get = async (...args) => {
      await new Promise((r) => setTimeout(r, 150));
      return real(...args);
    };
    const gate = gateNextStateRead(stores.resourceState);

    let resumed = false;
    const inFlight = stores.resourceState
      .get("session", "s1", "k")
      .then(() => {
        resumed = true;
      });

    await gate.whenRead();

    // Waiting past the read's own duration is what makes this non-vacuous:
    // asserting `resumed === false` immediately after `whenRead` also passes
    // against a gate that never parked, because the read simply has not
    // finished yet. Only after 150ms has comfortably elapsed does "not
    // resumed" mean "parked" instead of "still reading".
    await new Promise((r) => setTimeout(r, 400));
    expect(resumed).toBe(false);

    gate.release();
    await inFlight;
    expect(resumed).toBe(true);
  }, 10_000);
});
