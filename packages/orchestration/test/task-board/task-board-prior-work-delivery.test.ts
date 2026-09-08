/**
 * FIX-1288: `priorWork` must survive a worker's declared `inputSchema`.
 *
 * `packWorkerInput` stamps `TaskWorkerInput.priorWork` from the board's
 * flow policy, but the Zod mirror a worker declares as its `inputSchema`
 * (`taskWorkerInputSchema`) is the gate every dispatch passes through.
 * Zod strips keys the schema doesn't name, so a slot missing from the
 * mirror is a slot no schema-declaring worker can ever read — the pack
 * side and the worker side disagree with nothing failing.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { flowPolicy, type TaskPriorWork, type TaskWorker } from "../../src/tasks";

import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

describe("taskBoard - priorWork reaches a schema-declaring worker", () => {
  it("delivers the flow policy's selection to a worker declaring taskWorkerInputSchema", async () => {
    const captured: unknown[] = [];

    const selection: TaskPriorWork = {
      observations: [
        {
          taskId: "upstream",
          toolName: "search",
          args: { q: "hydrology" },
          result: "two reservoirs",
          cached: false,
          ts: 1,
        },
      ],
      narrative: "upstream searched for hydrology and found two reservoirs",
      meta: { policy: "fixture", selected: 1, available: 1 },
    };

    const captureWorker: TaskWorker = handler({
      name: "capture-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (input) => {
        captured.push(input);
        return { ok: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "prior-work-board",
      collection: { collectionId: "prior-work" },
      workers: captureWorker,
      flowPolicy: flowPolicy.custom(() => selection, "fixture"),
      initialTasks: [{ id: "t1", goal: "solo", assignee: "capture-worker" }],
    });

    const result = await testBlock(board.drain, { input: undefined });
    expect(result.error).toBeNull();

    expect(captured.length).toBe(1);
    const workerInput = captured[0] as { priorWork?: TaskPriorWork };
    expect(workerInput.priorWork).toEqual(selection);
  });
});
