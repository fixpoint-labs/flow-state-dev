import type { StateContainer } from "@flow-state-dev/core/types";
import { describe, expect, it, vi } from "vitest";
import {
  ConcurrentModificationError,
  createScopeStateOps,
  createStateContainer,
  ScopeMutationTimeoutError
} from "../src";
import type { CASPersist } from "../src/stores/cas";
import { withScopeLock } from "../src/stores/scope-lock";

describe("applyMutation — in-memory (lock) branch", () => {
  it("preserves FIFO ordering across N=10 concurrent mutators", async () => {
    type State = { values: number[] };
    const container: StateContainer<State> = createStateContainer<State>({
      values: []
    });
    const ops = createScopeStateOps<State>(container);

    const N = 10;
    const promises = Array.from({ length: N }, (_, i) =>
      ops.atomicState((state) => ({ values: [...state.values, i] }))
    );
    const results = await Promise.all(promises);

    expect(results.every((r) => r === true)).toBe(true);
    expect(container.read().values).toEqual(Array.from({ length: N }, (_, i) => i));
    expect(container.getVersion()).toBe(N);
  });

  it("never throws ConcurrentModificationError with N=20 concurrent mutators", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 });
    const ops = createScopeStateOps<State>(container);

    const N = 20;
    const promises = Array.from({ length: N }, () =>
      ops.atomicState((state) => ({ count: state.count + 1 }))
    );

    // No rejections, no ConcurrentModificationError.
    await expect(Promise.all(promises)).resolves.toEqual(
      Array.from({ length: N }, () => true)
    );
    expect(container.read().count).toBe(N);
  });

  it("skips commit and version bump on no-op writes (deep-equal short-circuit)", async () => {
    type State = { count: number; mode: string };
    const container = createStateContainer<State>({ count: 5, mode: "idle" });
    const ops = createScopeStateOps<State>(container);

    expect(await ops.patchState({ count: 5 })).toBe(false);
    expect(await ops.patchState({ mode: "idle" })).toBe(false);
    expect(await ops.atomicState(() => ({}))).toBe(false);
    expect(container.getVersion()).toBe(0);

    expect(await ops.patchState({ count: 6 })).toBe(true);
    expect(container.getVersion()).toBe(1);
  });

  it("invokes onStateSizeWarning when next state exceeds threshold", async () => {
    type State = { blob: string };
    const container = createStateContainer<State>({ blob: "" });
    const onStateSizeWarning = vi.fn();
    const ops = createScopeStateOps<State>(container, {
      maxStateSizeBytes: 32,
      onStateSizeWarning
    });

    await ops.patchState({ blob: "x".repeat(100) });

    expect(onStateSizeWarning).toHaveBeenCalledTimes(1);
    expect(onStateSizeWarning).toHaveBeenCalledWith(
      expect.objectContaining({ maxStateSizeBytes: 32 })
    );
  });

  it("throws ScopeMutationTimeoutError when an earlier mutator holds the lock past the budget", async () => {
    // The public `ScopeStateOps` API has only sync mutators, so a slow
    // path can't be created from the outside. Hold the lock with
    // `withScopeLock` directly to simulate head-of-line blocking and
    // verify the option plumbs through `applyMutation`.
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 });
    const ops = createScopeStateOps<State>(container, {
      mutationTimeoutMs: 30
    });

    let blockerResolve: (() => void) | undefined;
    const blockerStarted = new Promise<void>((startResolve) => {
      void withScopeLock(container, async () => {
        startResolve();
        await new Promise<void>((resolve) => {
          blockerResolve = resolve;
        });
      });
    });
    await blockerStarted;

    // Body would be near-instant; the timeout fires from queue wait alone.
    const queued = ops.atomicState((state) => ({ count: state.count + 1 }));
    await expect(queued).rejects.toBeInstanceOf(ScopeMutationTimeoutError);

    // Release so the test process exits cleanly.
    blockerResolve?.();
  });

  it("preserves all canonical scope state operations under the lock", async () => {
    type DemoState = {
      count: number;
      list: string[];
      bag: Record<string, number>;
      mode: string;
      score?: number;
    };

    const container = createStateContainer<DemoState>({
      count: 0,
      list: [],
      bag: { a: 1 },
      mode: "idle"
    });

    const ops = createScopeStateOps<DemoState>(container);

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
    expect(container.getVersion()).toBe(7);
  });
});

describe("applyMutation — external-store (CAS) branch", () => {
  it("retains CAS retry behavior when persist is provided", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);

    let storeValue: State = { count: 0 };
    let storeVersion = 0;
    let conflictInjected = false;

    const persist: CASPersist<State> = async (state, expectedVersion) => {
      if (!conflictInjected) {
        conflictInjected = true;
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
      storeValue = state;
      return { ok: true, version: storeVersion };
    };

    const ops = createScopeStateOps<State>(container, {
      persist,
      cas: { maxRetries: 3, baseDelayMs: 0 }
    });

    await ops.atomicState((state) => ({ count: state.count + 1 }));
    expect(container.read()).toEqual({ count: 100 });
    expect(container.getVersion()).toBe(2);
  });

  it("throws ConcurrentModificationError when external-store retries exhaust", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);
    const alwaysConflict: CASPersist<State> = async () => ({
      ok: false,
      currentState: { count: 0 },
      currentVersion: 999
    });

    const ops = createScopeStateOps<State>(container, {
      persist: alwaysConflict,
      cas: { maxRetries: 1, baseDelayMs: 0 }
    });

    await expect(
      ops.atomicState((state) => ({ count: state.count + 1 }))
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });

  it("does not invoke withScopeLock when persist is provided", async () => {
    // Verify two concurrent writers go through CAS (with version conflicts)
    // rather than serializing through the lock. With the lock they would
    // never produce conflicts; with CAS they can.
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);

    let store: State = { count: 0 };
    let storeVersion = 0;
    let conflictsObserved = 0;

    const persist: CASPersist<State> = async (state, expectedVersion) => {
      if (expectedVersion !== storeVersion) {
        conflictsObserved += 1;
        return {
          ok: false,
          currentState: store,
          currentVersion: storeVersion
        };
      }
      storeVersion += 1;
      store = state;
      return { ok: true, version: storeVersion };
    };

    const ops = createScopeStateOps<State>(container, {
      persist,
      cas: { maxRetries: 5, baseDelayMs: 0 }
    });

    await Promise.all([
      ops.atomicState((s) => ({ count: s.count + 1 })),
      ops.atomicState((s) => ({ count: s.count + 1 })),
      ops.atomicState((s) => ({ count: s.count + 1 }))
    ]);

    // Conflicts only happen on the CAS path. The lock path serializes
    // strictly so persist always sees expectedVersion === storeVersion.
    expect(conflictsObserved).toBeGreaterThan(0);
    expect(container.read().count).toBe(3);
  });
});
