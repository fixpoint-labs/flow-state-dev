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
  createSeedCollection,
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
 * `task-change` component items emitted on the stream. The substrate
 * emits one item per transition; the last one for a given id is the
 * final status.
 */
function lastTaskState(items: unknown[]): Map<string, string> {
  const finalStatus = new Map<string, string>();
  for (const item of items as Array<{
    type?: string;
    component?: string;
    data?: { task?: { id: string; status: string } };
  }>) {
    if (
      item.type === "component" &&
      item.component === "task-change" &&
      item.data?.task !== undefined
    ) {
      finalStatus.set(item.data.task.id, item.data.task.status);
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

  it("idle workers don't flood the stream with lastClaimed patches (FIX-477)", async () => {
    // FIX-477: lastClaimed is a transient slot. Idle workers polling every
    // idlePollMs no longer emit a state_change item per tick. Three workers
    // with no real tasks should produce zero block_instance state_change
    // items for the worker sequencer's lastClaimed flag over many idle ticks.
    let exitAfterTicks = 6;
    const board = taskBoard({
      name: "noisy-idle",
      collection: { collectionId: "noise" },
      concurrency: 3,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", []),
      initialTasks: [],
      onIdle: "wait",
      idlePollMs: 5,
      shouldExit: () => {
        exitAfterTicks -= 1;
        return exitAfterTicks <= 0;
      },
      maxIterations: 50,
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();

    const stateChanges = result.items.filter((item) => item.type === "state_change");
    const lastClaimedEmits = stateChanges.filter((item) => {
      const i = item as Extract<typeof item, { type: "state_change" }>;
      const delta = i.delta as Record<string, unknown> | undefined;
      return (
        i.scope === "block_instance" &&
        delta !== undefined &&
        Object.prototype.hasOwnProperty.call(delta, "lastClaimed")
      );
    });
    expect(lastClaimedEmits).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// Capability — board.capability exposes the collection at ctx.cap
// ---------------------------------------------------------------------------

describe("taskBoard - capability", () => {
  it("returns a capability whose name encodes the board's name", () => {
    const board = taskBoard({
      name: "research",
      collection: { collectionId: "research" },
      workers: makeGoalWorker("noop", () => null),
    });
    expect(board.capability).toBeDefined();
    expect(board.capability!.name).toBe("taskBoard_research");
  });

  it("declares the board's state slot via targetStateSchemas", () => {
    const board = taskBoard({
      name: "schemas-board",
      collection: { collectionId: "x" },
      workers: makeGoalWorker("noop", () => null),
    });
    // The capability must declare the board's `tasks` slot so blocks
    // that consume the capability transitively contribute the state
    // schema without manual flow-level wiring.
    const targetSchemas = board.capability!.targetStateSchemas;
    expect(targetSchemas).toBeDefined();
    expect(targetSchemas?.["schemas-board"]).toBeDefined();
  });

  it("returns a factory-backed capability when a caller-supplied factory is used", () => {
    // Factory-backed boards still get a capability — the capability's
    // `tasks()` getter delegates to the user's factory. No state schema
    // is declared because the storage is opaque (typically a
    // ResourceCollection that already declares its own).
    const board = taskBoard({
      name: "factory-board",
      collection: () => {
        throw new Error("not used in this assertion");
      },
      workers: makeGoalWorker("noop", () => null),
    });
    expect(board.capability).toBeDefined();
    expect(board.capability!.name).toBe("taskBoard_factory-board");
    // Factory mode does NOT declare targetStateSchemas — storage is the
    // caller's responsibility.
    expect(board.capability!.targetStateSchemas).toBeUndefined();
  });

  it("multiple boards in one flow get distinct capability namespaces", () => {
    const research = taskBoard({
      name: "research",
      collection: { collectionId: "research" },
      workers: makeGoalWorker("noop", () => null),
    });
    const financials = taskBoard({
      name: "financials",
      collection: { collectionId: "financials" },
      workers: makeGoalWorker("noop", () => null),
    });
    expect(research.capability!.name).toBe("taskBoard_research");
    expect(financials.capability!.name).toBe("taskBoard_financials");
    expect(research.capability!.name).not.toBe(financials.capability!.name);
  });

  it("the board's own pipeline emits task-change items the capability subscribers consume", async () => {
    // End-to-end smoke: the board's drain produces `task-change`
    // component items keyed by `${collectionId}/${taskId}`. Any future
    // consumer that wires the capability into a generator's `uses` and
    // calls `ctx.cap.taskBoard_<name>.tasks()` reads the same
    // collection that emits these items.
    const trace: string[] = [];
    const board = taskBoard({
      name: "smoke",
      collection: { collectionId: "smoke" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: [{ id: "a", goal: "alpha", input: { topic: "alpha" } }],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();

    type ChangeItem = {
      type?: string;
      component?: string;
      key?: string;
      data?: { collectionId?: string; taskId?: string };
    };
    const changeItems = (result.items as ChangeItem[]).filter(
      (i) => i.type === "component" && i.component === "task-change"
    );
    expect(changeItems.length).toBeGreaterThan(0);
    for (const item of changeItems) {
      expect(item.data?.collectionId).toBe("smoke");
      expect(item.key).toBe(`smoke/${item.data?.taskId}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Re-entry — request-scoped collection survives multiple `board.block`
// invocations from a parent sequencer (FIX-471)
// ---------------------------------------------------------------------------
//
// Sequencer-backed boards lose their `tasks` slot at the end of each
// `board.block` invocation because sequencer state is per-instance. A
// replan loop that wraps `board.block` (e.g. the FIX-447 P&E migration)
// needs the collection to survive across calls. Request-scoped backing
// is the substrate's answer: `ctx.request` exposes the same atomic-state
// surface as a sequencer state ref, so the same CAS engine writes there
// instead — and request lifetime spans every block in the request.

describe("taskBoard - re-entry (request-scoped collection)", () => {
  it("a second board invocation observes mid-loop additions made between calls", async () => {
    const trace: string[] = [];

    const board = taskBoard({
      name: "reentry-basic",
      collection: { backing: "request", collectionId: "reentry-basic" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: [
        { id: "a", goal: "alpha", input: { topic: "alpha" } },
        { id: "b", goal: "beta", input: { topic: "beta" } },
      ],
    });

    // Stand-in for an `applyReplan` step in the P&E migration: between
    // the two board invocations we inject a new pending task. Sequencer-
    // backed boards would lose this between calls; request-backed boards
    // pick it up on the next drain.
    const enqueueBetween = handler({
      name: "enqueue-between",
      inputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "request",
          collectionId: "reentry-basic",
        });
        await collection.addTask({
          id: "c",
          goal: "gamma",
          input: { topic: "gamma" },
        });
      },
    });

    const wrapper = sequencer({ name: "reentry-basic-wrapper" })
      .tap(board.block)
      .tap(enqueueBetween)
      .tap(board.block);

    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();

    // First drain processes a + b. Second drain processes c only —
    // a and b are terminal and the dispatcher's eligibility filter
    // skips them, so they're not re-run.
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

  it("three sequential drains separated by enqueues sum across rounds", async () => {
    const processed: string[] = [];

    const board = taskBoard({
      name: "reentry-three-rounds",
      collection: {
        backing: "request",
        collectionId: "reentry-three-rounds",
      },
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", processed),
      initialTasks: [
        { id: "r1-x", goal: "r1-x", input: { topic: "r1-x" } },
      ],
    });

    function makeEnqueue(name: string, ids: string[]) {
      return handler({
        name,
        inputSchema: z.unknown(),
        execute: async (_input, ctx) => {
          const collection = getOrCreateTaskCollection({
            ctx,
            backing: "request",
            collectionId: "reentry-three-rounds",
          });
          for (const id of ids) {
            await collection.addTask({ id, goal: id, input: { topic: id } });
          }
        },
      });
    }

    const wrapper = sequencer({ name: "reentry-three-rounds-wrapper" })
      .tap(board.block)
      .tap(makeEnqueue("enq-2", ["r2-y", "r2-z"]))
      .tap(board.block)
      .tap(makeEnqueue("enq-3", ["r3-q"]))
      .tap(board.block);

    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();

    // Total processed = 1 (round 1) + 2 (round 2) + 1 (round 3). Each
    // task runs exactly once across all three drains — no re-processing
    // of the previous rounds' completed tasks.
    expect(processed.sort()).toEqual([
      "uniform:r1-x",
      "uniform:r2-y",
      "uniform:r2-z",
      "uniform:r3-q",
    ]);
  });

  it("re-entry under concurrency=4 does not re-claim completed tasks", async () => {
    const processed: string[] = [];

    const board = taskBoard({
      name: "reentry-concurrent",
      collection: {
        backing: "request",
        collectionId: "reentry-concurrent",
      },
      concurrency: 4,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", processed),
      initialTasks: Array.from({ length: 8 }, (_, i) => ({
        id: `r1-${i}`,
        goal: `r1-${i}`,
        input: { topic: `r1-${i}` },
      })),
      idlePollMs: 5,
    });

    const enqueueRound2 = handler({
      name: "enqueue-round-2",
      inputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "request",
          collectionId: "reentry-concurrent",
        });
        for (let i = 0; i < 8; i += 1) {
          await collection.addTask({
            id: `r2-${i}`,
            goal: `r2-${i}`,
            input: { topic: `r2-${i}` },
          });
        }
      },
    });

    const wrapper = sequencer({ name: "reentry-concurrent-wrapper" })
      .tap(board.block)
      .tap(enqueueRound2)
      .tap(board.block);

    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();

    // 16 tasks, processed exactly once — uniqueness proves CAS is
    // working through the request-scope adapter (no double-claim under
    // contention) and that round-1 tasks are NOT re-claimed by round-2
    // workers (re-entry idempotency via dispatcher eligibility).
    expect(processed.length).toBe(16);
    expect(new Set(processed).size).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Board-level meta emission — `task-board-meta` component item at
// start (status: active) and end (status: completed + counts)
// ---------------------------------------------------------------------------

describe("taskBoard - board-meta emission", () => {
  it("emits an `active` meta item before the drain and a `completed` meta item after", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "meta-test",
      collection: { collectionId: "meta-test" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: [
        { id: "a", goal: "alpha", input: { topic: "alpha" } },
        { id: "b", goal: "beta", input: { topic: "beta" } },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();

    type MetaItem = {
      type?: string;
      component?: string;
      key?: string;
      data?: {
        collectionId?: string;
        status?: string;
        counts?: Record<string, number>;
      };
    };
    const metaItems = (result.items as MetaItem[]).filter(
      (i) => i.type === "component" && i.component === "task-board-meta"
    );

    // FIX-491: keyed component emissions upsert in place. The board emits
    // "active" at start and "completed" at end against the same key, so the
    // persisted record collapses to a single entry holding the final
    // snapshot. Live SSE consumers see both transitions via the event log.
    expect(metaItems).toHaveLength(1);
    expect(metaItems[0]?.data?.status).toBe("completed");
    expect(metaItems[0]?.key).toBe("meta-test");
    expect(metaItems[0]?.data?.collectionId).toBe("meta-test");

    // Counts on the final snapshot reflect the final state.
    const final = metaItems[0]?.data?.counts;
    expect(final?.total).toBe(2);
    expect(final?.completed).toBe(2);
    expect(final?.errored).toBe(0);
  });

  it("counts errored tasks on completion", async () => {
    const failingWorker = handler({
      name: "failing",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.null(),
      execute: () => {
        throw new Error("boom");
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "meta-fail",
      collection: { collectionId: "meta-fail" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: failingWorker,
      onError: "skip",
      initialTasks: [
        { id: "x", goal: "fail-1" },
        { id: "y", goal: "fail-2" },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();

    type MetaItem = {
      type?: string;
      component?: string;
      data?: { status?: string; counts?: Record<string, number> };
    };
    const completed = (result.items as MetaItem[]).find(
      (i) =>
        i.type === "component" &&
        i.component === "task-board-meta" &&
        i.data?.status === "completed"
    );
    expect(completed).toBeDefined();
    expect(completed?.data?.counts?.total).toBe(2);
    expect(completed?.data?.counts?.errored).toBe(2);
    expect(completed?.data?.counts?.completed).toBe(0);
  });
});

describe("taskBoard - seed idempotency", () => {
  it("seed step skips initialTasks whose ids already exist in the collection", async () => {
    // Local idempotency: re-running the seed step against a collection
    // already populated with the same task ids must not throw and must
    // not duplicate. Required for any future re-entry / resume work —
    // the seed step itself can't be the thing that breaks a replay.
    //
    // Strategy: run the same seed handler twice inside a wrapper
    // sequencer (so both calls share the parent's `tasks` state slot
    // via ctx.getTarget on the wrapper's name).
    const seed = createSeedCollection({
      name: "seed-twice",
      collection: (ctx) =>
        getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId: "seed-twice",
          sequencer: ctx.sequencer!,
        }),
      initialTasks: [
        { id: "a", goal: "alpha", input: { topic: "alpha" } },
        { id: "b", goal: "beta", input: { topic: "beta" } },
      ],
    });

    // Wrapper sequencer holds the `tasks` slot; both seed invocations
    // resolve `ctx.sequencer` to the SAME state ref since they run
    // under the same parent sequencer instance.
    const wrapper = sequencer({
      name: "seed-idempotency-wrapper",
      stateSchema: taskBoardStateSchema,
    })
      .tap(seed)
      .tap(seed); // second call must observe a/b already present and skip

    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();

    // The "added" change events fire exactly twice — once per task,
    // not four times. The second seed pass observes the existing ids
    // and short-circuits.
    type Change = {
      type?: string;
      component?: string;
      data?: { kind?: string; taskId?: string };
    };
    const addedEvents = (result.items as Change[]).filter(
      (i) =>
        i.type === "component" &&
        i.component === "task-change" &&
        i.data?.kind === "added"
    );
    expect(addedEvents.map((e) => e.data?.taskId).sort()).toEqual(["a", "b"]);
  });

  // Cross-invocation re-entry — the broader case where `board.block`
  // is called multiple times from a parent sequencer — is covered by
  // the `taskBoard - re-entry (request-scoped collection)` describe
  // block above. The sequencer-backed default still creates fresh
  // state per invocation by design; consumers that need re-entry opt
  // into `collection: { backing: "request", ... }`.
});
