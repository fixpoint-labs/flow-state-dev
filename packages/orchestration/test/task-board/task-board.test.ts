/**
 * task-board pattern tests (FIX-446).
 *
 * Coverage:
 *   - handle structure and validation
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
import type { OutputItem } from "@flow-state-dev/core/items";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  extractTaskItemWindows,
  fifoDispatcher,
  getOrCreateTaskCollection,
  type TaskWorker,
} from "../../src/tasks";

import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
  createSelectNextReadyTask,
  createClaimTask,
  createRecordSuccess,
  createSeedCollection,
} from "../../src/task-board";

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

describe("taskBoard - handle structure", () => {
  it("returns drain + collectionId", () => {
    const board = taskBoard({
      name: "structure",
      collection: { collectionId: "test" },
      workers: makeGoalWorker("noop", () => null),
    });
    expect(board.drain.kind).toBe("sequencer");
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
// Backing + seed descriptor (FIX-910)
// ---------------------------------------------------------------------------

describe("taskBoard - backing + seed descriptor", () => {
  const noop = () => makeGoalWorker("noop", () => null);

  it("reports request backing for an omitted collection (the default)", () => {
    const board = taskBoard({ name: "req-default", workers: noop() });
    expect(board.backing).toBe("request");
  });

  it("reports request backing for an explicit request spec", () => {
    const board = taskBoard({
      name: "req",
      collection: { collectionId: "req" },
      workers: noop(),
    });
    expect(board.backing).toBe("request");
  });

  it("reports resource backing for a defineTaskCollection", () => {
    const board = taskBoard({
      name: "res",
      collection: defineTaskCollection({ id: "res-coll", scope: "session" }),
      workers: noop(),
    });
    expect(board.backing).toBe("resource");
  });

  it("reports sequencer backing for the sequencer opt-in", () => {
    const board = taskBoard({
      name: "seq",
      collection: { backing: "sequencer", collectionId: "seq" },
      workers: noop(),
    });
    expect(board.backing).toBe("sequencer");
  });

  it("reports factory backing for a caller-supplied factory", () => {
    const board = taskBoard({
      name: "fac",
      collection: (ctx) =>
        getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "fac" }),
      workers: noop(),
    });
    expect(board.backing).toBe("factory");
  });

  it("flags idless initialTasks and clears when all carry ids", () => {
    const withIdless = taskBoard({
      name: "idless",
      workers: noop(),
      initialTasks: [{ goal: "a" }, { id: "t2", goal: "b" }],
    });
    expect(withIdless.hasIdlessInitialTasks).toBe(true);

    const allIds = taskBoard({
      name: "all-ids",
      workers: noop(),
      initialTasks: [{ id: "t1", goal: "a" }, { id: "t2", goal: "b" }],
    });
    expect(allIds.hasIdlessInitialTasks).toBe(false);

    const none = taskBoard({ name: "no-seed", workers: noop() });
    expect(none.hasIdlessInitialTasks).toBe(false);
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

    const result = await testBlock(board.drain, { input: undefined });
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

  it("packs title and context onto the worker input (FIX-827)", async () => {
    let seen: { title?: string; context?: string; goal?: string } | undefined;
    const capturingWorker = handler({
      name: "capture",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (input) => {
        seen = { title: input.title, context: input.context, goal: input.goal };
        return { ok: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "ctx-pack",
      collection: { collectionId: "ctx-pack" },
      workers: capturingWorker,
      initialTasks: [
        {
          id: "a",
          goal: "research the listed subdomains",
          title: "Subdomain research",
          context: "Subdomains: a.example.com, b.example.com",
        },
      ],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    expect(seen?.goal).toBe("research the listed subdomains");
    expect(seen?.title).toBe("Subdomain research");
    expect(seen?.context).toBe("Subdomains: a.example.com, b.example.com");
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

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("x")).toBe("errored");
    expect(final.get("y")).toBe("completed");
    expect(trace).toEqual(["only:y"]);
  });
});

// ---------------------------------------------------------------------------
// Default worker (the delegation floor, FIX-940) — the three invariants:
//   I1 — a genuine miss (unknown OR absent assignee) routes to the floor.
//   I2 — no defaultWorker → a miss still fails per onError (regression guard).
//   I3 — a declared assignee never touches the floor.
// ---------------------------------------------------------------------------

describe("taskBoard - default worker (the floor)", () => {
  it("I1: routes an unknown assignee to the floor; output is recorded", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "floor-unknown",
      collection: { collectionId: "floor-unknown" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { only: makeEchoWorker("only", trace) },
      defaultWorker: makeEchoWorker("floor", trace),
      initialTasks: [
        { id: "u", goal: "unclaimed", assignee: "nobody", input: { topic: "u" } },
      ],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    // Before FIX-940 this task would error out of the registry router.
    expect(final.get("u")).toBe("completed");
    expect(trace).toEqual(["floor:u"]);
  });

  it("I1: routes an absent assignee to the floor; output is recorded", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "floor-absent",
      collection: { collectionId: "floor-absent" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { only: makeEchoWorker("only", trace) },
      defaultWorker: makeEchoWorker("floor", trace),
      initialTasks: [{ id: "a", goal: "no assignee", input: { topic: "a" } }],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("a")).toBe("completed");
    expect(trace).toEqual(["floor:a"]);
  });

  it("I3: a declared assignee runs its own worker, never the floor", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "floor-declared",
      collection: { collectionId: "floor-declared" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { only: makeEchoWorker("only", trace) },
      defaultWorker: makeEchoWorker("floor", trace),
      initialTasks: [{ id: "d", goal: "declared", assignee: "only", input: { topic: "d" } }],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("d")).toBe("completed");
    // The declared worker ran; the floor was never invoked.
    expect(trace).toEqual(["only:d"]);
  });

  it("rosterless: an empty registry drains every task onto the floor", async () => {
    // The headline "no roster at all" path: the board's ONLY worker is the
    // floor. An empty `{}` registry + defaultWorker must still drain unassigned
    // and unknown-assignee tasks to completion.
    const trace: string[] = [];
    const board = taskBoard({
      name: "rosterless",
      collection: { collectionId: "rosterless" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: {},
      defaultWorker: makeEchoWorker("floor", trace),
      initialTasks: [
        { id: "a", goal: "no assignee", input: { topic: "a" } },
        { id: "b", goal: "unknown assignee", assignee: "nobody", input: { topic: "b" } },
      ],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("a")).toBe("completed");
    expect(final.get("b")).toBe("completed");
    expect(trace.sort()).toEqual(["floor:a", "floor:b"]);
  });

  // The worker registry is a plain object, so an assignee naming an inherited
  // Object.prototype member used to resolve off the prototype chain and be
  // dispatched as if it were a registered worker — the task errored on the
  // route-candidate check instead of reaching the floor. Assignees are
  // model-authored (addTask), so these names are reachable input.
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "I1: routes the Object.prototype name %s to the floor, not off the prototype chain",
    async (protoAssignee) => {
      const trace: string[] = [];
      const board = taskBoard({
        name: `floor-proto-${protoAssignee.replace(/_/g, "")}`,
        collection: { collectionId: `floor-proto-${protoAssignee.replace(/_/g, "")}` },
        concurrency: 1,
        dispatcher: "fifo",
        workers: { only: makeEchoWorker("only", trace) },
        defaultWorker: makeEchoWorker("floor", trace),
        initialTasks: [
          { id: "p", goal: "prototype-named assignee", assignee: protoAssignee, input: { topic: "p" } },
        ],
        onError: "skip",
      });

      const result = await testBlock(board.drain, { input: undefined });
      expect(result.error).toBeNull();
      const final = lastTaskState(result.items);
      expect(final.get("p")).toBe("completed");
      expect(trace).toEqual(["floor:p"]);
    },
  );

  it.each(["toString", "constructor", "__proto__"])(
    "I2: with no defaultWorker, the Object.prototype name %s still fails the task",
    async (protoAssignee) => {
      const trace: string[] = [];
      const board = taskBoard({
        name: `no-floor-proto-${protoAssignee.replace(/_/g, "")}`,
        collection: { collectionId: `no-floor-proto-${protoAssignee.replace(/_/g, "")}` },
        concurrency: 1,
        dispatcher: "fifo",
        workers: { only: makeEchoWorker("only", trace) },
        // No defaultWorker — a prototype-named miss must fail like any other.
        initialTasks: [
          { id: "p", goal: "prototype-named assignee", assignee: protoAssignee },
          { id: "y", goal: "ok", assignee: "only", input: { topic: "y" } },
        ],
        onError: "skip",
      });

      const result = await testBlock(board.drain, { input: undefined });
      expect(result.error).toBeNull();
      const final = lastTaskState(result.items);
      expect(final.get("p")).toBe("errored");
      expect(final.get("y")).toBe("completed");
      expect(trace).toEqual(["only:y"]);
    },
  );

  // "Route unknown assignees to my generalist, who is also on the roster" — the
  // same block instance as both a registry worker and the defaultWorker. Each
  // worker identity must be connected ONCE and the connected definition reused,
  // or the two `connectInput` calls produce distinct definitions carrying the
  // same block name and router construction throws `duplicate route name`.
  it("accepts the same block as both a registry worker and the defaultWorker", async () => {
    const trace: string[] = [];
    const generalist = makeEchoWorker("generalist", trace);
    const board = taskBoard({
      name: "floor-aliased",
      collection: { collectionId: "floor-aliased" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { generalist },
      defaultWorker: generalist,
      initialTasks: [
        { id: "d", goal: "declared", assignee: "generalist", input: { topic: "d" } },
        { id: "u", goal: "unclaimed", assignee: "nobody", input: { topic: "u" } },
        { id: "a", goal: "no assignee", input: { topic: "a" } },
      ],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("d")).toBe("completed");
    expect(final.get("u")).toBe("completed");
    expect(final.get("a")).toBe("completed");
    expect(trace.sort()).toEqual(["generalist:a", "generalist:d", "generalist:u"]);
  });

  // Two registry keys aliasing one block instance hit the same seam: without
  // connect-once each key gets its own wrapper — same name, distinct identity.
  it("accepts two registry keys aliasing the same block", async () => {
    const trace: string[] = [];
    const shared = makeEchoWorker("shared", trace);
    const board = taskBoard({
      name: "aliased-keys",
      collection: { collectionId: "aliased-keys" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { alice: shared, bob: shared },
      initialTasks: [
        { id: "x", goal: "a", assignee: "alice", input: { topic: "x" } },
        { id: "y", goal: "b", assignee: "bob", input: { topic: "y" } },
      ],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("x")).toBe("completed");
    expect(final.get("y")).toBe("completed");
    expect(trace.sort()).toEqual(["shared:x", "shared:y"]);
  });

  it("I2: with no defaultWorker, an absent assignee still fails the task", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "no-floor-absent",
      collection: { collectionId: "no-floor-absent" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: { only: makeEchoWorker("only", trace) },
      // No defaultWorker — the miss must still error, exactly as before.
      initialTasks: [
        { id: "a", goal: "no assignee" },
        { id: "y", goal: "ok", assignee: "only", input: { topic: "y" } },
      ],
      onError: "skip",
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("a")).toBe("errored");
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

    const result = await testBlock(board.drain, { input: undefined });
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
        const collection = await getOrCreateTaskCollection({
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
      collection: { backing: "sequencer", collectionId: "fanout" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: fanoutWorker,
      initialTasks: [{ id: "seed", goal: "seed" }],
      idlePollMs: 10,
    });

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("boom-err");
  });

  it("downstream pending task with errored deps blocks loop exit until cancelled (onIdle: 'complete')", async () => {
    // Regression for the legacy `onIdle: "complete"` behavior the
    // FIX-626 default change supersedes. Pinned explicitly: the
    // topological dispatcher excludes `d` (its dep `u` is errored,
    // not completed), and `"complete"` mode still counts `d` as
    // in-flight — workers spin-poll until an external actor cancels
    // the unreachable task. The new `"complete-or-blocked"` default
    // covered by a separate test exits cleanly without the manual
    // cancel.
    let scheduled = false;
    const failingWorker = handler({
      name: "fail-up",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: async (input, ctx) => {
        if (!scheduled) {
          scheduled = true;
          const collection = await getOrCreateTaskCollection({
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
      collection: { backing: "sequencer", collectionId: "df" },
      concurrency: 1,
      dispatcher: "topological",
      workers: failingWorker,
      initialTasks: [
        { id: "u", goal: "u" },
        { id: "d", goal: "d", deps: ["u"] },
      ],
      onError: "skip",
      onIdle: "complete",
      idlePollMs: 10,
      maxIterations: 200,
    });

    const result = await testBlock(board.drain, { input: undefined });
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
          const collection = await getOrCreateTaskCollection({
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
      collection: { backing: "sequencer", collectionId: "review" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: reviewWorker,
      initialTasks: [
        { id: "park", goal: "park", status: "awaiting_review" },
        { id: "trigger", goal: "trigger" },
      ],
      onIdle: "complete",
      // FIX-621: prove event-driven wake. With a 50s idle-poll baseline,
      // the test can only finish in time if `resumeFromReview` fans out
      // a `task-change` item that wakes `.waitForCondition` directly
      // rather than waiting for the next tick.
      idlePollMs: 50_000,
      maxIterations: 500,
    });

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
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

    const result = await testBlock(board.drain, { input: undefined });
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

  it("onIdle: 'complete-or-blocked' (default) exits cleanly when downstream pending has an errored dep", async () => {
    // FIX-626: with the new default, a pending task whose dep errored
    // is detected as structurally unclaimable, so the board exits
    // without requiring an external cancel. Contrast with the legacy
    // `"complete"` regression test above which spins until cancelled.
    const failingWorker = handler({
      name: "fail-up",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: (input) => {
        if (input.goal === "u") throw new Error("upstream failed");
        return null;
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "deps-fail-default",
      collection: { collectionId: "dfd" },
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

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    const final = lastTaskState(result.items);
    expect(final.get("u")).toBe("errored");
    // `d` stays `pending` — the substrate exits without mutating it;
    // cascade-skip (which lives one layer up in P&E / supervisor)
    // would transition it to `cancelled` post-drain.
    expect(final.get("d")).toBe("pending");
  });

  it("onIdle: 'complete-or-blocked' exits cleanly on a successful drain", async () => {
    const trace: string[] = [];
    const board = taskBoard({
      name: "cob-success",
      collection: { collectionId: "cob-success" },
      concurrency: 2,
      dispatcher: "topological",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: [
        { id: "a", goal: "a", input: { topic: "a" } },
        { id: "b", goal: "b", input: { topic: "b" }, deps: ["a"] },
      ],
      onIdle: "complete-or-blocked",
    });

    const result = await testBlock(board.drain, { input: undefined });
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
          const collection = await getOrCreateTaskCollection({
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
      collection: { backing: "sequencer", collectionId: "wm" },
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

    const result = await testBlock(board.drain, { input: undefined });
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
        const c = await collectionFactory(ctx);
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
      .stepIf(
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
      .step(select)
      .tap((preview) => {
        expect((preview as { ready: boolean }).ready).toBe(true);
      })
      .step(claim)
      .step(remixBody);

    const result = await testBlock(pipeline, { input: undefined });
    expect(result.error).toBeNull();
    expect(trace).toEqual(["alpha"]);
  });
});

// ---------------------------------------------------------------------------
// Capability — board.capability exposes the collection at ctx.cap
// ---------------------------------------------------------------------------

describe("taskBoard - capability", () => {
  it("names the capability the board name verbatim (bare accessor key)", () => {
    const board = taskBoard({
      name: "research",
      collection: { collectionId: "research" },
      workers: makeGoalWorker("noop", () => null),
    });
    expect(board.capability).toBeDefined();
    // Bare `<name>` — consumers reach it at `ctx.cap.research`, not
    // `ctx.cap.taskBoard_research`.
    expect(board.capability!.name).toBe("research");
  });

  it("keeps a hyphenated board name verbatim (bracket-accessible)", () => {
    const board = taskBoard({
      name: "research-board",
      workers: makeGoalWorker("noop", () => null),
    });
    expect(board.capability!.name).toBe("research-board");
  });

  it("throws when the board name would poison the accessor prototype", () => {
    expect(() =>
      taskBoard({
        name: "__proto__",
        workers: makeGoalWorker("noop", () => null),
      })
    ).toThrow(/not a safe accessor key/);
    expect(() =>
      taskBoard({
        name: "toString",
        workers: makeGoalWorker("noop", () => null),
      })
    ).toThrow(/not a safe accessor key/);
  });

  it("declares the board's state slot via targetStateSchemas (sequencer backing)", () => {
    const board = taskBoard({
      name: "schemas-board",
      collection: { backing: "sequencer", collectionId: "x" },
      workers: makeGoalWorker("noop", () => null),
    });
    // The sequencer-backed capability declares the board's `tasks` slot so
    // blocks that consume the capability transitively contribute the state
    // schema without manual flow-level wiring.
    const targetSchemas = board.capability!.targetStateSchemas;
    expect(targetSchemas).toBeDefined();
    expect(targetSchemas?.["schemas-board"]).toBeDefined();
  });

  it("does not declare targetStateSchemas for the request default", () => {
    const board = taskBoard({
      name: "req-board",
      workers: makeGoalWorker("noop", () => null),
    });
    // Request-backed tasks live on ctx.request, not a parent sequencer slot.
    expect(board.capability!.targetStateSchemas).toBeUndefined();
  });

  it("returns a factory-backed capability when a caller-supplied factory is used", () => {
    // Factory-backed boards still get a capability — the accessor delegates to
    // the user's factory. No state schema is declared because the storage is
    // opaque (typically a ResourceCollection that already declares its own).
    const board = taskBoard({
      name: "factory-board",
      collection: () => {
        throw new Error("not used in this assertion");
      },
      workers: makeGoalWorker("noop", () => null),
    });
    expect(board.capability).toBeDefined();
    expect(board.capability!.name).toBe("factory-board");
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
    expect(research.capability!.name).toBe("research");
    expect(financials.capability!.name).toBe("financials");
    expect(research.capability!.name).not.toBe(financials.capability!.name);
  });

  it("the board's own pipeline emits task-change items the capability subscribers consume", async () => {
    // End-to-end smoke: the board's drain produces `task-change`
    // component items keyed by `${collectionId}/${taskId}`. Any future
    // consumer that wires the capability into a generator's `uses` and
    // calls `ctx.cap.<name>.tasks()` reads the same collection that emits
    // these items.
    const trace: string[] = [];
    const board = taskBoard({
      name: "smoke",
      collection: { collectionId: "smoke" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", trace),
      initialTasks: [{ id: "a", goal: "alpha", input: { topic: "alpha" } }],
    });

    const result = await testBlock(board.drain, { input: undefined });
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
// Request default — a sibling/outer step can add a task BEFORE the board
// drains (the footgun the sequencer default made throw), and the accessor
// sugar (addTask/addTasks/getTask/listTasks/countTasks) delegates to the ref.
// ---------------------------------------------------------------------------

describe("taskBoard - request default + accessor sugar", () => {
  it("a sibling step adds a task before the board drains (omitted collection)", async () => {
    const processed: string[] = [];
    const board = taskBoard({
      // No `collection` — request default, collectionId = board name.
      name: "preboard",
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", processed),
    });

    // Runs BEFORE board.drain. Under the old sequencer default this threw
    // (the board's state didn't exist yet); with the request default the
    // collection is already reachable from any block in the request.
    const seedFromSibling = handler({
      name: "seed-from-sibling",
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        await ctx.cap.preboard.addTask({
          id: "s1",
          goal: "s1",
          input: { topic: "s1" },
        });
        await ctx.cap.preboard.addTasks([
          { id: "s2", goal: "s2", input: { topic: "s2" } },
        ]);
      },
    });

    const wrapper = sequencer({ name: "preboard-wrapper" })
      .tap(seedFromSibling)
      .tap(board.drain);

    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();
    expect(processed.sort()).toEqual(["uniform:s1", "uniform:s2"]);
  });

  it("getTask/listTasks/countTasks read through the accessor after adds", async () => {
    const board = taskBoard({
      name: "sugar",
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform"),
    });

    const probe = handler({
      name: "sugar-probe",
      inputSchema: z.unknown(),
      outputSchema: z.object({
        count: z.number(),
        first: z.string().optional(),
        completed: z.number(),
      }),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const acc = ctx.cap.sugar;
        await acc.addTask({ id: "t1", goal: "g1", input: { topic: "t1" } });
        await acc.addTasks([{ id: "t2", goal: "g2", input: { topic: "t2" } }]);
        const t1 = await acc.getTask("t1");
        return {
          count: await acc.countTasks(),
          first: t1?.goal,
          completed: (await acc.listTasks({ status: "completed" })).length,
        };
      },
    });

    const wrapper = sequencer({ name: "sugar-wrapper" }).step(probe);
    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ count: 2, first: "g1", completed: 0 });
  });
});

// ---------------------------------------------------------------------------
// Durable (resource-backed) board — `defineTaskCollection` as `collection`.
// ---------------------------------------------------------------------------

describe("taskBoard - durable (resource-backed) collection", () => {
  const todos = defineTaskCollection({
    id: "todos",
    scope: "session",
    stateSchema: z.object({ topic: z.string() }),
  });

  it("drains a resource-backed board and a sibling using board.capability resolves the collection", async () => {
    const processed: string[] = [];
    const board = taskBoard({
      name: "todo-board",
      collection: todos,
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", processed),
    });

    // A sibling action that does NOT run under board.drain — it lists
    // board.capability in `uses`, which installs the durable collection on its
    // own action tree, so the resource resolves. It seeds a task before the
    // drain (durable + request-default composability).
    const seed = handler({
      name: "todo-seed",
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        await ctx.cap["todo-board"].addTask({
          id: "d1",
          goal: "d1",
          input: { topic: "d1" },
        });
      },
    });

    const wrapper = sequencer({ name: "todo-wrapper" })
      .tap(seed)
      .tap(board.drain);

    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();
    expect(processed).toEqual(["uniform:d1"]);
    const final = lastTaskState(result.items);
    expect(final.get("d1")).toBe("completed");
  });

  it("drains a durable board whose task id contains a slash", async () => {
    // The durable resource pattern is `<id>/**` (deep), so a task id like
    // "parent/child" — legal on the request/sequencer backings — round-trips on
    // a durable board too, rather than being rejected by a single-level `/*`.
    const processed: string[] = [];
    const board = taskBoard({
      name: "nested-id-board",
      collection: defineTaskCollection({ id: "nested", scope: "session" }),
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform", processed),
      initialTasks: [{ id: "parent/child", goal: "pc", input: { topic: "pc" } }],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();
    expect(processed).toEqual(["uniform:pc"]);
    expect(lastTaskState(result.items).get("parent/child")).toBe("completed");
  });

  it("re-resolves per call so a read after a mid-run add sees fresh state", async () => {
    const board = taskBoard({
      name: "fresh-board",
      collection: defineTaskCollection({ id: "fresh", scope: "session" }),
      concurrency: 1,
      dispatcher: "fifo",
      workers: makeEchoWorker("uniform"),
    });

    // The accessor is not memoized: two adds separated by a fresh countTasks
    // must both be visible. If the ref were cached from the first resolve, a
    // resource backing (whose sync mirror only tracks refs it created) would
    // still see them — but the count is read through a *new* resolve each time,
    // proving per-call resolution.
    const probe = handler({
      name: "fresh-probe",
      inputSchema: z.unknown(),
      outputSchema: z.object({ afterFirst: z.number(), afterSecond: z.number() }),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const acc = ctx.cap["fresh-board"];
        await acc.addTask({ id: "f1", goal: "f1" });
        const afterFirst = await acc.countTasks();
        await acc.addTask({ id: "f2", goal: "f2" });
        const afterSecond = await acc.countTasks();
        return { afterFirst, afterSecond };
      },
    });

    const wrapper = sequencer({ name: "fresh-wrapper" }).step(probe);
    const result = await testBlock(wrapper, { input: undefined });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ afterFirst: 1, afterSecond: 2 });
  });
});

// ---------------------------------------------------------------------------
// Re-entry — request-scoped collection survives multiple `board.drain`
// invocations from a parent sequencer (FIX-471)
// ---------------------------------------------------------------------------
//
// Sequencer-backed boards lose their `tasks` slot at the end of each
// `board.drain` invocation because sequencer state is per-instance. A
// replan loop that wraps `board.drain` (e.g. the FIX-447 P&E migration)
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
        const collection = await getOrCreateTaskCollection({
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
      .tap(board.drain)
      .tap(enqueueBetween)
      .tap(board.drain);

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
          const collection = await getOrCreateTaskCollection({
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
      .tap(board.drain)
      .tap(makeEnqueue("enq-2", ["r2-y", "r2-z"]))
      .tap(board.drain)
      .tap(makeEnqueue("enq-3", ["r3-q"]))
      .tap(board.drain);

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
        const collection = await getOrCreateTaskCollection({
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
      .tap(board.drain)
      .tap(enqueueRound2)
      .tap(board.drain);

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

    const result = await testBlock(board.drain, { input: undefined });
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

    // FIX-626: terminationReason on a fully-succeeded drain.
    expect(
      (metaItems[0]?.data as { terminationReason?: string } | undefined)
        ?.terminationReason
    ).toBe("all-completed");
  });

  it("emits terminationReason='blocked-by-failures' when a pending task can't be claimed (FIX-626)", async () => {
    const failingWorker = handler({
      name: "fail-up-meta",
      inputSchema: taskWorkerInputSchema,
      outputSchema: noOutputSchema,
      execute: (input) => {
        if (input.goal === "u") throw new Error("upstream failed");
        return null;
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "meta-blocked",
      collection: { collectionId: "meta-blocked" },
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

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();

    type MetaItem = {
      type?: string;
      component?: string;
      data?: {
        status?: string;
        terminationReason?: string;
        counts?: Record<string, number>;
      };
    };
    const completed = (result.items as MetaItem[]).find(
      (i) =>
        i.type === "component" &&
        i.component === "task-board-meta" &&
        i.data?.status === "completed"
    );
    expect(completed?.data?.terminationReason).toBe("blocked-by-failures");
    expect(completed?.data?.counts?.completed).toBe(0);
    expect(completed?.data?.counts?.errored).toBe(1);
    expect(completed?.data?.counts?.pending).toBe(1);
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

    const result = await testBlock(board.drain, { input: undefined });
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
    expect(
      (completed?.data as { terminationReason?: string } | undefined)
        ?.terminationReason
    ).toBe("blocked-by-failures");
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

  // Cross-invocation re-entry — the broader case where `board.drain`
  // is called multiple times from a parent sequencer — is covered by
  // the `taskBoard - re-entry (request-scoped collection)` describe
  // block above. The sequencer-backed default still creates fresh
  // state per invocation by design; consumers that need re-entry opt
  // into `collection: { backing: "request", ... }`.
});

// ---------------------------------------------------------------------------
// Item attribution under concurrency (FIX-658)
// ---------------------------------------------------------------------------

describe("taskBoard - item attribution (FIX-658)", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  function messagesFor(map: Map<string, OutputItem[]>, taskId: string): string[] {
    return (map.get(taskId) ?? [])
      .filter((i) => i.type === "message")
      .map((i) => {
        const c = (i as { content?: Array<{ text?: string }> }).content?.[0];
        return c?.text ?? "";
      });
  }

  it("a sibling spawned mid-run attributes its items to itself, not the queueing task", async () => {
    // discoverer emits, spawns analyzer, then blocks until analyzer has
    // emitted — forcing the analyzer's whole lifecycle to overlap the
    // discoverer's still-open window. The timestamp model put the analyzer's
    // message inside the discoverer's bucket; emit-time taskId keeps them
    // disjoint.
    const analyzerEmitted = deferred();
    const worker = handler({
      name: "worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ack: z.string() }),
      execute: async (input, ctx) => {
        if (input.goal === "discoverer") {
          ctx.emit.message("discoverer step 1");
          const collection = await getOrCreateTaskCollection({
            ctx,
            backing: "sequencer",
            collectionId: "fanout",
            sequencer: ctx.getTarget("fanout")!,
          });
          await collection.addTask({ id: "analyzer", goal: "analyzer" });
          await analyzerEmitted.promise;
          ctx.emit.message("discoverer step 2");
        } else {
          ctx.emit.message("analyzer step 1");
          analyzerEmitted.resolve();
        }
        return { ack: input.goal };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "fanout",
      collection: { backing: "sequencer", collectionId: "fanout" },
      concurrency: 2,
      dispatcher: "fifo",
      workers: worker,
      initialTasks: [{ id: "discoverer", goal: "discoverer" }],
      idlePollMs: 5,
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();

    const windows = extractTaskItemWindows(result.items as OutputItem[], "fanout");
    expect(messagesFor(windows, "discoverer")).toEqual([
      "discoverer step 1",
      "discoverer step 2",
    ]);
    expect(messagesFor(windows, "analyzer")).toEqual(["analyzer step 1"]);
  });

  it("sequential tasks on one worker attribute to their own task", async () => {
    // One worker (concurrency 1) runs t1 then t2. Their execution paths are
    // identical (loopBack reuses the path); only the emit-time taskId stamp
    // separates them.
    const worker = handler({
      name: "worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ack: z.string() }),
      execute: async (input, ctx) => {
        ctx.emit.message(`work:${input.goal}`);
        return { ack: input.goal };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "seq",
      collection: { collectionId: "seq" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: worker,
      initialTasks: [
        { id: "t1", goal: "t1" },
        { id: "t2", goal: "t2" },
      ],
      idlePollMs: 5,
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();

    const windows = extractTaskItemWindows(result.items as OutputItem[], "seq");
    expect(messagesFor(windows, "t1")).toEqual(["work:t1"]);
    expect(messagesFor(windows, "t2")).toEqual(["work:t2"]);
  });
});
