/**
 * Unit tests for `applyGetOrPatchState` — the shared get-or-compute-over-state
 * primitive behind `ResourceRef.getOrPatchState`.
 *
 * These pin the contract every ResourceRef builder wires: compute-on-miss,
 * read-through on hit (callback never runs), `null` counts as a stored value,
 * and a `compute` that yields `undefined` stores nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { applyGetOrPatchState } from "../src/types/resource";
import type { ResourceRef } from "../src/types/resource";

type SpineState = { fundamentals?: { eps: number }; note?: string | null };

/** Minimal ref backed by a plain object, mirroring a real ref's state+patch. */
function makeStubRef(initial: SpineState = {}): Pick<ResourceRef<SpineState>, "state" | "patchState"> {
  let backing: SpineState = { ...initial };
  return {
    get state() {
      return backing;
    },
    patchState: vi.fn(async (updates: Partial<SpineState>) => {
      backing = { ...backing, ...updates };
    }),
  };
}

describe("applyGetOrPatchState", () => {
  it("runs compute on a miss, patches the key, and returns the value", async () => {
    const ref = makeStubRef();
    const compute = vi.fn(async () => ({ eps: 5 }));

    const result = await applyGetOrPatchState(ref, "fundamentals", compute);

    expect(result).toEqual({ eps: 5 });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(ref.patchState).toHaveBeenCalledWith({ fundamentals: { eps: 5 } });
    // The stored copy is now readable for downstream consumers.
    expect(ref.state.fundamentals).toEqual({ eps: 5 });
  });

  it("returns the stored value on a hit without invoking compute or patchState", async () => {
    const ref = makeStubRef({ fundamentals: { eps: 9 } });
    const compute = vi.fn(async () => ({ eps: 0 }));

    const result = await applyGetOrPatchState(ref, "fundamentals", compute);

    expect(result).toEqual({ eps: 9 });
    expect(compute).not.toHaveBeenCalled();
    expect(ref.patchState).not.toHaveBeenCalled();
  });

  it("treats a stored null as a hit (compute does not run)", async () => {
    const ref = makeStubRef({ note: null });
    const compute = vi.fn(async () => "recomputed");

    const result = await applyGetOrPatchState(ref, "note", compute);

    expect(result).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it("stores nothing when compute resolves to undefined, leaving the key recomputable", async () => {
    const ref = makeStubRef();
    const compute = vi.fn(async () => undefined as unknown as { eps: number });

    const result = await applyGetOrPatchState(ref, "fundamentals", compute);

    expect(result).toBeUndefined();
    expect(ref.patchState).not.toHaveBeenCalled();
    expect("fundamentals" in ref.state).toBe(false);
  });
});
