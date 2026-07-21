/**
 * goalSeekLoop primitive tests (FIX-910).
 *
 * Drives the loop with a request-backed stub board + inline judges through the
 * `testBlock` harness. Covers the drain-count / termination-reason taxonomy,
 * the judge-scoped rescue, cap coercion, replan, backing rejection, and
 * construction guards.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";

import {
  taskBoard,
  goalSeekLoop,
  mapToVerdict,
  taskWorkerInputSchema,
  GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
  type Verdict,
  type TaskBoardHandle,
} from "../../src/task-board";
import { getOrCreateTaskCollection } from "../../src/tasks";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** A worker that completes every task immediately. */
function completingWorker(name: string, trace?: string[]) {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ done: z.string() }),
    execute: (input) => {
      trace?.push(input.goal);
      return { done: input.goal };
    },
  });
}

/** Request-backed board (the default), so the loop can re-drain and re-read. */
function makeBoard(name: string, trace?: string[]): TaskBoardHandle<any, any, any> {
  return taskBoard({
    name: `${name}-board`,
    collection: { collectionId: name },
    workers: completingWorker(`${name}-w`, trace),
    onIdle: "complete",
  });
}

/** A seed that adds tasks (with stable ids) via the board accessor. */
function seedTasks(name: string, board: TaskBoardHandle<any, any, any>, ids: string[]) {
  return handler({
    name: `${name}-seed`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      await (ctx.cap as any)[board.capability.name].addTasks(
        ids.map((id) => ({ id, goal: id })),
      );
    },
  });
}

interface Termination {
  reason: string;
  iterations: number;
}

function readTermination(items: unknown[]): Termination | undefined {
  const item = [...items]
    .reverse()
    .find(
      (i) =>
        (i as { type?: string; component?: string }).type === "component" &&
        (i as { component?: string }).component ===
          GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
    ) as { data?: Termination } | undefined;
  return item?.data;
}

// ---------------------------------------------------------------------------
// Termination taxonomy + drain count
// ---------------------------------------------------------------------------

describe("goalSeekLoop - termination + drain count", () => {
  it("done on iteration 1 → single drain, reason converged", async () => {
    const board = makeBoard("done1");
    const loop = goalSeekLoop({
      name: "done1",
      board,
      seed: seedTasks("done1", board, ["a"]),
      judge: () => ({ decision: "done", reason: "converged" }) as Verdict,
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    const term = readTermination(result.items);
    expect(term).toMatchObject({ reason: "converged", iterations: 1 });
  });

  it("continue×2 then done → exactly 3 drains, converged", async () => {
    const board = makeBoard("cont");
    let calls = 0;
    const loop = goalSeekLoop({
      name: "cont",
      board,
      seed: seedTasks("cont", board, ["a"]),
      judge: (): Verdict => {
        calls += 1;
        return calls < 3
          ? { decision: "continue", reason: "waiting" }
          : { decision: "done", reason: "converged" };
      },
      maxIterations: 5,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)).toMatchObject({ reason: "converged", iterations: 3 });
  });

  it("maxIterations: 2 performs exactly 2 drains and reports 2 (never done → max-iterations)", async () => {
    const board = makeBoard("cap2");
    const loop = goalSeekLoop({
      name: "cap2",
      board,
      seed: seedTasks("cap2", board, ["a"]),
      judge: () => ({ decision: "continue", reason: "never" }) as Verdict,
      maxIterations: 2,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)).toMatchObject({ reason: "max-iterations", iterations: 2 });
  });

  it("keeps a done verdict's own reason (self-cap done → max-iterations)", async () => {
    const board = makeBoard("selfcap");
    const loop = goalSeekLoop({
      name: "selfcap",
      board,
      seed: seedTasks("selfcap", board, ["a"]),
      // A self-capping judge stamps its own reason on a budget-fired done.
      judge: () => ({ decision: "done", reason: "max-iterations" }) as Verdict,
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(readTermination(result.items)?.reason).toBe("max-iterations");
  });
});

// ---------------------------------------------------------------------------
// Replan
// ---------------------------------------------------------------------------

describe("goalSeekLoop - replan", () => {
  it("replan with inline tasks grows the board between drains", async () => {
    const board = makeBoard("replan");
    let calls = 0;
    const loop = goalSeekLoop({
      name: "replan",
      board,
      seed: seedTasks("replan", board, ["a"]),
      judge: (): Verdict => {
        calls += 1;
        return calls === 1
          ? { decision: "replan", reason: "more", tasks: [{ id: "b", goal: "b" }] }
          : { decision: "done", reason: "converged" };
      },
      maxIterations: 5,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    // Two drains: initial + after replan added task b.
    expect(readTermination(result.items)?.iterations).toBe(2);
    // Final projection includes both tasks.
    const output = result.output as { tasks: Array<{ id: string }> };
    expect(output.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("replan on the final drain is coerced to max-iterations, board unchanged", async () => {
    const board = makeBoard("replan-cap");
    const loop = goalSeekLoop({
      name: "replan-cap",
      board,
      seed: seedTasks("replan-cap", board, ["a"]),
      judge: () =>
        ({ decision: "replan", reason: "late", tasks: [{ id: "b", goal: "b" }] }) as Verdict,
      maxIterations: 1,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)).toMatchObject({ reason: "max-iterations", iterations: 1 });
    const output = result.output as { tasks: Array<{ id: string }> };
    // The un-drainable replan task was dropped (no orphaned pending).
    expect(output.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("a done verdict carrying a stray tasks array terminates (does not loop/apply)", async () => {
    const board = makeBoard("done-tasks");
    let calls = 0;
    const loop = goalSeekLoop({
      name: "done-tasks",
      board,
      seed: seedTasks("done-tasks", board, ["a"]),
      // A sloppy judge returns `done` with a leftover tasks array. The schema's
      // passthrough lets it through; the loop must still stop, not treat it as a
      // replan and re-drain forever.
      judge: (): Verdict => {
        calls += 1;
        return { decision: "done", reason: "converged", tasks: [{ id: "b", goal: "b" }] } as Verdict;
      },
      maxIterations: 5,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)).toMatchObject({ reason: "converged", iterations: 1 });
    // The stray task was NOT applied.
    const output = result.output as { tasks: Array<{ id: string }> };
    expect(output.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(calls).toBe(1);
  });

  it("replan with an empty tasks array falls through to the configured replanner", async () => {
    const board = makeBoard("replan-empty-inline");
    let judgeCalls = 0;
    const replanner = handler({
      name: "fallthrough-replanner",
      inputSchema: z.unknown(),
      outputSchema: z.object({ tasks: z.array(z.object({ id: z.string(), goal: z.string() })) }),
      execute: () => ({ tasks: [{ id: "b", goal: "b" }] }),
    });
    const loop = goalSeekLoop({
      name: "replan-empty-inline",
      board,
      seed: seedTasks("replan-empty-inline", board, ["a"]),
      // An empty inline tasks array is a replan with no actual work — it should
      // run the replanner, not no-op-add and spin the board to the cap.
      judge: (): Verdict => {
        judgeCalls += 1;
        return judgeCalls === 1
          ? { decision: "replan", reason: "empty", tasks: [] }
          : { decision: "done", reason: "converged" };
      },
      replanner,
      maxIterations: 5,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)?.reason).toBe("converged");
    const output = result.output as { tasks: Array<{ id: string }> };
    expect(output.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("inline replan tasks sharing an id become distinct tasks (no batch rejection)", async () => {
    const board = makeBoard("dup-ids");
    let calls = 0;
    const loop = goalSeekLoop({
      name: "dup-ids",
      board,
      seed: seedTasks("dup-ids", board, ["a"]),
      judge: (): Verdict => {
        calls += 1;
        return calls === 1
          ? {
              decision: "replan",
              reason: "dups",
              tasks: [
                { id: "dup", goal: "x" },
                { id: "dup", goal: "y" },
              ],
            }
          : { decision: "done", reason: "converged" };
      },
      maxIterations: 5,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    const output = result.output as { tasks: Array<{ id: string }> };
    // Both duplicate-id tasks landed as distinct ids — the batch was not rejected.
    expect(output.tasks.map((t) => t.id).sort()).toEqual(["a", "dup", "dup-replan-1"]);
  });

  it("replan with an empty tasks array and no replanner → judge-error", async () => {
    const board = makeBoard("empty-no-replanner");
    const loop = goalSeekLoop({
      name: "empty-no-replanner",
      board,
      seed: seedTasks("empty-no-replanner", board, ["a"]),
      // An empty inline array with no replanner produces no work and can't — so
      // it lands as judge-error rather than spinning to the cap.
      judge: () => ({ decision: "replan", reason: "empty", tasks: [] }) as Verdict,
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)?.reason).toBe("judge-error");
  });

  it("replan (no tasks) runs the configured replanner", async () => {
    const board = makeBoard("replanner");
    let judgeCalls = 0;
    const replanner = handler({
      name: "replanner-block",
      inputSchema: z.unknown(),
      outputSchema: z.object({ tasks: z.array(z.object({ id: z.string(), goal: z.string() })) }),
      execute: () => ({ tasks: [{ id: "b", goal: "b" }] }),
    });
    const loop = goalSeekLoop({
      name: "replanner",
      board,
      seed: seedTasks("replanner", board, ["a"]),
      judge: (): Verdict => {
        judgeCalls += 1;
        return judgeCalls === 1
          ? { decision: "replan", reason: "need-more" }
          : { decision: "done", reason: "converged" };
      },
      replanner,
      maxIterations: 5,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    const output = result.output as { tasks: Array<{ id: string }> };
    expect(output.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Judge-scoped rescue
// ---------------------------------------------------------------------------

describe("goalSeekLoop - judge-scoped rescue", () => {
  it("judge throw → judge-error under onError skip (does not throw)", async () => {
    const board = makeBoard("jerr");
    const loop = goalSeekLoop({
      name: "jerr",
      board,
      seed: seedTasks("jerr", board, ["a"]),
      judge: () => {
        throw new Error("boom");
      },
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)?.reason).toBe("judge-error");
  });

  it("judge throw propagates under onError fail", async () => {
    const board = makeBoard("jfail");
    const loop = goalSeekLoop({
      name: "jfail",
      board,
      seed: seedTasks("jfail", board, ["a"]),
      judge: () => {
        throw new Error("boom");
      },
      onError: "fail",
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).not.toBeNull();
  });

  it("a seed throw propagates (not swallowed as judge-error)", async () => {
    const board = makeBoard("serr");
    const badSeed = handler({
      name: "bad-seed",
      inputSchema: z.unknown(),
      execute: () => {
        throw new Error("seed exploded");
      },
    });
    const loop = goalSeekLoop({
      name: "serr",
      board,
      seed: badSeed,
      judge: () => ({ decision: "done", reason: "converged" }) as Verdict,
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).not.toBeNull();
  });

  it("malformed inline verdict → judge-error", async () => {
    const board = makeBoard("malformed");
    const loop = goalSeekLoop({
      name: "malformed",
      board,
      seed: seedTasks("malformed", board, ["a"]),
      // Missing reason → Zod-rejected at the judgeStep boundary.
      judge: () => ({ decision: "done" }) as unknown as Verdict,
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)?.reason).toBe("judge-error");
  });

  it("configured replanner that emits no tasks → judge-error (skip)", async () => {
    const board = makeBoard("replanner-empty");
    const replanner = handler({
      name: "empty-replanner",
      inputSchema: z.unknown(),
      outputSchema: z.object({ tasks: z.array(z.unknown()) }),
      execute: () => ({ tasks: [] }),
    });
    const loop = goalSeekLoop({
      name: "replanner-empty",
      board,
      seed: seedTasks("replanner-empty", board, ["a"]),
      judge: () => ({ decision: "replan", reason: "more" }) as Verdict,
      replanner,
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(readTermination(result.items)?.reason).toBe("judge-error");
  });
});

// ---------------------------------------------------------------------------
// Terminal item non-clobbering
// ---------------------------------------------------------------------------

describe("goalSeekLoop - terminal item", () => {
  it("emits a distinct component type that does not clobber task-board-meta", async () => {
    const board = makeBoard("distinct");
    const loop = goalSeekLoop({
      name: "distinct",
      board,
      seed: seedTasks("distinct", board, ["a"]),
      judge: () => ({ decision: "done", reason: "converged" }) as Verdict,
      maxIterations: 3,
    });
    const result = await testBlock(loop, { input: undefined });
    const boardMeta = result.items.filter(
      (i) => (i as any).type === "component" && (i as any).component === "task-board-meta",
    );
    const termination = result.items.filter(
      (i) =>
        (i as any).type === "component" &&
        (i as any).component === GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
    );
    // The board's own completed snapshot survives; the termination is additive.
    expect(boardMeta.length).toBeGreaterThan(0);
    expect(termination.length).toBe(1);
    expect((termination[0] as any).component).not.toBe("task-board-meta");
    // It's an internal observability signal — not client/history-rendered — so
    // it never surfaces as raw JSON in the client stream.
    expect((termination[0] as any).itemVisibility).toEqual({
      client: false,
      history: false,
    });
  });
});

// ---------------------------------------------------------------------------
// finalize + projection
// ---------------------------------------------------------------------------

describe("goalSeekLoop - finalize", () => {
  it("omitted finalize returns the settled-board projection", async () => {
    const board = makeBoard("proj");
    const loop = goalSeekLoop({
      name: "proj",
      board,
      seed: seedTasks("proj", board, ["a", "b"]),
      judge: () => ({ decision: "done", reason: "converged" }) as Verdict,
      maxIterations: 1,
    });
    const result = await testBlock(loop, { input: undefined });
    const output = result.output as { tasks: unknown[]; results: unknown[] };
    expect(output.tasks.length).toBe(2);
    expect(output.results.length).toBe(2);
  });

  it("finalize receives the projection", async () => {
    const board = makeBoard("fin");
    const finalize = handler({
      name: "finalizer",
      inputSchema: z.object({ tasks: z.array(z.unknown()), results: z.array(z.unknown()) }),
      outputSchema: z.object({ count: z.number() }),
      execute: (projection) => ({ count: projection.tasks.length }),
    });
    const loop = goalSeekLoop({
      name: "fin",
      board,
      seed: seedTasks("fin", board, ["a", "b", "c"]),
      judge: () => ({ decision: "done", reason: "converged" }) as Verdict,
      maxIterations: 1,
      finalize,
    });
    const result = await testBlock(loop, { input: undefined });
    expect((result.output as { count: number }).count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// mapToVerdict
// ---------------------------------------------------------------------------

describe("mapToVerdict", () => {
  it("maps complete → done with default converged reason", () => {
    const v = mapToVerdict({ decision: "complete" }, {
      decision: (s) => (s.decision === "complete" ? "done" : "continue"),
    });
    expect(v).toEqual({ decision: "done", reason: "converged" });
  });

  it("maps continue → continue and does not carry tasks", () => {
    const v = mapToVerdict({ decision: "continue" }, {
      decision: () => "continue",
    });
    expect(v).toEqual({ decision: "continue", reason: "continue" });
  });

  it("maps replan with tasks", () => {
    const v = mapToVerdict({ decision: "replan" }, {
      decision: () => "replan",
      tasks: () => [{ id: "x", goal: "x" }],
    });
    expect(v).toMatchObject({ decision: "replan", reason: "replan", tasks: [{ id: "x" }] });
  });

  it("honors an explicit reason fn", () => {
    const v = mapToVerdict({ n: 5 }, {
      decision: () => "done",
      reason: (s) => (s.n >= 5 ? "max-iterations" : "converged"),
    });
    expect(v.reason).toBe("max-iterations");
  });
});

// ---------------------------------------------------------------------------
// Construction guards
// ---------------------------------------------------------------------------

describe("goalSeekLoop - construction guards", () => {
  const judge = () => ({ decision: "done", reason: "converged" }) as Verdict;

  it("rejects a sequencer-backed board (any maxIterations)", () => {
    const board = taskBoard({
      name: "seq-board",
      collection: { backing: "sequencer", collectionId: "seq" },
      workers: completingWorker("seq-w"),
    });
    expect(() =>
      goalSeekLoop({ name: "seq", board, judge, maxIterations: 1 }),
    ).toThrow(/request- or resource-backed/);
    expect(() =>
      goalSeekLoop({ name: "seq", board, judge, maxIterations: 3 }),
    ).toThrow(/request- or resource-backed/);
  });

  it("rejects a factory-backed board", () => {
    const board = taskBoard({
      name: "fac-board",
      collection: (ctx) =>
        getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "fac" }),
      workers: completingWorker("fac-w"),
    });
    expect(() =>
      goalSeekLoop({ name: "fac", board, judge, maxIterations: 1 }),
    ).toThrow(/request- or resource-backed/);
  });

  it("rejects a non-finite / non-positive / non-integer maxIterations", () => {
    const board = makeBoard("guard");
    for (const bad of [0, -1, 1.5, Infinity, NaN]) {
      expect(() =>
        goalSeekLoop({ name: "guard", board, judge, maxIterations: bad }),
      ).toThrow(/finite positive integer/);
    }
  });

  it("rejects a maxIterations > 1 board carrying idless initialTasks", () => {
    const board = taskBoard({
      name: "idless-board",
      collection: { collectionId: "idless" },
      workers: completingWorker("idless-w"),
      initialTasks: [{ goal: "no-id" }],
    });
    expect(() =>
      goalSeekLoop({ name: "idless", board, judge, maxIterations: 2 }),
    ).toThrow(/idless|stable id/i);
    // Single-pass is allowed (no re-seed).
    expect(() =>
      goalSeekLoop({ name: "idless", board, judge, maxIterations: 1 }),
    ).not.toThrow();
  });
});
