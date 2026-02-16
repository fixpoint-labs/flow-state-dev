import type { StateContainer } from "@flow-state-dev/core/types";
import { describe, expect, it, vi } from "vitest";
import {
  ConcurrentModificationError,
  createScopeStateOps,
  createStateContainer,
  runWithCAS
} from "../src";

describe("state container and CAS", () => {
  it("supports versioned persist operations", async () => {
    const container = createStateContainer({ count: 1 }, 0);
    const mismatch = await container.persist({ count: 2 }, 5);
    expect(mismatch).toBeNull();

    const success = await container.persist({ count: 3 }, 0);
    expect(success).toEqual({ count: 3 });
    expect(container.getVersion()).toBe(1);
  });

  it("retries CAS updates on version conflicts", async () => {
    const container = createStateContainer({ count: 0 }, 0);
    let injectedConflict = false;

    const result = await runWithCAS({
      container,
      mutator: async (state) => {
        if (!injectedConflict) {
          injectedConflict = true;
          const currentVersion = container.getVersion();
          await container.persist({ count: 99 }, currentVersion);
        }

        return { count: state.count + 1 };
      },
      options: { maxRetries: 3, baseDelayMs: 0 }
    });

    expect(result).toEqual({ count: 100 });
    expect(container.getVersion()).toBe(2);
  });

  it("throws ConcurrentModificationError when CAS retries are exhausted", async () => {
    const failingContainer: StateContainer<{ value: number }> = {
      read: () => ({ value: 1 }),
      getVersion: () => 0,
      persist: async () => null
    };

    await expect(
      runWithCAS({
        container: failingContainer,
        mutator: async (state) => ({ value: state.value + 1 }),
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

    const container = createStateContainer<DemoState>({
      count: 0,
      list: [],
      bag: { a: 1 },
      mode: "idle"
    });

    const onPersist = vi.fn();
    const ops = createScopeStateOps(container, {
      onPersist
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
    expect(onPersist).toHaveBeenCalledTimes(7);
  });
});
