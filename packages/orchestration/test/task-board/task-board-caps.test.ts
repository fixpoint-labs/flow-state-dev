/**
 * Task creation caps at the BOARD seam (FIX-931).
 *
 * The collection-level invariants live in `test/collection/task-caps.test.ts`.
 * What is asserted here is the rule that decides WHERE the caps come from:
 * caps belong to the collection, so `taskBoard` applies them only when it is the
 * one constructing it. A supplied collection is left entirely alone, and asking
 * for both is a construction error rather than a retrofit the board cannot
 * honestly perform.
 *
 * Plus the two writer paths that would otherwise resolve their own uncapped ref
 * for the same logical board — `getOrCreateTaskCollection` never caches, so
 * "the caps live in the collection" only holds if every writer goes through the
 * board's resolver.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { runForTest, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createSequencerBackedTaskCollection,
  defineTaskCollection,
  getOrCreateTaskCollection,
  TaskCapExceededError,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import {
  createApplyReplan,
  createSeedCollection,
  taskBoard,
  taskWorkerInputSchema,
} from "../../src/task-board";
import { createFakeSequencerState } from "../helpers";

const noopWorker = handler({
  name: "caps-noop",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.null(),
  execute: () => null,
}) as TaskWorker;

function cappedCollection(caps: {
  maxTotalTasks?: number | null;
  maxEnqueuedTasks?: number | null;
}): TaskCollectionRef {
  return createSequencerBackedTaskCollection({
    collectionId: "capped",
    sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    ...caps,
  });
}

/** A ctx stub for blocks that never touch anything but the injected collection. */
function bareCtx(cap?: Record<string, unknown>) {
  return {
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: { identity: { id: "s1", userId: "u1" }, state: {}, patchState: async () => {} },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: { get: () => undefined, list: () => [] },
    signal: new AbortController().signal,
    response: { emit: async () => {}, getItems: () => [] },
    cap: cap ?? {},
    sequencer: { state: {} },
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  } as never;
}

/**
 * Drive a board's capability accessor from a real block, so the writes go
 * through `ctx.cap.<board>` exactly as a consumer's would. Adds `count` tasks
 * and reports the first cap breach, if any.
 */
function capabilityWriter(board: ReturnType<typeof taskBoard>, count: number) {
  return handler({
    name: `${board.collectionId}-cap-writer`,
    uses: [board.capability],
    inputSchema: z.unknown(),
    outputSchema: z.object({
      added: z.number(),
      error: z.string().nullable(),
      viaEscapeHatch: z.string().nullable(),
    }),
    execute: async (_input, ctx) => {
      const accessor = (ctx.cap as Record<string, never>)[board.capability.name] as unknown as {
        addTask: (init: { goal: string }) => Promise<unknown>;
        tasks: () => Promise<TaskCollectionRef>;
      };
      let added = 0;
      let error: string | null = null;
      for (let i = 0; i < count; i++) {
        try {
          await accessor.addTask({ goal: `t-${i}` });
          added++;
        } catch (err) {
          error = err instanceof TaskCapExceededError ? err.cap : `unexpected: ${String(err)}`;
          break;
        }
      }
      // The `tasks()` escape hatch hands back the same ref, so it must be
      // capped too — it is not a bypass.
      let viaEscapeHatch: string | null = null;
      try {
        await (await accessor.tasks()).addTask({ goal: "escape-hatch" });
      } catch (err) {
        viaEscapeHatch = err instanceof TaskCapExceededError ? err.cap : `unexpected: ${String(err)}`;
      }
      return { added, error, viaEscapeHatch };
    },
  });
}

async function writeVia(board: ReturnType<typeof taskBoard>, count: number) {
  const result = await testBlock(capabilityWriter(board, count) as never, {
    input: undefined as never,
  });
  expect(result.error).toBeNull();
  return result.output as { added: number; error: string | null; viaEscapeHatch: string | null };
}

// ---------------------------------------------------------------------------
// Where the caps come from
// ---------------------------------------------------------------------------

describe("taskBoard caps — a board that CONSTRUCTS its collection", () => {
  it("applies the 500/100 defaults, so a 101-task burst is refused", async () => {
    const board = taskBoard({ name: "cap-defaults", workers: noopWorker });
    const out = await writeVia(board, 101);
    expect(out.added).toBe(100);
    expect(out.error).toBe("enqueued");
    expect(out.viaEscapeHatch).toBe("enqueued");
  });

  it("lets an explicit override bite instead of the default", async () => {
    const board = taskBoard({
      name: "cap-override",
      workers: noopWorker,
      maxEnqueuedTasks: 3,
      maxTotalTasks: 10,
    });
    const out = await writeVia(board, 5);
    expect(out.added).toBe(3);
    expect(out.error).toBe("enqueued");
  });

  it("reports the lifetime bound distinctly from the enqueue bound", async () => {
    const board = taskBoard({
      name: "cap-total",
      workers: noopWorker,
      maxTotalTasks: 4,
      maxEnqueuedTasks: 4,
    });
    const out = await writeVia(board, 6);
    expect(out.added).toBe(4);
    expect(out.error).toBe("total");
  });

  it("treats `null` as the in-place opt-out (the documented migration)", async () => {
    const board = taskBoard({
      name: "cap-null",
      workers: noopWorker,
      maxTotalTasks: null,
      maxEnqueuedTasks: null,
    });
    // Past the default 100 that would otherwise apply.
    const out = await writeVia(board, 120);
    expect(out.added).toBe(120);
    expect(out.error).toBeNull();
    expect(out.viaEscapeHatch).toBeNull();
  });

  it("rejects an invalid cap at taskBoard() construction, like concurrency does", () => {
    expect(() =>
      taskBoard({ name: "bad-cap", workers: noopWorker, maxTotalTasks: 0 }),
    ).toThrow(/maxTotalTasks/);
    expect(() =>
      taskBoard({ name: "bad-cap-2", workers: noopWorker, maxEnqueuedTasks: 1.5 }),
    ).toThrow(/maxEnqueuedTasks/);
    expect(() =>
      taskBoard({
        name: "bad-cap-3",
        workers: noopWorker,
        maxTotalTasks: 5,
        maxEnqueuedTasks: 6,
      }),
    ).toThrow(/must be <= maxTotalTasks/);
  });

  it("caps the sequencer opt-in the same way as the request default", () => {
    // Constructed, not supplied — so it takes caps without complaint.
    expect(() =>
      taskBoard({
        name: "cap-seq",
        collection: { backing: "sequencer", collectionId: "cap-seq" },
        workers: noopWorker,
        maxEnqueuedTasks: 5,
      }),
    ).not.toThrow();
  });
});

describe("taskBoard caps — a SUPPLIED collection is the sole authority", () => {
  it("refuses cap options alongside a defineTaskCollection", () => {
    expect(() =>
      taskBoard({
        name: "durable-capped",
        collection: defineTaskCollection({ id: "durable-coll", scope: "session" }),
        workers: noopWorker,
        maxTotalTasks: 10,
      }),
    ).toThrow(/caps belong to the collection/);
  });

  it("refuses cap options alongside a collection factory", () => {
    expect(() =>
      taskBoard({
        name: "factory-capped",
        collection: (ctx) =>
          getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "fc" }),
        workers: noopWorker,
        maxEnqueuedTasks: 5,
      }),
    ).toThrow(/caps belong to the collection/);
  });

  it("leaves a durable board exactly as it is today — no defaults, no inspection", () => {
    const board = taskBoard({
      name: "durable-plain",
      collection: defineTaskCollection({ id: "durable-plain-coll", scope: "session" }),
      workers: noopWorker,
    });
    expect(board.backing).toBe("resource");
  });

  it("leaves a factory-supplied board uncapped and drainable, exactly as today", async () => {
    // The delegation drain is itself this shape, so this must keep working —
    // and must NOT inherit the 500/100 defaults, since the board did not build
    // the collection it was handed.
    const supplied = cappedCollection({});
    const board = taskBoard({
      name: "factory-plain",
      collection: () => supplied,
      workers: noopWorker,
      dispatcher: "fifo",
      initialTasks: Array.from({ length: 120 }, (_, i) => ({ id: `t-${i}`, goal: `t-${i}` })),
    });
    expect(board.backing).toBe("factory");

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    // 120 > the default enqueue cap: proof no default leaked onto the supplied
    // collection.
    expect(supplied.count()).toBe(120);
    expect(supplied.count({ status: "completed" })).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Internal batch callers: atomic AND loud
// ---------------------------------------------------------------------------

describe("initialTasks seed — atomic, loud, and still idempotent", () => {
  it("leaves the board EMPTY when the seed is oversized, not partially filled", async () => {
    const collection = cappedCollection({ maxEnqueuedTasks: 2 });
    const seed = createSeedCollection({
      name: "seed-oversized",
      collection: async () => collection,
      initialTasks: [{ goal: "a" }, { goal: "b" }, { goal: "c" }],
    });

    await expect(runForTest(seed as never, undefined as never, bareCtx())).rejects.toThrow(
      TaskCapExceededError,
    );
    // Asserting the COUNT, not just the throw: a per-task loop would commit two
    // and then throw, which a throw-only assertion could not tell apart.
    expect(collection.count()).toBe(0);
  });

  it("still skips ids already present in the collection (replay idempotency)", async () => {
    const collection = cappedCollection({});
    await collection.addTask({ id: "t1", goal: "already here" });
    const seed = createSeedCollection({
      name: "seed-replay",
      collection: async () => collection,
      initialTasks: [{ id: "t1", goal: "a" }, { id: "t2", goal: "b" }],
    });

    await runForTest(seed as never, undefined as never, bareCtx());
    expect(collection.count()).toBe(2);
    expect(collection.get("t1")?.goal).toBe("already here");
  });

  it("skips a duplicate id WITHIN one seed rather than rejecting the whole seed", async () => {
    // Regression guard for the atomic rewrite. The old per-task loop re-read
    // `collection.get` after each awaited insert, so it skipped within-seed
    // duplicates for free. A one-time pre-filter would let both copies reach
    // `addTasks`, whose duplicate-id guard rejects the ENTIRE batch.
    const collection = cappedCollection({});
    const seed = createSeedCollection({
      name: "seed-dupe",
      collection: async () => collection,
      initialTasks: [
        { id: "t1", goal: "first" },
        { id: "t1", goal: "second copy" },
        { id: "t2", goal: "other" },
      ],
    });

    await runForTest(seed as never, undefined as never, bareCtx());
    expect(collection.count()).toBe(2);
    expect(collection.get("t1")?.goal).toBe("first");
    expect(collection.get("t2")).toBeDefined();
  });

  it("adds every idless task, unchanged from today", async () => {
    const collection = cappedCollection({});
    const seed = createSeedCollection({
      name: "seed-idless",
      collection: async () => collection,
      initialTasks: [{ goal: "a" }, { goal: "a" }],
    });
    await runForTest(seed as never, undefined as never, bareCtx());
    expect(collection.count()).toBe(2);
  });
});

describe("applyReplan — propagates the breach and inserts nothing", () => {
  it("throws and leaves the capped board untouched when the batch is oversized", async () => {
    const collection = cappedCollection({ maxEnqueuedTasks: 2 });
    await collection.addTask({ goal: "existing" });

    const capability = { name: "replanBoard" } as never;
    const applyReplan = createApplyReplan({
      name: "replanBoard",
      maxAttemptsPerTask: 1,
      capability,
    });

    const ctx = bareCtx({
      replanBoard: { tasks: async () => collection },
    });

    await expect(
      runForTest(
        applyReplan as never,
        { tasks: [{ goal: "x" }, { goal: "y" }, { goal: "z" }] } as never,
        ctx,
      ),
    ).rejects.toThrow(TaskCapExceededError);
    expect(collection.count()).toBe(1);
  });
});
