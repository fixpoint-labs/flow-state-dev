/**
 * Back-compat guarantee for FIX-610 Layer A.
 *
 * Boards built WITHOUT a `flowPolicy` config must produce
 * `TaskWorkerInput` values that have no `priorWork` field at all
 * (omitted, not `undefined`). A pre-FIX-610 worker that destructures
 * its input or `Object.keys`-walks it should be wire-identical to the
 * new build.
 *
 * The fixture worker captures the `TaskWorkerInput` it receives so we
 * can assert directly on the property bag.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import type { TaskWorker } from "../../src/tasks";

import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

describe("taskBoard - flow-policy back-compat", () => {
  it("omits priorWork on TaskWorkerInput when no flowPolicy is configured", async () => {
    const captured: unknown[] = [];

    const captureWorker: TaskWorker = handler({
      name: "capture-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (input) => {
        captured.push(input);
        return { ok: true };
      },
    }) as TaskWorker;

    // Default config — no flowPolicy or toolCache hint. Pre-FIX-610
    // wire shape: a single task drains and the worker sees a
    // TaskWorkerInput without a `priorWork` slot.
    const board = taskBoard({
      name: "backcompat-board",
      collection: { collectionId: "backcompat" },
      workers: captureWorker,
      initialTasks: [
        { id: "t1", goal: "solo", assignee: "capture-worker" },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();

    expect(captured.length).toBe(1);
    const workerInput = captured[0] as Record<string, unknown>;
    // `hasOwnProperty.call` is the strict check the spec asks for:
    // the field must be truly absent, not present-with-undefined.
    expect(
      Object.prototype.hasOwnProperty.call(workerInput, "priorWork"),
    ).toBe(false);
  });
});
