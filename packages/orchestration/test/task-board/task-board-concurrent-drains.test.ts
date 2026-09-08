/**
 * Two drains of one board, overlapping in one process, keep separate flow
 * state (FIX-1244).
 *
 * The board's per-run tool cache and observation ledger are installed at the
 * top of every drain and cleared at its end. `board.unparkAndDrain` makes an
 * overlapping drain the ordinary case rather than an accident: on a hold
 * board the drain that parked the task is still open when the answer's drain
 * starts, and on an exit board two answers can arrive in two requests at
 * once. If the two drains shared one bag, the second's install would take the
 * first's ledger away and the second's teardown would clear it under the
 * first's still-running workers, which would then stop receiving `priorWork`.
 *
 * The measurement is the first drain's later worker: it must still be handed
 * `priorWork` after a whole second drain has installed, run, and torn down in
 * another request while it waited.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { flowPolicy, type TaskPriorWork, type TaskWorker, type TaskWorkerInput } from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("taskBoard - a drain in another request cannot take this drain's flow state away", () => {
  it("keeps delivering priorWork to the first drain after a second drain installs and tears down", async () => {
    const selection: TaskPriorWork = {
      observations: [],
      narrative: "what the board knew before this task",
      meta: { policy: "fixture", selected: 0, available: 0 },
    };

    const captured: Array<{ taskId: string; priorWork: TaskPriorWork | undefined }> = [];
    const firstWorkerEntered = deferred();
    const releaseFirstWorker = deferred();
    let held = false;

    const worker: TaskWorker = handler({
      name: "concurrent-drains-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (input: TaskWorkerInput) => {
        // The first drain to reach `t1` parks itself here until the test lets
        // it go; the second drain, started only once the first is waiting,
        // runs straight through.
        if (input.taskId === "t1" && !held) {
          held = true;
          firstWorkerEntered.resolve();
          await releaseFirstWorker.promise;
        }
        captured.push({ taskId: input.taskId, priorWork: input.priorWork });
        return { ok: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "concurrent-drains-board",
      collection: { collectionId: "concurrent-drains" },
      workers: worker,
      concurrency: 1,
      flowPolicy: flowPolicy.custom(() => selection, "fixture"),
      initialTasks: [
        { id: "t1", goal: "first", assignee: "concurrent-drains-worker" },
        { id: "t2", goal: "second", assignee: "concurrent-drains-worker", deps: ["t1"] },
      ],
    });

    const first = testBlock(board.drain, { input: undefined });
    await firstWorkerEntered.promise;

    const second = await testBlock(board.drain, { input: undefined });
    expect(second.error).toBeNull();

    releaseFirstWorker.resolve();
    const firstResult = await first;
    expect(firstResult.error).toBeNull();

    // Four worker runs: t1 and t2 in each request. The first drain's `t2` is
    // the last of them, and it ran after the second drain had already torn
    // down. It must still carry the policy's selection.
    expect(captured.map((c) => c.taskId)).toEqual(["t1", "t2", "t1", "t2"]);
    const firstDrainsSecondTask = captured[3];
    expect(firstDrainsSecondTask?.priorWork).toEqual(selection);
    for (const run of captured) {
      expect(run.priorWork).toEqual(selection);
    }
  });
});
