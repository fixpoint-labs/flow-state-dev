/**
 * The cumulative retry budget at the BOARD seam (FIX-948).
 *
 * The collection-level invariants live in `test/collection/retry-budget.test.ts`.
 * What is asserted here is everything the board is responsible for: where the
 * knob comes from, which board-building surfaces get it at all, and — the part
 * that makes the bound worth having — that the completion item reports the
 * budget HONESTLY.
 *
 * "Honestly" is three separate properties, and each has its own test because
 * each has its own way of lying:
 *
 * 1. The retry COUNT is real on every backing, including the durable one that
 *    enforces nothing.
 * 2. The LIMIT is read from the collection, so a supplied collection that
 *    genuinely enforces reports its own number rather than a confident `null`.
 * 3. The termination REASON comes from a persisted denial marker, never from
 *    `retries === limit` — arithmetic that does not establish a refusal.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  DEFAULT_MAX_TOTAL_RETRIES,
  getOrCreateTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import { createBoardMetaCompleted } from "../../src/task-board/blocks/board-meta";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

/** A worker that always fails — the deterministic storm. */
const alwaysFails = handler({
  name: "retry-budget-always-fails",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.null(),
  execute: () => {
    throw new Error("worker exploded");
  },
}) as TaskWorker;

const noopWorker = handler({
  name: "retry-budget-noop",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.null(),
  execute: () => null,
}) as TaskWorker;

function budgetedCollection(caps: {
  maxTotalTasks?: number | null;
  maxEnqueuedTasks?: number | null;
  maxTotalRetries?: number | null;
}): TaskCollectionRef {
  return createSequencerBackedTaskCollection({
    collectionId: "budgeted",
    sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    ...caps,
  });
}

/**
 * Run the board's completion block over `collection` through the real block
 * runner and return the `task-board-meta` payload it emitted.
 */
async function reportFor(collection: TaskCollectionRef): Promise<{
  terminationReason: string;
  counts: Record<string, number>;
  maxTotalRetries: number | null;
}> {
  const block = createBoardMetaCompleted({
    name: "retry-budget-meta",
    collection: async () => collection,
    collectionId: collection.collectionId,
  });
  const result = await testBlock(block, { input: undefined });
  expect(result.error).toBeNull();
  type MetaItem = { type?: string; component?: string; data?: unknown };
  const meta = (result.items as MetaItem[]).find(
    (i) => i.type === "component" && i.component === "task-board-meta",
  );
  return meta?.data as never;
}

/** Claim the next ready task and fail it. */
async function claimAndFail(collection: TaskCollectionRef, worker = "w1"): Promise<Task | null> {
  const claimed = await collection.claim(worker);
  if (claimed === null) return null;
  await collection.fail(claimed.id, "boom");
  return collection.get(claimed.id) ?? null;
}

describe("retry budget — where the knob comes from", () => {
  it("applies the default to a board that constructs its own collection", () => {
    const board = taskBoard({ name: "rb-default", workers: noopWorker });
    expect(board.caps.maxTotalRetries).toBe(DEFAULT_MAX_TOTAL_RETRIES);
  });

  it("takes an explicit budget, including `0` and `null`", () => {
    expect(
      taskBoard({ name: "rb-set", workers: noopWorker, maxTotalRetries: 7 }).caps
        .maxTotalRetries,
    ).toBe(7);
    // `0` is legal here and NOT on the creation caps: "run every task once,
    // never retry" is a coherent configuration, and omission/`null` cannot
    // express it.
    expect(
      taskBoard({ name: "rb-zero", workers: noopWorker, maxTotalRetries: 0 }).caps
        .maxTotalRetries,
    ).toBe(0);
    expect(
      taskBoard({ name: "rb-null", workers: noopWorker, maxTotalRetries: null }).caps
        .maxTotalRetries,
    ).toBeNull();
  });

  it("refuses a nonsensical budget at construction rather than disabling the guard", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        taskBoard({ name: `rb-bad-${bad}`, workers: noopWorker, maxTotalRetries: bad }),
      ).toThrow(/nonnegative integer/);
    }
  });

  it("refuses the option alongside a supplied collection — caps belong to the collection", () => {
    expect(() =>
      taskBoard({
        name: "rb-supplied",
        workers: noopWorker,
        collection: () => budgetedCollection({ maxTotalRetries: 5 }),
        maxTotalRetries: 5,
      }),
    ).toThrow(/maxTotalRetries/);
  });

  it("reaches the collection a declarative board resolves", async () => {
    const board = taskBoard({
      name: "rb-reaches",
      workers: noopWorker,
      maxTotalRetries: 3,
    });
    const probe = handler({
      name: "rb-probe",
      uses: [board.capability],
      inputSchema: z.unknown(),
      outputSchema: z.object({ limit: z.number().nullable() }),
      execute: async (_input, ctx) => {
        const accessor = (ctx.cap as Record<string, never>)[board.capability.name] as unknown as {
          tasks: () => Promise<TaskCollectionRef>;
        };
        const collection = await accessor.tasks();
        return { limit: collection.maxTotalRetries };
      },
    });
    const result = await testBlock(probe, { input: undefined });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ limit: 3 });
  });
});

describe("retry budget — the board reports it honestly", () => {
  it("reports the retry count, the limit in force, and the budget termination reason", async () => {
    const collection = budgetedCollection({ maxTotalRetries: 2 });
    await collection.addTask({ goal: "flaky", maxAttempts: 100 });

    // Three failure cycles: two granted, the third denied by the budget.
    await claimAndFail(collection);
    await claimAndFail(collection);
    await claimAndFail(collection);

    const report = await reportFor(collection);
    expect(report.counts.retries).toBe(2);
    expect(report.maxTotalRetries).toBe(2);
    expect(report.terminationReason).toBe("retry-budget-exhausted");
  });

  it("still reports `all-completed` for a clean drain", async () => {
    const collection = budgetedCollection({ maxTotalRetries: 5 });
    const task = await collection.addTask({ goal: "fine" });
    await collection.claim("w1");
    await collection.complete(task.id, "done");

    const report = await reportFor(collection);
    expect(report.terminationReason).toBe("all-completed");
    expect(report.counts.retries).toBe(0);
  });

  it("reports `blocked-by-failures` when the count EQUALS the limit but nothing was denied", async () => {
    // The reason must come from a persisted denial marker, never from
    // `retries === limit`. Here the last grant is consumed by a task that then
    // SUCCEEDS, while an unrelated task carrying no `maxAttempts` fails
    // normally — leaving the count exactly at the limit, an errored task on the
    // board, and no retry ever refused. Inferring the reason arithmetically
    // would make the board claim its budget stopped it, which is a lie.
    const collection = budgetedCollection({ maxTotalRetries: 1 });
    const flaky = await collection.addTask({ goal: "flaky", maxAttempts: 5 });
    const doomed = await collection.addTask({ goal: "doomed" });

    await collection.claim("w1", { eligibility: (t) => t.id === flaky.id });
    await collection.fail(flaky.id, "first try"); // consumes the only grant
    await collection.claim("w1", { eligibility: (t) => t.id === flaky.id });
    await collection.complete(flaky.id, "second try worked");

    await collection.claim("w2", { eligibility: (t) => t.id === doomed.id });
    await collection.fail(doomed.id, "no retry budget of its own");

    const report = await reportFor(collection);
    expect(report.counts.retries).toBe(1);
    expect(report.maxTotalRetries).toBe(1);
    expect(report.terminationReason).toBe("blocked-by-failures");
  });

  it("reports a SUPPLIED collection's own limit, not `null`", async () => {
    // `resolveBoardCaps` returns `{}` for a supplied collection, so a
    // board-sourced limit would be `null` here — stating "nothing was enforced"
    // about a limit the caller set deliberately. The reporter reads the limit
    // off the collection, where enforcement actually lives.
    const supplied = await getOrCreateTaskCollection({
      ctx: { emit: { component: () => {} }, response: undefined } as never,
      backing: "sequencer",
      collectionId: "caller-built",
      sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      maxTotalRetries: 5,
    });
    await supplied.addTask({ goal: "t" });

    const report = await reportFor(supplied);
    expect(report.maxTotalRetries).toBe(5);
  });

  it("reports a true count with `limit: null` on the durable backing", async () => {
    // Counting and enforcing are separate. The resource backing maintains the
    // count — a durable board reporting zero retries having retried would be a
    // false statement on a public surface — but enforces nothing, so the limit
    // it reports is `null`. Asserting both together is what makes the pair
    // unambiguous rather than merely documented.
    const collection = await createResourceBackedTaskCollection({
      collectionId: "durable",
      collection: createFakeResourceCollection(),
    });
    await collection.addTask({ goal: "flaky", maxAttempts: 5 });
    await claimAndFail(collection);
    await claimAndFail(collection);

    const report = await reportFor(collection);
    expect(report.counts.retries).toBe(2);
    expect(report.maxTotalRetries).toBeNull();
    // Counted, never denied — nothing enforced here.
    expect(report.terminationReason).not.toBe("retry-budget-exhausted");
  });
});

describe("retry budget — the request backing inherits the sequencer path", () => {
  it("counts AND enforces, with no separate implementation", async () => {
    const requestState: Record<string, unknown> = {};
    const ctx = {
      emit: { component: () => {} },
      response: undefined,
      request: {
        identity: { id: "r1", userId: "u1" },
        get state() {
          return requestState;
        },
        atomicState: async (fn: (s: Record<string, unknown>) => Record<string, unknown>) => {
          Object.assign(requestState, fn(requestState));
        },
        patchState: async () => {},
        setState: async () => {},
        incState: async () => {},
        pushState: async () => {},
        setStateRecord: async () => {},
        deleteStateRecord: async () => {},
      },
    } as never;

    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId: "req-board",
      maxTotalRetries: 1,
    });
    await collection.addTask({ goal: "flaky", maxAttempts: 100 });

    await claimAndFail(collection);
    const settled = await claimAndFail(collection);

    expect(collection.maxTotalRetries).toBe(1);
    expect(settled?.status).toBe("errored");
    const report = await reportFor(collection);
    expect(report.counts.retries).toBe(1);
    expect(report.terminationReason).toBe("retry-budget-exhausted");
  });
});

// ---------------------------------------------------------------------------
// The goal, on the real path
// ---------------------------------------------------------------------------

/**
 * **Goal:** an operator can bound how much a task board spends on retries, and
 * the board tells them when that bound is what stopped it.
 *
 * Driven through a real `taskBoard(...).drain` — the actual worker loop, claim
 * cycle, and failure write-back — rather than by calling `fail()` directly, so
 * what is proven is the board's behaviour and not the collection's.
 *
 * Model-free deliberately, and not as a cost-driven skip: the bound is a
 * substrate invariant over the ledger. A real model would add spend and
 * nondeterminism without adding evidence, while a deterministic always-failing
 * worker makes the storm reproducible — a strictly stronger probe.
 */
describe("retry budget — goal check on a real board drain", () => {
  it("stops a storm at the budget and reports the budget as the reason", async () => {
    const board = taskBoard({
      name: "retry-storm",
      collection: { collectionId: "retry-storm" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: alwaysFails,
      // The storm: a permissive per-task retry budget that would otherwise
      // re-pend this task 1000 times, with generous creation caps that never
      // move because no task is ever created.
      maxTotalTasks: 500,
      maxEnqueuedTasks: 100,
      maxTotalRetries: 3,
      initialTasks: [{ id: "flaky", goal: "always fails", maxAttempts: 1000 }],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();

    type MetaItem = {
      type?: string;
      component?: string;
      data?: {
        status?: string;
        terminationReason?: string;
        counts?: Record<string, number>;
        maxTotalRetries?: number | null;
      };
    };
    const meta = (result.items as MetaItem[]).find(
      (i) =>
        i.type === "component" &&
        i.component === "task-board-meta" &&
        i.data?.status === "completed",
    );

    expect(meta?.data?.terminationReason).toBe("retry-budget-exhausted");
    expect(meta?.data?.counts?.retries).toBe(3);
    expect(meta?.data?.maxTotalRetries).toBe(3);
    // The task settled rather than being parked or left pending.
    expect(meta?.data?.counts?.errored).toBe(1);
    expect(meta?.data?.counts?.pending).toBe(0);
    expect(meta?.data?.counts?.in_progress).toBe(0);
  });
});
