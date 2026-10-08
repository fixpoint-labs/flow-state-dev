/**
 * `pushState` on a scope with no store refuses a target that holds something
 * other than an array, and leaves the stored value intact. Replacing it would
 * silently destroy data. An absent field still starts a new array. The
 * store-backed `pushToArray` contract lives in the scope-store conformance
 * suite; this pins the same rule on the container's own mutator.
 */
import { describe, expect, it } from "vitest";
import { createScopeStateOps, createStateContainer } from "../src";

type State = Record<string, unknown>;

describe("pushState on a non-array target (scope with no store)", () => {
  it("refuses a string target and leaves it intact", async () => {
    const container = createStateContainer<State>({ log: "keep me" }, 0);
    const ops = createScopeStateOps<State>(container);

    await expect(ops.pushState("log", "x")).rejects.toThrow(
      /pushState target "log" is not an array \(got string\)/
    );

    expect(container.read()).toEqual({ log: "keep me" });
    expect(container.getVersion()).toBe(0);
  });

  it("refuses a null target, as the store adapters do", async () => {
    const container = createStateContainer<State>({ log: null }, 0);
    const ops = createScopeStateOps<State>(container);

    await expect(ops.pushState("log", "x")).rejects.toThrow(/got null/);

    expect(container.read()).toEqual({ log: null });
  });

  it("starts a missing field as a new array", async () => {
    const container = createStateContainer<State>({}, 0);
    const ops = createScopeStateOps<State>(container);

    await ops.pushState("log", "x");

    expect(container.read()).toEqual({ log: ["x"] });
  });

  it("appends to an existing array", async () => {
    const container = createStateContainer<State>({ log: ["a"] }, 0);
    const ops = createScopeStateOps<State>(container);

    await ops.pushState("log", "b");

    expect(container.read()).toEqual({ log: ["a", "b"] });
  });
});
