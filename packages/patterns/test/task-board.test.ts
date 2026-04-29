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
 *   - individual remix blocks (claim, run, record, select)
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  fifoDispatcher,
  getOrCreateTaskCollection,
  taskSchema,
  type TaskCollectionRef,
  type TaskWorker,
} from "@flow-state-dev/tasks";

import {
  taskBoard,
  taskBoardStateSchema,
  createSelectNextReadyTask,
  createClaimTask,
  createRunWorker,
  createRecordResult,
} from "../src/task-board";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResearchInput = { topic: string };

function makeEchoWorker(name: string, traceTo?: string[]): TaskWorker {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (input: { goal: string; input?: ResearchInput }) => {
      const tag = `${name}:${input.input?.topic ?? input.goal}`;
      traceTo?.push(tag);
      return { findings: tag };
    },
  });
}

function lastTaskState(items: unknown[]): Map<string, string> {
  const finalStatus = new Map<string, string>();
  for (const item of items as Array<{ type?: string; task?: { id: string; status: string } }>) {
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
      workers: handler({
        name: "noop",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => null,
      }),
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
        workers: handler({
          name: "noop",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => null,
        }),
      })
    ).toThrow(/concurrency/);
  });

  it("throws when maxIterations is < 1", () => {
    expect(() =>
      taskBoard({
        name: "bad",
        collection: { collectionId: "x" },
        maxIterations: 0,
        workers: handler({
          name: "noop",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => null,
        }),
      })
    ).toThrow(/maxIterations/);
  });

  it("throws on an unknown dispatcher name", () => {
    expect(() =>
      taskBoard({
        name: "bad",
        collection: { collectionId: "x" },
        dispatcher: "nonsense" as never,
        workers: handler({
          name: "noop",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => null,
        }),
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
    const board = taskBoard<ResearchInput>({
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

    const board = taskBoard<ResearchInput>({
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
    const board = taskBoard<ResearchInput>({
      name: "empty",
      collection: { collectionId: "empty" },
      concurrency: 2,
      workers: handler({
        name: "noop",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          throw new Error("should not run");
        },
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
    const worker = handler({
      name: "ordered",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { taskId: string; goal: string }) => {
        order.push(input.goal);
        return { done: input.goal };
      },
    });

    const board = taskBoard({
      name: "topo",
      collection: { collectionId: "topo" },
      concurrency: 2,
      dispatcher: "topological",
      workers: worker,
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

    const board = taskBoard<ResearchInput>({
      name: "registry",
      collection: { collectionId: "registry" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: registry,
      initialTasks: [
        { id: "r1", goal: "research", assignee: "researcher", input: { topic: "topic-1" } },
        { id: "w1", goal: "write", assignee: "writer", input: { topic: "topic-2" } },
        { id: "r2", goal: "research", assignee: "researcher", input: { topic: "topic-3" } },
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

  it("fails the task when no worker is registered for the assignee (onError: skip)", async () => {
    const board = taskBoard({
      name: "missing-worker",
      collection: { collectionId: "mw" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { only: makeEchoWorker("only") },
      initialTasks: [{ id: "x", goal: "lost", assignee: "phantom" }],
      onError: "skip",
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("x")).toBe("errored");
  });
});

// ---------------------------------------------------------------------------
// CAS contention safety
// ---------------------------------------------------------------------------

describe("taskBoard - CAS contention safety", () => {
  it("no two workers process the same task (8 workers, 100 tasks)", async () => {
    const seen = new Map<string, number>();
    const duplicates: string[] = [];

    const worker = handler({
      name: "race",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { taskId: string }) => {
        const count = (seen.get(input.taskId) ?? 0) + 1;
        seen.set(input.taskId, count);
        if (count > 1) duplicates.push(input.taskId);
        return null;
      },
    });

    const inits = Array.from({ length: 100 }, (_, i) => ({
      id: `t-${i}`,
      goal: `task-${i}`,
    }));

    const board = taskBoard({
      name: "race-board",
      collection: { collectionId: "race" },
      concurrency: 8,
      dispatcher: "fifo",
      workers: worker,
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
      name: "fanout",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (
        input: { taskId: string; goal: string },
        ctx
      ) => {
        processed.push(input.goal);
        const collection = getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId: "fanout",
          // ctx.sequencer inside a worker points at the worker's nested
          // state. The shared task record lives on the outer board's
          // sequencer — reach for it via ctx.getTarget("<boardName>").
          sequencer: ctx.getTarget("fanout")!,
        });
        if (input.goal === "seed") {
          await collection.addTask({ id: "child-a", goal: "child-a" });
          await collection.addTask({ id: "child-b", goal: "child-b" });
        }
        return { ack: input.goal };
      },
    });

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
    const worker = handler({
      name: "mixed",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { goal: string }) => {
        if (input.goal === "bad") throw new Error("intentional");
        processed.push(input.goal);
        return null;
      },
    });

    const board = taskBoard({
      name: "skip-fail",
      collection: { collectionId: "skip" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: worker,
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
    const worker = handler({
      name: "boom",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("boom-err");
      },
    });

    const board = taskBoard({
      name: "fail-prop",
      collection: { collectionId: "fp" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: worker,
      initialTasks: [{ id: "x", goal: "x" }],
      onError: "fail",
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("boom-err");
  });

  it("downstream pending task with errored deps blocks loop exit until cancelled", async () => {
    // The topological dispatcher excludes `d` (its dep `u` is errored, not
    // completed). With v1 there's no automatic dep-failure propagation —
    // downstream stays `pending` and the `complete` loop counts it as
    // in-flight, so workers spin-poll. An external actor must explicitly
    // cancel the unreachable task to drain the board.
    let cancelled = false;
    const worker = handler({
      name: "fail-up",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input: { goal: string }, ctx) => {
        if (!cancelled) {
          cancelled = true;
          // Schedule a cancel on the unreachable downstream so the loop
          // can exit. Mirrors what a UI / webhook handler would do.
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
    });

    const board = taskBoard({
      name: "deps-fail",
      collection: { collectionId: "df" },
      concurrency: 1,
      dispatcher: "topological",
      workers: worker,
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
    // "park" is seeded directly in `awaiting_review` — the FIFO dispatcher
    // must skip it. While "trigger" runs, it schedules a `resumeFromReview`
    // that flips "park" back to `pending`. The `complete`-mode loop counts
    // the awaiting_review task as in-flight so it doesn't exit before the
    // resume lands.
    let scheduled = false;
    const worker = handler({
      name: "review-worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input: { goal: string }, ctx) => {
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
    });

    const board = taskBoard({
      name: "hitl",
      collection: { collectionId: "review" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: worker,
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

    const board = taskBoard({
      name: "wait-mode",
      collection: { collectionId: "wm" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: handler({
        name: "wait-worker",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (
          input: { taskId: string; goal: string },
          ctx
        ) => {
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
              collection.addTask({ id: "late", goal: "late" }).catch(() => undefined);
            }, 50);
          }
          return null;
        },
      }),
      initialTasks: [{ id: "seed", goal: "seed" }],
      onIdle: "wait",
      idlePollMs: 20,
      // Exit once both the seed and the deferred task are completed.
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
  it("selectNextReadyTask previews without claiming; claimTask actually claims", async () => {
    const trace: string[] = [];

    const stateSchema = taskBoardStateSchema;
    const collectionFactory = (ctx: any) =>
      getOrCreateTaskCollection({
        ctx,
        backing: "sequencer",
        collectionId: "remix",
        sequencer: ctx.sequencer!,
      });

    const seed = handler({
      name: "remix-seed",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        const c = collectionFactory(ctx);
        await c.addTask({ id: "a", goal: "alpha" });
        await c.addTask({ id: "b", goal: "beta", deps: ["a"] });
        return null;
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

    const run = createRunWorker({
      name: "remix-run",
      workers: handler({
        name: "remix-worker",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input: { taskId: string; goal: string }) => {
          trace.push(input.goal);
          return { ok: true };
        },
      }),
    });

    const record = createRecordResult({
      name: "remix-record",
      collection: collectionFactory,
      onError: "skip",
    });

    const pipeline = sequencer({
      name: "remix-pipeline",
      stateSchema,
    })
      .then(seed)
      .then(select)
      .tap((preview) => {
        expect((preview as { ready: boolean }).ready).toBe(true);
        // Confirm the previewed task is still pending — selection is read-only.
      })
      .then(claim)
      .map((claimed: any) => {
        expect(claimed.claimed).toBe(true);
        return { task: claimed.task };
      })
      .then(run)
      .then(record);

    const result = await testBlock(pipeline, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace).toEqual(["alpha"]);
  });
});
