/**
 * Hot-path cleanup tests (FIX-405).
 *
 * Verifies that the per-op artifacts the original spec called out as
 * "compensating for the lack of native atomic ops" are gone:
 *
 *   - MemoryStateContainer.read() no longer deep-clones on every read
 *   - No JSON.stringify size-estimate is invoked during a typical patchState
 *     cycle on either the in-memory (lock) or external-store (CAS) path
 *
 * Adapters that legitimately serialize on `set` (Postgres, filesystem) are
 * unaffected — this only guards the CAS/container hot path that runs once
 * per scope-state op.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createScopeStateOps,
  createStateContainer,
  type CASPersist
} from "../src";

describe("hot-path cleanup", () => {
  it("MemoryStateContainer.read() returns the same reference each call (no per-read clone)", () => {
    const initial = { count: 0, nested: { a: 1 } };
    const container = createStateContainer(initial);

    const first = container.read();
    const second = container.read();

    expect(first).toBe(second);
    expect(first).toBe(initial);
  });

  it("does not invoke JSON.stringify on state during a single in-memory patchState op", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 });
    const ops = createScopeStateOps<State>(container);

    const original = JSON.stringify;
    const stringifySpy = vi.fn(original);
    JSON.stringify = stringifySpy as typeof JSON.stringify;

    try {
      await ops.patchState({ count: 1 });
    } finally {
      JSON.stringify = original;
    }

    expect(stringifySpy).not.toHaveBeenCalled();
  });

  it("does not invoke JSON.stringify on the CAS path during a single patchState op", async () => {
    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 });

    let storeValue: State = { count: 0 };
    let storeVersion = 0;
    const persist: CASPersist<State> = async (state, expectedVersion) => {
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
      cas: { maxRetries: 1, baseDelayMs: 0 }
    });

    const original = JSON.stringify;
    const stringifySpy = vi.fn(original);
    JSON.stringify = stringifySpy as typeof JSON.stringify;

    try {
      await ops.patchState({ count: 1 });
    } finally {
      JSON.stringify = original;
    }

    // The persist callback above is plain JS — no serialization. Any
    // JSON.stringify call would come from CAS / container internals.
    expect(stringifySpy).not.toHaveBeenCalled();
  });

  it("multiple sequential patchState ops do not allocate per-op clones of state", async () => {
    // Object identity contract: between reads the container returns the same
    // backing reference. After a commit the reference advances to the
    // mutator's output (also stored without copy). Callers must not mutate
    // their read result; this test documents the contract.
    type State = { count: number; items: string[] };
    const container = createStateContainer<State>({ count: 0, items: [] });
    const ops = createScopeStateOps<State>(container);

    const first = container.read();
    await ops.patchState({ count: 1 });
    const afterFirst = container.read();
    expect(afterFirst).not.toBe(first); // commit advanced the reference
    expect(afterFirst.count).toBe(1);

    // Two reads at the same version share the reference.
    const same = container.read();
    expect(same).toBe(afterFirst);
  });
});
