/**
 * Task creation caps (FIX-931) at the collection seam — where enforcement
 * actually lives.
 *
 * The two caps are only worth having if they are INTRINSIC (every insertion
 * path, not just the model-facing tool) and ATOMIC (same-step framework tool
 * calls run concurrently, so a read-then-insert is a time-of-check race). Both
 * properties are asserted here, together with the boundary the design does NOT
 * claim: `maxEnqueuedTasks` is enforced at creation only, so a task re-entering
 * `pending` may push it over. That last test exists so a future change cannot
 * quietly reintroduce a ceiling the design does not hold.
 */
import { describe, expect, it } from "vitest";
import {
  createSequencerBackedTaskCollection,
  TaskCapExceededError,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeSequencerState } from "../helpers";

function makeCollection(
  caps: { maxTotalTasks?: number | null; maxEnqueuedTasks?: number | null } = {},
): TaskCollectionRef {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  return createSequencerBackedTaskCollection({
    collectionId: "capped",
    sequencer,
    ...caps,
  });
}

/** The thrown value, asserted to be the typed breach rather than a bare Error. */
async function capBreach(fn: () => Promise<unknown>): Promise<TaskCapExceededError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof TaskCapExceededError) return err;
    throw new Error(`expected TaskCapExceededError, got: ${String(err)}`);
  }
  throw new Error("expected a TaskCapExceededError, but nothing was thrown");
}

describe("task caps — maxEnqueuedTasks (the enqueue-burst bound)", () => {
  it("refuses the add that would push `pending` past the cap, and inserts nothing", async () => {
    const collection = makeCollection({ maxEnqueuedTasks: 2 });
    await collection.addTask({ goal: "a" });
    await collection.addTask({ goal: "b" });

    const err = await capBreach(() => collection.addTask({ goal: "c" }));
    expect(err.cap).toBe("enqueued");
    expect(err.limit).toBe(2);
    expect(err.attempted).toBe(3);
    // The CAS no-ops on breach — a refused add is not a partial one.
    expect(collection.count()).toBe(2);
  });

  it("refreshes as tasks drain — claiming frees an enqueue slot", async () => {
    const collection = makeCollection({ maxEnqueuedTasks: 2 });
    await collection.addTask({ goal: "a" });
    await collection.addTask({ goal: "b" });
    await capBreach(() => collection.addTask({ goal: "c" }));

    // `claim` moves a task pending → in_progress. That is the whole mechanism:
    // the cap counts `pending`, so the slot is free again.
    const claimed = await collection.claim("w1");
    expect(claimed).not.toBeNull();

    const c = await collection.addTask({ goal: "c" });
    expect(c.status).toBe("pending");
    expect(collection.count({ status: "pending" })).toBe(2);
    expect(collection.count()).toBe(3);
  });

  it("bounds a CONCURRENT burst to exactly the cap's worth (CAS serializes)", async () => {
    const collection = makeCollection({ maxEnqueuedTasks: 3 });
    // Same-step framework tool calls run under Promise.all, which is precisely
    // what a "count then insert" guard cannot survive: all ten would read 0.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => collection.addTask({ goal: `t-${i}` })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(collection.count()).toBe(3);
    for (const rejected of results.filter((r) => r.status === "rejected")) {
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(TaskCapExceededError);
    }
  });

  it("is enforced at CREATION ONLY — a retry may re-pend past the cap", async () => {
    // The honest boundary (spec decision 4). `pending` can transiently exceed
    // the cap because re-entry is deliberately uncapped: capping it required a
    // park-and-promote mechanism whose recovery path never runs. If someone
    // later adds a ceiling on re-entry, this test fails — which is the point.
    const collection = makeCollection({ maxEnqueuedTasks: 1 });
    const a = await collection.addTask({ goal: "a", maxAttempts: 3 });
    await collection.claim("w1"); // A leaves pending, freeing the one slot
    await collection.addTask({ goal: "b" }); // B fills it

    await collection.fail(a.id, "transient");

    // A re-pended rather than being lost, parked, or refused.
    expect(collection.get(a.id)?.status).toBe("pending");
    expect(collection.count({ status: "pending" })).toBe(2);
  });
});

describe("task caps — maxTotalTasks (the lifetime bound)", () => {
  it("counts terminal tasks and is never refunded by draining", async () => {
    const collection = makeCollection({ maxTotalTasks: 3 });
    const a = await collection.addTask({ goal: "a" });
    const b = await collection.addTask({ goal: "b" });
    await collection.addTask({ goal: "c" });

    // Drain two to terminal states. A pending-only cap would now have room.
    await collection.claim("w1");
    await collection.complete(a.id, "done");
    await collection.claim("w1");
    await collection.fail(b.id, "boom");
    expect(collection.count({ status: "pending" })).toBe(1);

    const err = await capBreach(() => collection.addTask({ goal: "d" }));
    expect(err.cap).toBe("total");
    expect(err.limit).toBe(3);
    expect(err.attempted).toBe(4);
    expect(collection.count()).toBe(3);
  });

  it("bounds a CONCURRENT burst to exactly the cap's worth", async () => {
    // Enqueue bound left unset (unbounded) so the TOTAL cap is unambiguously
    // what binds here.
    const collection = makeCollection({ maxTotalTasks: 4 });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => collection.addTask({ goal: `t-${i}` })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(collection.count()).toBe(4);
  });
});

describe("task caps — batch addTasks is all-or-nothing", () => {
  it("rejects a batch crossing maxEnqueuedTasks without inserting any of it", async () => {
    const collection = makeCollection({ maxEnqueuedTasks: 3 });
    await collection.addTask({ goal: "a" });

    const err = await capBreach(() =>
      collection.addTasks([{ goal: "b" }, { goal: "c" }, { goal: "d" }]),
    );
    expect(err.cap).toBe("enqueued");
    // Not "three inserted, one refused" and not "two inserted up to the cap" —
    // nothing at all, because the guard runs inside the single CAS write.
    expect(collection.count()).toBe(1);
  });

  it("rejects a batch crossing maxTotalTasks without inserting any of it", async () => {
    const collection = makeCollection({ maxTotalTasks: 2, maxEnqueuedTasks: 2 });
    const err = await capBreach(() =>
      collection.addTasks([{ goal: "a" }, { goal: "b" }, { goal: "c" }]),
    );
    expect(err.cap).toBe("total");
    expect(collection.count()).toBe(0);
  });

  it("accepts a batch that lands exactly on the cap", async () => {
    const collection = makeCollection({ maxTotalTasks: 3, maxEnqueuedTasks: 3 });
    const added = await collection.addTasks([{ goal: "a" }, { goal: "b" }, { goal: "c" }]);
    expect(added).toHaveLength(3);
    expect(collection.count()).toBe(3);
  });
});

describe("task caps — off state", () => {
  it("is unbounded when neither cap is set (today's behavior)", async () => {
    const collection = makeCollection();
    for (let i = 0; i < 40; i++) await collection.addTask({ goal: `t-${i}` });
    expect(collection.count()).toBe(40);
  });

  it("treats an explicit `null` as unbounded on that axis", async () => {
    const collection = makeCollection({ maxTotalTasks: null, maxEnqueuedTasks: null });
    for (let i = 0; i < 40; i++) await collection.addTask({ goal: `t-${i}` });
    expect(collection.count()).toBe(40);
  });

  it("still enforces the other axis when one is `null`", async () => {
    const collection = makeCollection({ maxTotalTasks: null, maxEnqueuedTasks: 2 });
    await collection.addTasks([{ goal: "a" }, { goal: "b" }]);
    const err = await capBreach(() => collection.addTask({ goal: "c" }));
    expect(err.cap).toBe("enqueued");
  });
});

describe("task caps — construction-time validation", () => {
  const invalid = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
  ] as const;

  for (const [label, value] of invalid) {
    it(`rejects ${label} for maxTotalTasks`, () => {
      expect(() => makeCollection({ maxTotalTasks: value })).toThrow(/maxTotalTasks/);
    });
    it(`rejects ${label} for maxEnqueuedTasks`, () => {
      expect(() => makeCollection({ maxEnqueuedTasks: value })).toThrow(/maxEnqueuedTasks/);
    });
  }

  it("rejects an enqueue bound above the lifetime ceiling rather than clamping it", () => {
    expect(() => makeCollection({ maxTotalTasks: 10, maxEnqueuedTasks: 11 })).toThrow(
      /maxEnqueuedTasks .* must be <= maxTotalTasks/,
    );
  });

  it("accepts equal bounds", () => {
    expect(() => makeCollection({ maxTotalTasks: 10, maxEnqueuedTasks: 10 })).not.toThrow();
  });
});

// The rule that a cap passed with `backing: "resource"` does NOT COMPILE is
// asserted at the type level, in
// `src/tasks/collection/tests/task-caps.type-test.ts`. It cannot live here:
// this package's `typecheck` covers `src/**` only and vitest transpiles test
// files without checking types, so a `@ts-expect-error` in this directory would
// be inert.
