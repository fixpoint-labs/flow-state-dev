/**
 * A board's `mode` (FIX-2076): whether its drain waits on its rows is the
 * author's declared choice, and a board that contradicts it is refused when it
 * is built.
 *
 * - `"plan"` (the default): the drain waits on every row. A row runs in the
 *   drain, or is handed to another session and waited on (FIX-2082): a
 *   dispatcher that says `wait: false` is refused.
 * - `"delegation"`: every row is handed to another session, and the drain never
 *   waits on one. An inline assignee is refused, and so is a board with no
 *   dispatcher at all.
 *
 * `goalSeekLoop` refuses a board whose drain can return with a row not ended,
 * a delegation board: its judge would rule while work still runs. A board
 * built with the removed review option is refused by name (FIX-2131).
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
function dispatching(action = "work", wait?: boolean): TaskWorker {
  count += 1;
  return dispatcher({
    name: `mode-dispatch-${count}`,
    type: "task",
    action,
    session: "per-task",
    ...(wait !== undefined ? { wait } : {}),
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
  it("builds a plan board holding a dispatcher: its drain waits on the rows it hands over (FIX-2082)", () => {
    const board = taskBoard({
      name: "plan-with-dispatch",
      boardId: "plan-with-dispatch",
      collection: durable("plan-with-dispatch"),
      workers: { implement: dispatching(), summarize: inline("plan-with-dispatch-inline") },
      defaultWorker: dispatching(),
    });
    expect(board.mode).toBe("plan");
  });

  it("refuses a plan board whose dispatcher says wait: false, naming mode: \"delegation\"", () => {
    expect(() =>
      taskBoard({
        name: "plan-no-wait",
        boardId: "plan-no-wait",
        collection: durable("plan-no-wait"),
        workers: { implement: dispatching("work", false) },
      })
    ).toThrow(/"plan-no-wait" is a plan board.*assignee:implement.*wait: false.*mode: "delegation"/s);
  });

  it("refuses a delegation board whose dispatcher says wait: true", () => {
    expect(() =>
      taskBoard({
        name: "delegation-waits",
        boardId: "delegation-waits",
        mode: "delegation",
        collection: durable("delegation-waits"),
        workers: { implement: dispatching("work", true) },
      })
    ).toThrow(/"delegation-waits" is a delegation board.*assignee:implement.*wait: true.*drop `mode`/s);
  });

  it("refuses newSession on a delegation board, and anything but a task dispatcher there", () => {
    expect(() =>
      taskBoard({
        name: "delegation-new-session",
        boardId: "delegation-new-session",
        mode: "delegation",
        collection: durable("delegation-new-session"),
        workers: { implement: dispatching() },
        newSession: dispatching() as never,
      })
    ).toThrow(/"delegation-new-session" is a delegation board and declares newSession/);
    expect(() =>
      taskBoard({
        name: "plan-new-session-inline",
        boardId: "plan-new-session-inline",
        collection: durable("plan-new-session-inline"),
        workers: inline("plan-new-session-inline-w"),
        newSession: inline("not-a-dispatcher") as never,
      })
    ).toThrow(/"plan-new-session-inline" newSession is not a task dispatcher/);
  });

  it("holds newSession to every dispatched board's rules: a board id and a durable ledger", () => {
    expect(() =>
      taskBoard({
        name: "plan-new-session-request",
        workers: inline("plan-new-session-request-w"),
        newSession: dispatching() as never,
      })
    ).toThrow(/"plan-new-session-request" dispatches assignees \(newSession\) but has no boardId/);
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

  it("refuses a board built with the retired onReview, by name (FIX-2131)", () => { // retired-name-refusal: refusal test
    for (const onReview of ["exit", "hold"]) { // retired-name-refusal: refusal test
      expect(() =>
        taskBoard({
          name: "gsl-park-exit",
          collection: durable("gsl-park-exit"),
          workers: inline("gsl-park-exit-w"),
          onReview, // retired-name-refusal: refusal test
        } as never),
      ).toThrow(/"gsl-park-exit" sets `onReview`, which was removed \(FIX-2131\).*askQuestion.*waitForUser.*blocked/s); // retired-name-refusal: refusal test
    }
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
          await (ctx.cap as any)[board.capability.name].createTasks([{ id: "a", goal: "a" }, { id: "b", goal: "b" }]);
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
