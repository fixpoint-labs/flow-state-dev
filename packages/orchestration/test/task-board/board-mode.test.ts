/**
 * A board's `mode` (FIX-2076): whether its drain waits on its rows is the
 * author's declared choice, and a board that contradicts it is refused when it
 * is built.
 *
 * - `"plan"` (the default): every row runs in the drain, and the drain waits on
 *   every one. A dispatcher assignee is refused here until the waited dispatch
 *   lands, because a plan board that does not wait is the bug this replaces.
 * - `"delegation"`: every row is handed to another session, and the drain never
 *   waits on one. An inline assignee is refused, and so is a board with no
 *   dispatcher at all.
 *
 * `goalSeekLoop` refuses the two boards whose drain can return with a row not
 * ended: a delegation board, and one that lets a parked row out of its drain.
 * Its judge would rule while work still runs.
 *
 * Each refusal is asserted by the setting it names and the fix it gives, so a
 * refusal that starts firing for another cause fails here.
 */
import { describe, expect, it } from "vitest";
import { dispatcher, handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineTaskCollection, type TaskWorker } from "../../src/tasks";
import { goalSeekLoop, taskBoard, taskWorkerInputSchema, type Verdict } from "../../src/task-board";
import * as taskBoardExports from "../../src/task-board";
import * as packageExports from "../../src";

function inline(name: string): TaskWorker {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ done: z.string() }),
    execute: (input) => ({ done: input.goal }),
  }) as TaskWorker;
}

let count = 0;
function dispatching(action = "work"): TaskWorker {
  count += 1;
  return dispatcher({
    name: `mode-dispatch-${count}`,
    type: "task",
    action,
    session: "per-task",
  }) as unknown as TaskWorker;
}

const durable = (id: string) => defineTaskCollection({ id, scope: "user" });

describe("mode — the declared choice, on the handle", () => {
  it("defaults to a plan board, and says so", () => {
    const board = taskBoard({ name: "mode-default", workers: inline("mode-default-w") });
    expect(board.mode).toBe("plan");
  });

  it("builds a delegation board that declares itself one", () => {
    const board = taskBoard({
      name: "mode-delegation",
      boardId: "mode-delegation",
      mode: "delegation",
      collection: durable("mode-delegation"),
      workers: { implement: dispatching() },
    });
    expect(board.mode).toBe("delegation");
  });

  it("no longer exports the assignee-derived predicate the mode replaces", () => {
    expect("dispatchedTaskPredicate" in taskBoardExports).toBe(false);
    expect("dispatchedTaskPredicate" in packageExports).toBe(false);
  });
});

describe("mode — the three refusals at taskBoard()", () => {
  it("refuses a plan board holding a dispatcher, naming mode: \"delegation\"", () => {
    expect(() =>
      taskBoard({
        name: "plan-with-dispatch",
        boardId: "plan-with-dispatch",
        collection: durable("plan-with-dispatch"),
        workers: { implement: dispatching() },
      })
    ).toThrow(/"plan-with-dispatch" is a plan board.*assignee:implement.*mode: "delegation"/s);
  });

  it("refuses a plan board whose floor dispatches", () => {
    expect(() =>
      taskBoard({
        name: "plan-floor-dispatch",
        boardId: "plan-floor-dispatch",
        collection: durable("plan-floor-dispatch"),
        workers: {},
        defaultWorker: dispatching(),
      })
    ).toThrow(/plan board.*floor.*mode: "delegation"/s);
  });

  it("refuses a delegation board with a named inline assignee", () => {
    expect(() =>
      taskBoard({
        name: "delegation-named-inline",
        boardId: "delegation-named-inline",
        mode: "delegation",
        collection: durable("delegation-named-inline"),
        workers: { implement: dispatching(), summarize: inline("summarize") },
      })
    ).toThrow(/"delegation-named-inline" is a delegation board.*assignee:summarize.*runs in the drain/s);
  });

  it("refuses a delegation board whose uniform worker runs inline", () => {
    expect(() =>
      taskBoard({
        name: "delegation-uniform-inline",
        mode: "delegation",
        workers: inline("uniform"),
      })
    ).toThrow(/delegation board.*uniform.*runs in the drain/s);
  });

  it("refuses a delegation board whose floor runs inline", () => {
    expect(() =>
      taskBoard({
        name: "delegation-floor-inline",
        boardId: "delegation-floor-inline",
        mode: "delegation",
        collection: durable("delegation-floor-inline"),
        workers: { implement: dispatching() },
        defaultWorker: inline("floor"),
      })
    ).toThrow(/delegation board.*floor.*runs in the drain/s);
  });

  it("refuses a delegation board with no dispatcher, naming the default", () => {
    expect(() =>
      taskBoard({
        name: "delegation-empty",
        mode: "delegation",
        workers: {},
      })
    ).toThrow(/"delegation-empty" is a delegation board.*no dispatcher.*drop `mode`/s);
  });
});

describe("goalSeekLoop — refuses a board whose drain can return with a row not ended", () => {
  const judge = () => ({ decision: "done", reason: "ok" }) as Verdict;

  it("refuses a delegation board", () => {
    const board = taskBoard({
      name: "gsl-delegation",
      boardId: "gsl-delegation",
      mode: "delegation",
      collection: durable("gsl-delegation"),
      workers: { implement: dispatching() },
    });
    expect(() => goalSeekLoop({ name: "gsl-delegation-loop", board, judge, maxIterations: 2 })).toThrow(
      /\[goalSeekLoop\] "gsl-delegation-loop".*delegation board.*plan board/s
    );
  });

  it("refuses a board that lets a parked row out of its drain", () => {
    const board = taskBoard({
      name: "gsl-park-exit",
      collection: durable("gsl-park-exit"),
      workers: inline("gsl-park-exit-w"),
      onReview: "exit",
    });
    expect(() => goalSeekLoop({ name: "gsl-park-exit-loop", board, judge, maxIterations: 2 })).toThrow(
      /\[goalSeekLoop\] "gsl-park-exit-loop".*onReview: "exit".*parked/s
    );
  });

  it("still loops over a plan board, whose judge sees every row ended", async () => {
    const seen: string[] = [];
    const board = taskBoard({
      name: "gsl-plan",
      collection: { collectionId: "gsl-plan" },
      workers: inline("gsl-plan-w"),
    });
    const loop = goalSeekLoop({
      name: "gsl-plan-loop",
      board,
      maxIterations: 2,
      seed: handler({
        name: "gsl-plan-seed",
        inputSchema: z.unknown(),
        uses: [board.capability],
        execute: async (_input, ctx) => {
          await (ctx.cap as any)[board.capability.name].addTasks([{ id: "a", goal: "a" }, { id: "b", goal: "b" }]);
        },
      }),
      judge: (input) => {
        for (const task of input.collection.list()) seen.push(`${task.id}:${task.status}`);
        return { decision: "done", reason: "ok" } as Verdict;
      },
    });
    const result = await testBlock(loop, { input: undefined });
    expect(result.error).toBeNull();
    expect(seen.sort()).toEqual(["a:completed", "b:completed"]);
  });
});
