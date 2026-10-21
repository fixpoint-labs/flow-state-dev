/**
 * A drain pays a cascade a crash left owed before it decides to exit.
 *
 * An ending records its debt (`cascadeOwed`) in its own write and pays it at
 * once; a crash between the two leaves the debt for the next touch of the
 * board. A drain is such a touch. The row behind the dead dependency is never
 * claimable, so if the drain pays only after its workers:
 *
 * - on `onIdle: "complete"` (parallelTasks, eventActors) that row counts as in
 *   flight, so the workers idle-wait until `maxIterations` before the drain
 *   ends;
 * - on the default `onIdle: "complete-or-blocked"` the drain exits, but its
 *   completion item reports a `pending` row the pay step then cancels.
 *
 * Both modes must cancel the dependent before the exit check, so the drain
 * ends promptly and its completion item matches the stored board.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { CASCADE_DUE_MS, type Task, type TaskCollectionRef, type TaskWorker } from "../../src/tasks";
import { taskBoard, taskBoardStateSchema, taskWorkerInputSchema } from "../../src/task-board";

const IDLE_POLL_MS = 5;
const MAX_ITERATIONS = 30;
/** One idle wait times out at `idlePollMs * 100`; a spinning drain takes `MAX_ITERATIONS` of them. */
const ONE_IDLE_WAIT_MS = IDLE_POLL_MS * 100;

type MetaData = { counts?: { pending?: number; cancelled?: number }; terminationReason?: string };

/** The data on the board's last completion item. */
function lastMeta(items: readonly unknown[]): MetaData | undefined {
  type MetaItem = { type?: string; component?: string; data?: unknown };
  const metas = (items as MetaItem[]).filter((i) => i.type === "component" && i.component === "task-board-meta");
  return metas.at(-1)?.data as MetaData | undefined;
}

function buildScenario(onIdle: "complete" | "complete-or-blocked") {
  const boardName = `owed-cascade-${onIdle}`;
  const processed: string[] = [];
  let after: TaskCollectionRef | undefined;

  const worker = handler({
    name: `${boardName}-worker`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: (input) => {
      processed.push(input.goal);
      return { ok: input.goal };
    },
  }) as TaskWorker;

  const board = taskBoard({
    name: boardName,
    concurrency: 2,
    workers: worker,
    onIdle,
    idlePollMs: IDLE_POLL_MS,
    maxIterations: MAX_ITERATIONS,
  });

  // The rows as a crash left them: `a` failed for good and recorded its debt,
  // already past due, and nothing paid it, so `b` still waits on it.
  const crash = handler({
    name: `${boardName}-crash`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();
      await tasks.addTasks([
        { id: "a", goal: "a" },
        { id: "b", goal: "b", deps: ["a"] },
      ]);
      const now = Date.now();
      // A request board keeps its rows on the request, under its collection id.
      const rows = (ctx.request.state as Record<string, Record<string, Task>>)[boardName]!;
      await ctx.request.patchState({
        [boardName]: {
          ...rows,
          a: {
            ...rows.a!,
            status: "errored",
            attempts: 1,
            error: "boom",
            cascadeOwed: { due: now - CASCADE_DUE_MS, endedAt: now - 2 * CASCADE_DUE_MS },
          },
        },
      });
    },
  });

  const read = handler({
    name: `${boardName}-read`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      after = await ctx.cap[boardName].tasks();
    },
  });

  const root = sequencer({
    name: `${boardName}-root`,
    inputSchema: z.unknown(),
    stateSchema: taskBoardStateSchema,
  })
    .tap(crash)
    .tap(board.drain)
    .tap(read);

  return { root, processed, tasksAfter: () => after! };
}

describe.each(["complete", "complete-or-blocked"] as const)("a drain on onIdle %s", (onIdle) => {
  it("cancels a dependent whose dependency's cascade a crash left owed, before it exits", async () => {
    const { root, processed, tasksAfter } = buildScenario(onIdle);

    const started = Date.now();
    const result = await testBlock(root, { input: undefined });
    const elapsed = Date.now() - started;

    expect(result.error).toBeNull();
    expect(processed).toEqual([]);
    expect(tasksAfter().get("b")).toMatchObject({ status: "cancelled", causedBy: "a" });
    expect(tasksAfter().get("a")?.cascadeOwed).toBeUndefined();
    // The completion item agrees with the stored board.
    expect(lastMeta(result.items)).toMatchObject({ counts: { pending: 0, cancelled: 1 } });
    // A drain that spun to `maxIterations` takes MAX_ITERATIONS idle waits.
    // One that pays before its exit check needs at most a couple.
    expect(elapsed).toBeLessThan(ONE_IDLE_WAIT_MS * 4);
  }, 30_000);
});
