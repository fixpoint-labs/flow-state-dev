import type { StateContainer } from "@flow-state-dev/core/types";
import { describe, expect, it, vi } from "vitest";
import {
  ConcurrentModificationError,
  createScopeStateOps,
  createStateContainer,
  runWithCAS
} from "../src";
import type { CASPersist } from "../src/stores/cas";

describe("state container and CAS", () => {
  it("commits state and version unconditionally", () => {
    const container = createStateContainer({ count: 1 }, 0);

    const first = container.commit({ count: 2 }, 1);
    expect(first).toEqual({ count: 2 });
    expect(container.getVersion()).toBe(1);

    // Refresh to a store-reported current value (simulates conflict recovery).
    const refreshed = container.commit({ count: 99 }, 5);
    expect(refreshed).toEqual({ count: 99 });
    expect(container.getVersion()).toBe(5);
  });

  it("retries CAS updates on persist conflicts", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);

    // Simulate a store where the first write fails with a conflict (the store
    // already holds version=1, value={count: 99}), then succeeds.
    let storeValue: State = { count: 0 };
    let storeVersion = 0;
    let conflictInjected = false;

    const persist: CASPersist<State> = async (state, expectedVersion) => {
      if (!conflictInjected) {
        conflictInjected = true;
        // Simulate an out-of-band write landing before ours.
        storeValue = { count: 99 };
        storeVersion = 1;
      }
      if (expectedVersion !== storeVersion) {
        return {
          ok: false,
          currentState: storeValue,
          currentVersion: storeVersion
        };
      }
      storeVersion += 1;
      storeValue = state as State;
      return { ok: true, version: storeVersion };
    };

    const result = await runWithCAS({
      container,
      mutator: async (state) => ({ count: state.count + 1 }),
      persist,
      options: { maxRetries: 3, baseDelayMs: 0 }
    });

    expect(result).toEqual({ state: { count: 100 }, committed: true });
    expect(container.getVersion()).toBe(2);
  });

  it("throws ConcurrentModificationError when CAS retries are exhausted", async () => {
    const container = createStateContainer({ value: 1 }, 0);
    const alwaysConflict: CASPersist<{ value: number }> = async () => ({
      ok: false,
      currentState: { value: 1 },
      currentVersion: 0
    });

    await expect(
      runWithCAS({
        container,
        mutator: async (state) => ({ value: state.value + 1 }),
        persist: alwaysConflict,
        options: { maxRetries: 1, baseDelayMs: 0 }
      })
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });

  it("applies canonical scope state operations via CAS", async () => {
    type DemoState = {
      count: number;
      list: string[];
      bag: Record<string, number>;
      mode: string;
      score?: number;
    };

    const container: StateContainer<DemoState> = createStateContainer<DemoState>({
      count: 0,
      list: [],
      bag: { a: 1 },
      mode: "idle"
    });

    const persist = vi.fn<CASPersist<DemoState>>(async (_state, expectedVersion) => ({
      ok: true,
      version: expectedVersion + 1
    }));

    const ops = createScopeStateOps<DemoState>(container, {
      persist
    });

    await ops.patchState({ mode: "running" });
    await ops.patchState("count", (current) => current + 2);
    await ops.incState({ count: 3, score: 1 });
    await ops.pushState("list", "first");
    await ops.setStateRecord("bag", "b", 2);
    await ops.deleteStateRecord("bag", "a");
    await ops.atomicState((state) => ({ count: state.count + 1 }));

    expect(container.read()).toEqual({
      count: 6,
      list: ["first"],
      bag: { b: 2 },
      mode: "running",
      score: 1
    });
    expect(persist).toHaveBeenCalledTimes(7);
    expect(container.getVersion()).toBe(7);
  });

  it("no-op writes return false and skip persist + version bump", async () => {
    type DemoState = {
      count: number;
      list: string[];
      bag: Record<string, number>;
      mode: string;
    };

    const container: StateContainer<DemoState> = createStateContainer<DemoState>({
      count: 5,
      list: ["a"],
      bag: { x: 1 },
      mode: "idle"
    });

    const persist = vi.fn<CASPersist<DemoState>>(async (_state, expectedVersion) => ({
      ok: true,
      version: expectedVersion + 1
    }));

    const ops = createScopeStateOps<DemoState>(container, { persist });

    // Equal-value patch: no-op, no persist, no version advance.
    expect(await ops.patchState({ count: 5 })).toBe(false);
    expect(await ops.patchState({ mode: "idle" })).toBe(false);
    expect(await ops.patchState("count", (c) => c)).toBe(false);
    expect(await ops.setState({ count: 5, list: ["a"], bag: { x: 1 }, mode: "idle" })).toBe(false);
    expect(await ops.incState({ count: 0 })).toBe(false);
    expect(await ops.setStateRecord("bag", "x", 1)).toBe(false);
    expect(await ops.deleteStateRecord("bag", "missing")).toBe(false);
    expect(await ops.atomicState(() => ({}))).toBe(false);
    expect(await ops.atomicState((s) => ({ count: s.count }))).toBe(false);

    expect(persist).not.toHaveBeenCalled();
    expect(container.getVersion()).toBe(0);

    // Real change still commits and reports true.
    expect(await ops.patchState({ count: 6 })).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(container.getVersion()).toBe(1);
  });
});
