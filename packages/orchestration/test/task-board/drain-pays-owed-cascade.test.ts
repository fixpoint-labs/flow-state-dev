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
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { CASCADE_DUE_MS, defineTaskCollection, type Task, type TaskCollectionRef, type TaskWorker } from "../../src/tasks";
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

type Backing = "state" | "resource";

/** The rows as a crash left them: `a` failed for good with its debt past due, and `b` still waits on it. */
function crashedRows(now: number): Task[] {
  const base = { attempts: 0, createdAt: now, updatedAt: now, revision: 1 } as const;
  return [
    { ...base, id: "a", goal: "a", status: "errored", attempts: 1, error: "boom", cascadeOwed: { due: now - CASCADE_DUE_MS, endedAt: now - 2 * CASCADE_DUE_MS } } as Task,
    { ...base, id: "b", goal: "b", status: "pending", deps: ["a"] } as Task,
  ];
}

function buildScenario(backing: Backing, onIdle: "complete" | "complete-or-blocked") {
  const boardName = `owed-cascade-${backing}-${onIdle}`;
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
    ...(backing === "resource" ? { collection: defineTaskCollection({ id: boardName, scope: "session" }) } : {}),
    concurrency: 2,
    workers: worker,
    onIdle,
    idlePollMs: IDLE_POLL_MS,
    maxIterations: MAX_ITERATIONS,
  });

  // Written straight into the store, before anything in this request resolves
  // the board, as a process that died between the ending and its cascade left them.
  const crash = handler({
    name: `${boardName}-crash`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const rows = crashedRows(Date.now());
      if (backing === "resource") {
        // A durable board's rows are its resource collection's instances, keyed by id.
        const store = (ctx.resources as unknown as Record<string, ResourceCollectionRef<JsonObject>>)[boardName]!;
        for (const row of rows) await store.create(row.id, row as unknown as JsonObject);
      } else {
        // A request board keeps its rows on the request, under its collection id.
        await ctx.request.patchState({ [boardName]: Object.fromEntries(rows.map((row) => [row.id, row])) });
      }
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

describe.each(["state", "resource"] as const)("a %s-backed board", (backing) => {
  describe.each(["complete", "complete-or-blocked"] as const)("draining on onIdle %s", (onIdle) => {
    it("cancels a dependent whose dependency's cascade a crash left owed, before it exits", async () => {
      const { root, processed, tasksAfter } = buildScenario(backing, onIdle);

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
});
