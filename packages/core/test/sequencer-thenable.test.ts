/**
 * Regression contract: a `SequencerDefinition` must never be a thenable.
 *
 * The sequencer DSL's sequential-step method is `.step()`. It used to be
 * `.then()`, which collided with the JavaScript Promise/thenable protocol:
 * the language runtime treats any object exposing `then(onFulfilled,
 * onRejected)` as a promise, so `Promise.resolve(sequencer)` — or returning a
 * sequencer from an `async` function — would invoke the DSL method with
 * `(resolve, reject)` and crash. These tests pin the contract so the trap
 * cannot silently reopen if anyone re-adds a `.then` method to the builder.
 */

import { describe, it, expect } from "vitest";
import { sequencer, handler } from "@flow-state-dev/core";

const noop = () => handler({ name: "noop", execute: () => ({}) });

describe("SequencerDefinition is not thenable", () => {
  it("does not expose a `.then` property", () => {
    const seq = sequencer({ name: "thenable-contract" }).step(noop());
    expect((seq as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it("can be returned from an async function without invoking a DSL method", async () => {
    const seq = sequencer({ name: "thenable-contract" }).step(noop());
    const result = await (async () => seq)();
    expect(result).toBe(seq);
  });

  it("can be passed to Promise.resolve without invoking a DSL method", async () => {
    const seq = sequencer({ name: "thenable-contract" }).step(noop());
    const result = await Promise.resolve(seq);
    expect(result).toBe(seq);
  });
});
