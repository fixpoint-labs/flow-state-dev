/**
 * Cumulative retry budget (FIX-948) at the collection seam — where enforcement
 * lives.
 *
 * The two creation caps (FIX-931) count only *new* tasks, and a retry re-runs a
 * task that already exists. So a task that keeps failing keeps spending while
 * `maxTotalTasks` / `maxEnqueuedTasks` sit still. `maxTotalRetries` is the one
 * directly-expressed bound on that, and this file asserts the three properties
 * it needs: it counts the retries actually AUTHORIZED (not re-claims after an
 * unblock/resume/reclaim), it decides inside the same atomic write that records
 * the grant, and it settles terminally only where a settlement is legal.
 */
import { describe, expect, it } from "vitest";
import {
  createSequencerBackedTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeSequencerState, createCapturedChanges } from "../helpers";

function makeCollection(
  caps: {
    maxTotalTasks?: number | null;
    maxEnqueuedTasks?: number | null;
    maxTotalRetries?: number | null;
  } = {},
  seed: Record<string, unknown> = {},
): TaskCollectionRef {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: seed,
  });
  return createSequencerBackedTaskCollection({
    collectionId: "budgeted",
    sequencer,
    ...caps,
  });
}

/** Claim the next ready task and fail it — one full failure cycle. */
async function claimAndFail(
  collection: TaskCollectionRef,
  error = "boom",
): Promise<Task | null> {
  const claimed = await collection.claim("w1");
  if (claimed === null) return null;
  await collection.fail(claimed.id, error);
  return collection.get(claimed.id) ?? null;
}

describe("retry budget — the storm the creation caps cannot see (FIX-948 reproduction)", () => {
  it("bounds a permissive `maxAttempts` re-pend loop that leaves both creation caps sitting still", async () => {
    // One task, a permissive per-task retry budget, and generous creation caps.
    // This is the storm: every cycle is a fresh model call in production, and
    // neither creation cap moves because no task is ever created.
    const collection = makeCollection({
      maxTotalTasks: 500,
      maxEnqueuedTasks: 100,
      maxTotalRetries: 3,
    });
    const task = await collection.addTask({ goal: "flaky", maxAttempts: 1_000 });

    let cycles = 0;
    while (cycles < 50) {
      const after = await claimAndFail(collection);
      cycles++;
      if (after === null || after.status !== "pending") break;
    }

    const settled = collection.get(task.id);
    // The board stops retrying at the budget rather than looping to the
    // per-task ceiling: 3 authorized retries, then the 4th failure settles.
    expect(cycles).toBe(4);
    expect(settled?.status).toBe("errored");
    expect(settled?.error).toContain("retry budget");

    // The reason this bound had to be added: both creation caps are still
    // reporting the board is comfortably under its ceiling.
    expect(collection.count()).toBe(1);
    expect(collection.count({ status: "pending" })).toBe(0);
  });

  it("is unbounded on this axis when the budget is `null` — today's behaviour exactly", async () => {
    const collection = makeCollection({ maxTotalRetries: null });
    const task = await collection.addTask({ goal: "flaky", maxAttempts: 20 });

    for (let i = 0; i < 10; i++) await claimAndFail(collection);

    expect(collection.get(task.id)?.status).toBe("pending");
  });
});

describe("retry budget — what is counted", () => {
  it("counts only authorized failure retries, never `unblock` / `resumeFromReview` / `reclaim`", async () => {
    // A budget of 1 with three non-retry re-entries in front of it. If any of
    // them consumed the budget, the single real failure below would settle
    // terminally — a board reporting "retry budget exhausted" having never
    // retried a failure, which is exactly the dishonest report this bound
    // exists to remove.
    const collection = makeCollection({ maxTotalRetries: 1 });
    const task = await collection.addTask({ goal: "t", maxAttempts: 10 });

    await collection.block(task.id);
    await collection.unblock(task.id);
    await collection.claim("w1");
    await collection.awaitReview(task.id);
    await collection.resumeFromReview(task.id);
    await collection.claim("w1");
    // Reclaim needs an expired lease — claim above set one 30s out.
    await collection.reclaim(Date.now() + 60_000);
    await collection.claim("w1");

    await collection.fail(task.id, "first real failure");
    expect(collection.get(task.id)?.status).toBe("pending");
  });

  it("keeps a grant spent when the retry is never claimed", async () => {
    // The budget is spent at AUTHORIZATION, so a re-pended task whose worker
    // died or whose lease expired does not get its grant back. Refunding would
    // mean treating an expired lease as evidence of abandonment, which the
    // substrate does not do.
    const collection = makeCollection({ maxTotalRetries: 1 });
    const abandoned = await collection.addTask({ goal: "abandoned", maxAttempts: 5 });
    await collection.claim("w1");
    await collection.fail(abandoned.id, "worker died mid-attempt");
    expect(collection.get(abandoned.id)?.status).toBe("pending");

    // The retry is never claimed; the lease reclaim re-pends it again without
    // touching the ledger.
    await collection.reclaim(Date.now() + 60_000);

    // The board's only grant is gone, so a genuine failure elsewhere settles.
    const other = await collection.addTask({ goal: "other", maxAttempts: 5 });
    await collection.claim("w2", { eligibility: (t) => t.id === other.id });
    await collection.fail(other.id, "boom");
    expect(collection.get(other.id)?.status).toBe("errored");
  });

  it("never refuses a first attempt, even at a budget of `0`", async () => {
    const collection = makeCollection({ maxTotalRetries: 0 });
    const a = await collection.addTask({ goal: "a", maxAttempts: 3 });
    const b = await collection.addTask({ goal: "b", maxAttempts: 3 });

    const claimedA = await collection.claim("w1");
    const claimedB = await collection.claim("w2");
    expect(claimedA?.id).toBe(a.id);
    expect(claimedB?.id).toBe(b.id);

    // Both ran once; neither retries.
    await collection.fail(a.id, "boom");
    await collection.fail(b.id, "boom");
    expect(collection.get(a.id)?.status).toBe("errored");
    expect(collection.get(b.id)?.status).toBe("errored");
  });
});

describe("retry budget — the boundary lands exactly the budget's worth", () => {
  it("admits exactly one retry across two SEQUENTIAL first-attempt failures at a budget of 1", async () => {
    // The regression test for the rejected `Σ max(0, attempts − 1)` derivation.
    // `attempts` moves at the NEXT claim, not when the retry is authorized, so
    // under that quantity both failures below read a board total of zero and
    // both re-pend — even though they are strictly sequential.
    const collection = makeCollection({ maxTotalRetries: 1 });
    const a = await collection.addTask({ goal: "a", maxAttempts: 5 });
    const b = await collection.addTask({ goal: "b", maxAttempts: 5 });

    await collection.claim("w1");
    await collection.claim("w2");
    await collection.fail(a.id, "boom");
    await collection.fail(b.id, "boom");

    const statuses = [collection.get(a.id)?.status, collection.get(b.id)?.status];
    expect(statuses.filter((s) => s === "pending")).toHaveLength(1);
    expect(statuses.filter((s) => s === "errored")).toHaveLength(1);
  });

  it("admits exactly one retry across two CONCURRENT failures at a budget of 1", async () => {
    const collection = makeCollection({ maxTotalRetries: 1 });
    const a = await collection.addTask({ goal: "a", maxAttempts: 5 });
    const b = await collection.addTask({ goal: "b", maxAttempts: 5 });
    await collection.claim("w1");
    await collection.claim("w2");

    await Promise.all([collection.fail(a.id, "boom"), collection.fail(b.id, "boom")]);

    const statuses = [collection.get(a.id)?.status, collection.get(b.id)?.status];
    expect(statuses.filter((s) => s === "pending")).toHaveLength(1);
    expect(statuses.filter((s) => s === "errored")).toHaveLength(1);
  });
});

describe("retry budget — the denial is scoped to attempt-owned failures", () => {
  // `errored` is reachable from `in_progress` and `awaiting_review` and from
  // NEITHER `pending` nor `blocked`. The routing predicate is status-blind, so
  // without this gate a `fail()` on a pending/blocked task carrying
  // `maxAttempts` would attempt an illegal transition and THROW instead of
  // settling — on a reachable path.

  /**
   * Build a collection whose budget is either `0` or already spent, plus the
   * subject task in `status`. The spender is added FIRST so `claim` (ascending
   * `createdAt`) picks it, leaving the subject untouched in `pending`.
   */
  async function boardAtBound(
    budget: 0 | "exhausted",
    status: "pending" | "blocked",
  ): Promise<{ collection: TaskCollectionRef; taskId: string }> {
    const collection = makeCollection({ maxTotalRetries: budget === 0 ? 0 : 1 });
    if (budget === "exhausted") {
      const spender = await collection.addTask({ goal: "spender", maxAttempts: 5 });
      await collection.claim("w0");
      await collection.fail(spender.id, "spend the budget");
    }
    const task = await collection.addTask({ goal: "t", maxAttempts: 5 });
    if (status === "blocked") await collection.block(task.id);
    return { collection, taskId: task.id };
  }

  for (const budget of [0, "exhausted"] as const) {
    for (const status of ["pending", "blocked"] as const) {
      it(`re-pends a \`${status}\` task without throwing at a ${budget} budget`, async () => {
        const { collection, taskId } = await boardAtBound(budget, status);

        await expect(collection.fail(taskId, "boom")).resolves.toBeDefined();
        expect(collection.get(taskId)?.status).toBe("pending");
      });
    }
  }

  it("does not consume the budget from a non-attempt-owned status", async () => {
    const collection = makeCollection({ maxTotalRetries: 1 });
    const parked = await collection.addTask({ goal: "parked", maxAttempts: 5 });
    const real = await collection.addTask({ goal: "real", maxAttempts: 5 });

    // A `pending` fail re-pends but must not spend the board's allowance.
    await collection.fail(parked.id, "boom");

    await collection.claim("w1");
    await collection.claim("w2");
    await collection.fail(real.id, "boom");
    expect(collection.get(real.id)?.status).toBe("pending");
  });
});

describe("retry budget — the terminal settlement is honest", () => {
  it("names the board budget rather than the task's own `maxAttempts`", async () => {
    const collection = makeCollection({ maxTotalRetries: 0 });
    const task = await collection.addTask({ goal: "t", maxAttempts: 5 });
    await collection.claim("w1");
    await collection.fail(task.id, "worker exploded");

    const settled = collection.get(task.id);
    expect(settled?.status).toBe("errored");
    expect(settled?.error).toContain("retry budget");
    expect(settled?.error).toContain("worker exploded");
  });

  it("emits the existing `errored` change kind — no new change kind", async () => {
    const captured = createCapturedChanges();
    const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
      tasks: {},
    });
    const collection = createSequencerBackedTaskCollection({
      collectionId: "budgeted",
      sequencer,
      maxTotalRetries: 0,
      onChange: captured.onChange,
    });
    const task = await collection.addTask({ goal: "t", maxAttempts: 5 });
    await collection.claim("w1");
    await collection.fail(task.id, "boom");

    const kinds = captured.events.filter((e) => e.taskId === task.id).map((e) => e.kind);
    expect(kinds).toEqual(["added", "claimed", "errored"]);
  });

  it("reports `recorded` for a budget denial — not a new write outcome", async () => {
    const collection = makeCollection({ maxTotalRetries: 0 });
    const task = await collection.addTask({ goal: "t", maxAttempts: 5 });
    await collection.claim("w1");

    const outcome = await collection.fail(task.id, "boom");
    expect(outcome).toEqual({ outcome: "recorded" });
  });
});

describe("retry budget — legacy records (BP-030)", () => {
  it("reads a task persisted before the field as zero granted, not `NaN`", async () => {
    // A pre-upgrade record: `attempts` already high, and no retry ledger at all.
    const legacy = {
      id: "legacy",
      goal: "old",
      status: "in_progress",
      attempts: 7,
      maxAttempts: 100,
      createdAt: 1,
      updatedAt: 1,
    };
    const collection = makeCollection({ maxTotalRetries: 1 }, { legacy });

    // Counting begins at upgrade: the legacy record contributes zero, so this
    // failure is granted rather than denied by a `NaN` comparison.
    await collection.fail("legacy", "boom");
    expect(collection.get("legacy")?.status).toBe("pending");
  });

  it("does not backfill the granted count from `attempts`", async () => {
    // Locks the epoch: a later "helpful" backfill from `attempts` would
    // reintroduce exactly the non-retry re-claims the counted quantity rejects.
    const legacy = {
      id: "legacy",
      goal: "old",
      status: "in_progress",
      attempts: 9,
      maxAttempts: 100,
      createdAt: 1,
      updatedAt: 1,
    };
    const collection = makeCollection({ maxTotalRetries: 2 }, { legacy });

    await collection.fail("legacy", "boom");
    await collection.claim("w1");
    await collection.fail("legacy", "boom");
    // Two grants consumed post-upgrade; the third is the one that is refused.
    expect(collection.get("legacy")?.status).toBe("pending");
    await collection.claim("w1");
    await collection.fail("legacy", "boom");
    expect(collection.get("legacy")?.status).toBe("errored");
  });
});
