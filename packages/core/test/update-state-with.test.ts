import { describe, expect, it, vi } from "vitest";
import { updateStateWith, withOutcome } from "../src/helpers/update-state-with";

type Counter = { n: number; tag?: string };

/**
 * A `updateState` double that replays the updater the way `runWithCAS` does
 * (`packages/engine/src/stores/cas.ts` — the `while (attempt <= maxRetries)`
 * loop re-invokes `mutator`): run once against the
 * pre-conflict state and discard the result, then run against the winner's
 * state and commit that one.
 */
function replayingRef(first: Counter, winner: Counter) {
  const committed: Counter[] = [];
  return {
    state: winner,
    async updateState(updater: (s: Counter) => Counter | Promise<Counter>) {
      await updater(first); // the losing attempt — discarded
      committed.push(await updater(winner)); // the winner — committed
    },
    committed,
  };
}

function singleRef(state: Counter) {
  const committed: Counter[] = [];
  return {
    state,
    async updateState(updater: (s: Counter) => Counter | Promise<Counter>) {
      committed.push(await updater(state));
    },
    committed,
  };
}

describe("updateStateWith", () => {
  it("returns the updater's result when the updater runs once", async () => {
    const ref = singleRef({ n: 1 });

    const result = await updateStateWith(ref, (s) => ({
      state: { n: s.n + 1 },
      result: `saw ${s.n}`,
    }));

    expect(result).toBe("saw 1");
    expect(ref.committed).toEqual([{ n: 2 }]);
  });

  it("returns the SECOND invocation's result when the updater is replayed", async () => {
    const ref = replayingRef({ n: 1 }, { n: 99 });

    const result = await updateStateWith(ref, (s) => ({
      state: { n: s.n + 1 },
      result: `saw ${s.n}`,
    }));

    expect(result).toBe("saw 99");
    expect(ref.committed).toEqual([{ n: 100 }]);
  });

  it("reports nothing when the replay reaches a non-committing branch", async () => {
    // The defect shape this helper exists to remove: attempt 1 finds work to
    // do, attempt 2 finds it already done. The caller must see attempt 2.
    const ref = replayingRef({ n: 1 }, { n: 0 });

    const result = await updateStateWith(ref, (s) => {
      if (s.n === 0) return { state: s, result: undefined };
      return { state: { n: 0 }, result: "removed" };
    });

    expect(result).toBeUndefined();
  });

  it("propagates a throw from the replayed invocation rather than reporting attempt 1", async () => {
    const ref = replayingRef({ n: 1 }, { n: 99 });

    await expect(
      updateStateWith(ref, (s) => {
        if (s.n === 99) throw new Error("boom");
        return { state: { n: 2 }, result: "reported" };
      })
    ).rejects.toThrow("boom");
  });

  it("awaits an async updater", async () => {
    const ref = singleRef({ n: 5 });

    const result = await updateStateWith(ref, async (s) => {
      await Promise.resolve();
      return { state: { n: s.n * 2 }, result: s.n };
    });

    expect(result).toBe(5);
    expect(ref.committed).toEqual([{ n: 10 }]);
  });

  it("preserves the ref's `this` binding", async () => {
    class Ref {
      state: Counter = { n: 0 };
      seen = 0;
      async updateState(updater: (s: Counter) => Counter | Promise<Counter>) {
        this.seen += 1; // throws if called unbound
        this.state = await updater(this.state);
      }
    }
    const ref = new Ref();

    const result = await updateStateWith(ref, (s) => ({
      state: { n: s.n + 1 },
      result: "ok",
    }));

    expect(result).toBe("ok");
    expect(ref.seen).toBe(1);
  });
});

describe("withOutcome", () => {
  it("works against a runner that is not a resource ref", async () => {
    // The `casWrite` shape: `(mutate) => Promise<void>`, where the mutator
    // returns `undefined` to mean "no-op". It never carries `updateState`.
    const attempts: Array<Record<string, number> | undefined> = [];
    const casWrite = async (
      mutate: (tasks: Record<string, number>) => Record<string, number> | undefined
    ) => {
      attempts.push(mutate({ a: 1 })); // losing attempt
      attempts.push(mutate({ a: 1, b: 2 })); // winner
    };

    const result = await withOutcome(casWrite, (tasks) => {
      const ids = Object.keys(tasks);
      return { state: { ...tasks, done: 1 }, result: ids };
    });

    expect(result).toEqual(["a", "b"]);
    expect(attempts).toEqual([
      { a: 1, done: 1 },
      { a: 1, b: 2, done: 1 },
    ]);
  });

  it("passes a no-op mutator return straight through to the runner", async () => {
    const seen: Array<Record<string, number> | undefined> = [];
    const casWrite = async (
      mutate: (tasks: Record<string, number>) => Record<string, number> | undefined
    ) => {
      seen.push(mutate({ a: 1 }));
    };

    const result = await withOutcome(casWrite, () => ({
      state: undefined,
      result: "declined",
    }));

    expect(result).toBe("declined");
    expect(seen).toEqual([undefined]);
  });

  it("returns undefined when the runner never invokes the updater", async () => {
    const neverRuns = async () => {};

    const result = await withOutcome(neverRuns, () => ({
      state: { n: 1 },
      result: "unreachable",
    }));

    expect(result).toBeUndefined();
  });

  it("does not swallow a throw from the updater", async () => {
    const run = vi.fn(async (mutate: (s: Counter) => Counter) => {
      mutate({ n: 1 });
    });

    await expect(
      withOutcome(run, () => {
        throw new Error("updater blew up");
      })
    ).rejects.toThrow("updater blew up");
  });

  it("reports nothing when a runner absorbs the replay's throw", async () => {
    // This is the guard for the per-invocation reset. `runWithCAS` propagates
    // a mutator throw, so a resource-side replay can never observe a stale
    // outcome — but `withOutcome` takes an arbitrary runner, and a runner that
    // treats a throwing attempt as "no write" and returns normally would leak
    // attempt 1's outcome for a write that never committed. Without the reset
    // inside the mutator this returns "committed" instead of undefined.
    const bestEffortRun = async (mutate: (s: Counter) => Counter) => {
      mutate({ n: 1 }); // attempt 1 succeeds, reports
      try {
        mutate({ n: 2 }); // attempt 2 throws — absorbed, nothing commits
      } catch {
        /* the runner decides this write is a no-op */
      }
    };

    const result = await withOutcome(bestEffortRun, (s) => {
      if (s.n === 2) throw new Error("conflict");
      return { state: { n: s.n + 1 }, result: "committed" };
    });

    expect(result).toBeUndefined();
  });
});
