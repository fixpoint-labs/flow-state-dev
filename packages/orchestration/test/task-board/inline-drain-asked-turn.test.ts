/**
 * An inline board's drain records a worker's result with the claim of the
 * turn it ran. A turn that asked midway, whose question was answered before
 * the drain recorded it, must not settle the task: the answer owes the next
 * turn, on the same attempt, and that turn settles it.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createStateBackedTaskCollection,
  MIN_LEASE_DURATION_MS,
  openHolds,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskWorker,
} from "../../src/tasks";
import { askMidway, taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeSequencerState } from "../helpers";

describe("an inline board's drain, after a turn that asked midway", () => {
  it("settles nothing when the question was answered before the drain recorded the turn; the owed turn settles it", async () => {
    const collection: TaskCollectionRef = createStateBackedTaskCollection({
      collectionId: "inline-asked",
      state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    });
    const turns: number[] = [];
    const worker = handler({
      name: "inline-questioning-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ answer: z.string() }),
      execute: async (input, ctx) => {
        turns.push(input.attempts);
        if (turns.length > 1) return { answer: "the whole answer" };
        const asked = await askMidway(ctx, collection, [{ prompt: "Which date column?" }]);
        // The person answers at once: before the worker returns and the drain records it.
        if (asked.ok) await collection.answer!(input.taskId, { hold: asked.holds[0]!, message: "signup_date", from: "user", by: "u1" });
        return { answer: "a partial answer" };
      },
    }) as TaskWorker;
    const board = taskBoard({
      name: "inline-asked-board",
      collection: () => collection,
      concurrency: 1,
      initialTasks: [{ id: "t", goal: "write the script" }],
      workers: worker,
    });

    // One drain: the asking turn records nothing, and the turn its answer owes is claimed and settles.
    await testBlock(board.drain, { input: undefined });
    expect(turns).toEqual([1, 1]);
    expect(collection.get("t")).toMatchObject({ status: "completed", attempts: 1, turn: 2, output: { answer: "the whole answer" } });
  });

  it("returns normally when the asking turn runs on past a lease renewal: the question holds the task, and the turn is not aborted", async () => {
    // A question asked midway leaves the turn's lease-renewal driver running until the turn
    // returns. Its next renewal is declined `held`: the row waits on a
    // person, and nobody took it. Reading that as a lost claim aborted the
    // turn, and under `onError: "fail"` failed the whole drain (FIX-2131).
    const collection: TaskCollectionRef = createStateBackedTaskCollection({
      collectionId: "inline-asked-renewal",
      state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    });
    const shortLease: TaskDispatcher = {
      async claim(ref, workerId) {
        return ref.claim(workerId, { leaseDurationMs: MIN_LEASE_DURATION_MS });
      },
    };
    let aborted: boolean | undefined;
    const worker = handler({
      name: "inline-asking-past-renewal",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ answer: z.string() }),
      execute: async (_input, ctx) => {
        await askMidway(ctx, collection, [{ prompt: "Which date column?" }]);
        // The turn's final response, past a renewal tick (a third of the lease).
        await new Promise((resolve) => setTimeout(resolve, MIN_LEASE_DURATION_MS / 2 + 200));
        aborted = ctx.signal?.aborted;
        return { answer: "asked" };
      },
    }) as TaskWorker;
    const board = taskBoard({
      name: "inline-asked-renewal-board",
      collection: () => collection,
      concurrency: 1,
      onError: "fail",
      dispatcher: shortLease,
      initialTasks: [{ id: "t", goal: "write the script" }],
      workers: worker,
    });

    await testBlock(board.drain, { input: undefined });
    expect(aborted).toBe(false);
    const row = collection.get("t")!;
    expect(row).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(openHolds(row).map((hold) => hold.ask.prompt)).toEqual(["Which date column?"]);
  });
});
