/**
 * An inline board's drain returns once nothing is claimable, even while one of
 * its rows is held on a question nobody has answered yet. The held row waits
 * for its answer; the drain that runs after the answer claims the turn it owes,
 * on the same attempt, and that turn settles the task. On both backings.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  openHolds,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import { askMidway, taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

/** Long enough for a prompt drain, short enough that a hang fails here instead of at the test timeout. */
const PROMPT_MS = 2_000;

async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not return within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe.each([
  [
    "sequencer-backed",
    async (): Promise<TaskCollectionRef> =>
      createStateBackedTaskCollection({
        collectionId: "inline-held",
        state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      }),
  ],
  [
    "resource-backed",
    async (): Promise<TaskCollectionRef> =>
      createResourceBackedTaskCollection({ collectionId: "inline-held", collection: createFakeResourceCollection() }),
  ],
])("an inline board's drain with a row held on an unanswered question (%s)", (_name, make) => {
  it("returns promptly; answering afterwards runs the owed turn on attempt 1 and settles the task", async () => {
    const collection = await make();
    const attempts: number[] = [];
    const worker = handler({
      name: "inline-asking-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ answer: z.string() }),
      execute: async (input, ctx) => {
        attempts.push(input.attempts);
        if (attempts.length > 1) return { answer: "the whole answer" };
        const asked = await askMidway(ctx, collection, [{ prompt: "Which date column?" }]);
        if (!asked.ok) throw new Error(`askMidway declined: ${asked.reason}`);
        return { answer: "a partial answer" };
      },
    }) as TaskWorker;
    const board = taskBoard({
      name: "inline-held-board",
      collection: () => collection,
      concurrency: 1,
      initialTasks: [{ id: "t", goal: "write the script" }],
      workers: worker,
    });

    // Once the worker asks, nothing is claimable: the drain returns, the row stays held and unsettled.
    await within(testBlock(board.drain, { input: undefined }), PROMPT_MS, "the drain with a held row");
    expect(attempts).toEqual([1]);
    const held = await collection.get("t");
    expect(held).toMatchObject({ status: "in_progress", attempts: 1 });
    const [hold] = openHolds(held!);
    expect(hold).toBeDefined();

    // The answer owes one more turn on the same attempt; the next drain claims it and settles the task.
    expect(await collection.answer!("t", { hold: hold!.id, message: "signup_date", from: "user", by: "u1" })).toEqual({
      outcome: "recorded",
    });
    await within(testBlock(board.drain, { input: undefined }), PROMPT_MS, "the drain after the answer");
    expect(attempts).toEqual([1, 1]);
    expect(await collection.get("t")).toMatchObject({ status: "completed", attempts: 1, output: { answer: "the whole answer" } });
  }, 20_000);
});
