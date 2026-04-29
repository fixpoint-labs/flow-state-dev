/**
 * task-board pattern tests (FIX-446).
 *
 * Coverage:
 *   - block structure and validation
 *   - basic drain (single + multi worker)
 *   - dependency-gated dispatch (topological)
 *   - worker registry routing by task.assignee
 *   - CAS contention safety (no double-dispatch)
 *   - mid-drain enqueue (workers add new tasks during the drain)
 *   - worker failure: skip vs fail policies
 *   - awaiting_review: dispatcher skips, loop waits, resume wakes the loop
 *   - both onIdle modes (complete + wait)
 *   - individual remix blocks (select, claim, record)
 *
 * Workers throughout these tests use typed Zod schemas
 * (`taskWorkerInputSchema`) — the framework validates worker input at
 * every dispatch, which is the convention the pattern is designed
 * around. No `z.any()` escape hatches.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  fifoDispatcher,
  getOrCreateTaskCollection,
  type TaskWorker,
} from "@flow-state-dev/tasks";

import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
  createSelectNextReadyTask,
  createClaimTask,
  createRecordSuccess,
} from "../src/task-board";

// ---------------------------------------------------------------------------
// Schemas + helpers
// ---------------------------------------------------------------------------

const researchInputSchema = z.object({ topic: z.string() });
const echoWorkerInputSchema = taskWorkerInputSchema.extend({
  input: researchInputSchema.optional(),
});
const echoWorkerOutputSchema = z.object({ findings: z.string() });

/**
 * Echo worker — typed input/output. The pattern's worker registry /
 * uniform path takes any block whose input matches `TaskWorkerInput`;
 * each worker is free to narrow its own input schema (here we add a
 * concrete `input` shape) and declare its own output schema.
 */
function makeEchoWorker(name: string, traceTo?: string[]): TaskWorker {
  return handler({
    name,
    inputSchema: echoWorkerInputSchema,
    outputSchema: echoWorkerOutputSchema,
    execute: (input) => {
      const tag = `${name}:${input.input?.topic ?? input.goal}`;
      traceTo?.push(tag);
      return { findings: tag };
    },
  }) as TaskWorker;
}

const goalWorkerInputSchema = taskWorkerInputSchema;
const noOutputSchema = z.null();

function makeGoalWorker(
  name: string,
  body: (goal: string) => null
): TaskWorker {
  return handler({
    name,
    inputSchema: goalWorkerInputSchema,
    outputSchema: noOutputSchema,
    execute: (input) => body(input.goal),
  }) as TaskWorker;
}

/**
 * Build a map from task id → its terminal status by walking the
 * `task_change` items emitted on the stream. The substrate emits one
 * item per transition; the last one for a given id is the final
 * status.
 */
function lastTaskState(items: unknown[]): Map<string, string> {
  const finalStatus = new Map<string, string>();
  for (const item of items as Array<{
    type?: string;
    task?: { id: string; status: string };
  }>) {
    if (item.type === "task_change" && item.task !== undefined) {
      finalStatus.set(item.task.id, item.task.status);
    }
  }
  return finalStatus;
}

// ---------------------------------------------------------------------------
// Block structure
// ---------------------------------------------------------------------------

describe("taskBoard - block structure", () => {
  it("returns block + collectionId", () => {
    const board = taskBoard({
      name: "structure",
      collection: { collectionId: "test" },
      workers: makeGoalWorker("noop", () => null),
    });
    expect(board.block.kind).toBe("sequencer");
    expect(board.collectionId).toBe("test");
  });

  it("throws when concurrency is < 1", () => {
    expect(() =>
      taskBoard({
        name: "bad",
        collection: { collectionId: "x" },
        concurrency: 0,
        workers: makeGoalWorker("noop", () => null),
      })
    ).toThrow(/concurrency/);
  });

  it("throws when maxIterations is < 1", () => {
    expect(() =>
      taskBoard({
        name: "bad",
        collection: { collectionId: "x" },
        maxIterations: 0,
        workers: makeGoalWorker("noop", () => null),
      })
    ).toThrow(/maxIterations/);
  });

  it("throws on an unknown dispatcher name", () => {
    expect(() =>
      taskBoard({
        name: "bad",
        collection: { collectionId: "x" },
        dispatcher: "nonsense" as never,
        workers: makeGoalWorker("noop", () => null),
      })
    ).toThrow(/unknown dispatcher/);
  });
});

// ---------------------------------------------------------------------------
// Basic drain
// ---------------------------------------------------------------------------

describe("taskBoard - basic drain", () => {
  it("processes all initial tasks and exits cleanly (concurrency=1)", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "drain-1",
      collection: { collectionId: "drain-1" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: [
        { id: "a", goal: "alpha", input: { topic: "alpha" } },
        { id: "b", goal: "beta", input: { topic: "beta" } },
        { id: "c", goal: "gamma", input: { topic: "gamma" } },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace.sort()).toEqual([
      "uniform:alpha",
      "uniform:beta",
      "uniform:gamma",
    ]);
    const final = lastTaskState(result.items);
    expect(final.get("a")).toBe("completed");
    expect(final.get("b")).toBe("completed");
    expect(final.get("c")).toBe("completed");
  });

  it("processes 12 tasks in parallel with concurrency=4", async () => {
    const trace: string[] = [];
    const inits = Array.from({ length: 12 }, (_, i) => ({
      id: `t-${i}`,
      goal: `task-${i}`,
      input: { topic: `t-${i}` },
    }));

    const board = taskBoard({
      name: "drain-parallel",
      collection: { collectionId: "drain-parallel" },
      concurrency: 4,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: inits,
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace.length).toBe(12);
    expect(new Set(trace).size).toBe(12);
  });

  it("exits cleanly with no initialTasks", async () => {
    const board = taskBoard({
      name: "empty",
      collection: { collectionId: "empty" },
      concurrency: 2,
      workers: makeGoalWorker("noop", () => {
        throw new Error("should not run");
      }),
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dependency-gated dispatch
// ---------------------------------------------------------------------------

describe("taskBoard - dependency-gated dispatch (topological)", () => {
  it("waits for upstream completion before dispatching downstream", async () => {
    const order: string[] = [];

    const orderedWorker = handler({
      name: "ordered",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.string() }),
      execute: (input) => {
        order.push(input.goal);
        return { done: input.goal };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "topo",
      collection: { collectionId: "topo" },
      concurrency: 2,
      dispatcher: "topological",
      workers: orderedWorker,
      initialTasks: [
        { id: "u", goal: "upstream" },
        { id: "d", goal: "downstream", deps: ["u"] },
        { id: "leaf", goal: "leaf", deps: ["d"] },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    // u must come first; leaf must come last; downstream sits between.
    expect(order[0]).toBe("upstream");
    expect(order[order.length - 1]).toBe("leaf");
  });
});

// ---------------------------------------------------------------------------
// Worker registry routing
// ---------------------------------------------------------------------------

describe("taskBoard - worker registry routing", () => {
  it("routes by task.assignee", async () => {
    const trace: string[] = [];
    const registry = {
      researcher: makeEchoWorker("researcher", trace),
      writer: makeEchoWorker("writer", trace),
    };

    const board = taskBoard({
      name: "registry",
      collection: { collectionId: "registry" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: registry,
      initialTasks: [
        {
          id: "r1",
          goal: "research",
          assignee: "researcher",
          input: { topic: "topic-1" },
        },
        {
          id: "w1",
          goal: "write",
          assignee: "writer",
          input: { topic: "topic-2" },
        },
        {
          id: "r2",
          goal: "research",
          assignee: "researcher",
          input: { topic: "topic-3" },
        },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace.sort()).toEqual([
      "researcher:topic-1",
      "researcher:topic-3",
      "writer:topic-2",
    ]);
  });

  it("fails the offending task only when no worker matches the assignee (onError: skip)", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "missing-worker",
      collection: { collectionId: "mw" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { only: makeEchoWorker("only", trace) },
      initialTasks: [
        { id: "x", goal: "lost", assignee: "phantom" },
        {
          id: "y",
          goal: "ok",
          assignee: "only",
          input: { topic: "y" },
        },
      ],
      onError: "skip",
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("x")).toBe("errored");
    expect(final.get("y")).toBe("completed");
    expect(trace).toEqual(["only:y"]);
  });
});

// ---------------------------------------------------------------------------
// CAS contention safety
// ---------------------------------------------------------------------------

describe("taskBoard - CAS contention safety", () => {
  it("no two workers process the same task (8 workers, 100 tasks)", async () => {
    const seen = new Map<string, number>();
    const duplicates: string[] = [];

    const raceWorker = handler({
      name: "race",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: (input) => {
        const count = (seen.get(input.taskId) ?? 0) + 1;
        seen.set(input.taskId, count);
        if (count > 1) duplicates.push(input.taskId);
        return null;
      },
    }) as TaskWorker;

    const inits = Array.from({ length: 100 }, (_, i) => ({
      id: `t-${i}`,
      goal: `task-${i}`,
    }));

    const board = taskBoard({
      name: "race-board",
      collection: { collectionId: "race" },
      concurrency: 8,
      dispatcher: "fifo",
      workers: raceWorker,
      initialTasks: inits,
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(duplicates).toEqual([]);
    expect(seen.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Mid-drain enqueue
// ---------------------------------------------------------------------------

describe("taskBoard - mid-drain enqueue", () => {
  it("workers can add new tasks during the drain", async () => {
    const processed: string[] = [];

    const fanoutWorker = handler({
      name: "fanout-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ack: z.string() }),
      execute: async (input, ctx) => {
        processed.push(input.goal);
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId: "fanout",
          // Workers spawned under `forEach` see their own nested
          // `ctx.sequencer`. Reach for the board's StateRef via
          // `ctx.getTarget(boardName)` to mutate the shared collection.
          sequencer: ctx.getTarget("fanout")!,
        });
        if (input.goal === "seed") {
          await collection.addTask({ id: "child-a", goal: "child-a" });
          await collection.addTask({ id: "child-b", goal: "child-b" });
        }
        return { ack: input.goal };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "fanout",
      collection: { collectionId: "fanout" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: fanoutWorker,
      initialTasks: [{ id: "seed", goal: "seed" }],
      idlePollMs: 10,
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(processed.sort()).toEqual(["child-a", "child-b", "seed"]);
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe("taskBoard - failure handling", () => {
  it('onError: "skip" isolates the failure; siblings continue', async () => {
    const processed: string[] = [];
    const mixedWorker = handler({
      name: "mixed",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: (input) => {
        if (input.goal === "bad") throw new Error("intentional");
        processed.push(input.goal);
        return null;
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "skip-fail",
      collection: { collectionId: "skip" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: mixedWorker,
      initialTasks: [
        { id: "good-1", goal: "good-1" },
        { id: "bad", goal: "bad" },
        { id: "good-2", goal: "good-2" },
      ],
      onError: "skip",
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(processed.sort()).toEqual(["good-1", "good-2"]);
    const final = lastTaskState(result.items);
    expect(final.get("bad")).toBe("errored");
    expect(final.get("good-1")).toBe("completed");
    expect(final.get("good-2")).toBe("completed");
  });

  it('onError: "fail" propagates the error to the parent', async () => {
    const boomWorker = handler({
      name: "boom",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: () => {
        throw new Error("boom-err");
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "fail-prop",
      collection: { collectionId: "fp" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: boomWorker,
      initialTasks: [{ id: "x", goal: "x" }],
      onError: "fail",
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("boom-err");
  });

  it("downstream pending task with errored deps blocks loop exit until cancelled", async () => {
    // The topological dispatcher excludes `d` (its dep `u` is errored,
    // not completed). v1 has no automatic dep-failure propagation —
    // downstream stays `pending` and the `complete` loop counts it as
    // in-flight, so workers spin-poll. An external actor must
    // explicitly cancel the unreachable task to drain the board.
    let scheduled = false;
    const failingWorker = handler({
      name: "fail-up",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: async (input, ctx) => {
        if (!scheduled) {
          scheduled = true;
          const collection = getOrCreateTaskCollection({
            ctx,
            backing: "sequencer",
            collectionId: "df",
            sequencer: ctx.getTarget("deps-fail")!,
          });
          setTimeout(() => {
            collection.cancel("d", "dep errored").catch(() => undefined);
          }, 30);
        }
        if (input.goal === "u") throw new Error("upstream failed");
        return null;
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "deps-fail",
      collection: { collectionId: "df" },
      concurrency: 1,
      dispatcher: "topological",
      workers: failingWorker,
      initialTasks: [
        { id: "u", goal: "u" },
        { id: "d", goal: "d", deps: ["u"] },
      ],
      onError: "skip",
      idlePollMs: 10,
      maxIterations: 200,
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("u")).toBe("errored");
    expect(final.get("d")).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// awaiting_review semantics
// ---------------------------------------------------------------------------

describe("taskBoard - awaiting_review", () => {
  it("dispatcher skips awaiting_review; resume wakes the loop in onIdle: 'complete'", async () => {
    // "park" is seeded directly in `awaiting_review` — the FIFO
    // dispatcher must skip it. While "trigger" runs, it schedules a
    // `resumeFromReview` that flips "park" back to `pending`. The
    // `complete`-mode loop counts the awaiting_review task as
    // in-flight so it doesn't exit before the resume lands.
    let scheduled = false;
    const reviewWorker = handler({
      name: "review-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ handled: z.string() }),
      execute: async (input, ctx) => {
        if (input.goal === "trigger" && !scheduled) {
          scheduled = true;
          const collection = getOrCreateTaskCollection({
            ctx,
            backing: "sequencer",
            collectionId: "review",
            sequencer: ctx.getTarget("hitl")!,
          });
          setTimeout(() => {
            collection.resumeFromReview("park").catch(() => undefined);
          }, 60);
        }
        return { handled: input.goal };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "hitl",
      collection: { collectionId: "review" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: reviewWorker,
      initialTasks: [
        { id: "park", goal: "park", status: "awaiting_review" },
        { id: "trigger", goal: "trigger" },
      ],
      onIdle: "complete",
      idlePollMs: 20,
      maxIterations: 500,
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("park")).toBe("completed");
    expect(final.get("trigger")).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// onIdle modes
// ---------------------------------------------------------------------------

describe("taskBoard - onIdle modes", () => {
  it("onIdle: 'complete' exits as soon as the collection is drained", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "complete-mode",
      collection: { collectionId: "cm" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: [
        { id: "a", goal: "a", input: { topic: "a" } },
        { id: "b", goal: "b", input: { topic: "b" } },
      ],
      onIdle: "complete",
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace.length).toBe(2);
  });

  it("onIdle: 'wait' continues until shouldExit returns true", async () => {
    const trace: string[] = [];
    let added = false;

    const waitWorker = handler({
      name: "wait-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: async (input, ctx) => {
        trace.push(input.goal);
        if (!added) {
          added = true;
          const collection = getOrCreateTaskCollection({
            ctx,
            backing: "sequencer",
            collectionId: "wm",
            sequencer: ctx.getTarget("wait-mode")!,
          });
          setTimeout(() => {
            collection
              .addTask({ id: "late", goal: "late" })
              .catch(() => undefined);
          }, 50);
        }
        return null;
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "wait-mode",
      collection: { collectionId: "wm" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: waitWorker,
      initialTasks: [{ id: "seed", goal: "seed" }],
      onIdle: "wait",
      idlePollMs: 20,
      shouldExit: (collection) => {
        const total = collection.count();
        const done = collection.count({ status: "completed" });
        return total >= 2 && done === total;
      },
      maxIterations: 500,
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace.sort()).toEqual(["late", "seed"]);
  });
});

// ---------------------------------------------------------------------------
// Remix blocks
// ---------------------------------------------------------------------------

describe("taskBoard - remix blocks", () => {
  it("selectNextReadyTask previews; claimTask actually claims; recordSuccess writes back", async () => {
    const trace: string[] = [];

    // The collection lives on the outer "remix-pipeline" sequencer's
    // state. Inside nested sequencers (the worker body), `ctx.sequencer`
    // points at the inner state — reach for the outer one via
    // `ctx.getTarget("remix-pipeline")` and fall back to `ctx.sequencer`
    // for top-level callers (seed, select, claim).
    const collectionFactory = (ctx: import("@flow-state-dev/core/types").BlockContext) => {
      const outer = ctx.getTarget<{ tasks: Record<string, unknown> }>(
        "remix-pipeline"
      );
      return getOrCreateTaskCollection({
        ctx,
        backing: "sequencer",
        collectionId: "remix",
        sequencer: (outer ?? ctx.sequencer!) as never,
      });
    };

    const seed = handler({
      name: "remix-seed",
      inputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const c = collectionFactory(ctx);
        await c.addTask({ id: "a", goal: "alpha" });
        await c.addTask({ id: "b", goal: "beta", deps: ["a"] });
      },
    });

    const select = createSelectNextReadyTask({
      name: "remix-select",
      collection: collectionFactory,
    });

    const claim = createClaimTask({
      name: "remix-claim",
      collection: collectionFactory,
      dispatcher: fifoDispatcher,
      workerId: () => "remixer",
    });

    const remixWorker = handler({
      name: "remix-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (input) => {
        trace.push(input.goal);
        return { ok: true };
      },
    });

    const recordSuccess = createRecordSuccess({
      name: "remix-record",
      collection: collectionFactory,
    });

    // Compose remix-style: select (peek) → claim → worker → record.
    // Worker runs as a first-class step (BP-011 conformance). The
    // worker body has its own state schema where `currentTaskId` is
    // stamped before the worker runs so `recordSuccess` can read it.
    const remixBodyStateSchema = z.object({
      currentTaskId: z.string().optional(),
    });

    const remixBody = sequencer({
      name: "remix-body",
      stateSchema: remixBodyStateSchema,
    })
      .tap(async (claimResult, ctx) => {
        if (claimResult.claimed) {
          await ctx.sequencer!.patchState({
            currentTaskId: claimResult.task!.id,
          });
        }
      })
      .thenIf(
        (out) => out.claimed,
        (out) => ({
          taskId: out.task!.id,
          goal: out.task!.goal,
          input: out.task!.input,
          attempts: out.task!.attempts,
          feedback: out.task!.feedback,
          metadata: out.task!.metadata,
        }),
        remixWorker
      )
      // Use a tap that fetches the recordSuccess block's behaviour
      // inline — the exported `recordSuccess` reads its own sequencer
      // state, which here is `remixBodyStateSchema`. The schemas are
      // compatible because both declare `currentTaskId`.
      .tap(recordSuccess);

    const pipeline = sequencer({
      name: "remix-pipeline",
      stateSchema: taskBoardStateSchema,
    })
      .tap(seed)
      .then(select)
      .tap((preview) => {
        expect((preview as { ready: boolean }).ready).toBe(true);
      })
      .then(claim)
      .then(remixBody);

    const result = await testBlock(pipeline, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace).toEqual(["alpha"]);
  });
});
