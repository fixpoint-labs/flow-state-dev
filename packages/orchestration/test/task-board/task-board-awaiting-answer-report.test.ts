/**
 * What a drain reports when it stops on a row waiting for a person's answer
 * (FIX-2214): `"awaiting-answer"`, not `"blocked-by-failures"`. Nothing failed,
 * and the reason is what tells a reader whether to fix something or answer it.
 *
 * Both ways a row gets held are pinned, because they reach the ladder by
 * different rungs: a row filed on questions is `pending` and falls to the last
 * rung, while a row that asked midway is `in_progress` with its lease dropped
 * and reads as abandoned to the going-nowhere closure. A failure beside a held
 * row must still win, or the new reason would mask it.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { createStateBackedTaskCollection, type TaskCollectionRef, type TaskInit, type TaskWorker } from "../../src/tasks";
import { askMidway, taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeSequencerState } from "../helpers";

let seq = 0;

function freshCollection(): TaskCollectionRef {
  seq += 1;
  return createStateBackedTaskCollection({
    collectionId: `awaiting-answer-${seq}`,
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
  });
}

/** Drain a one-worker board seeded with `initialTasks` and return the reason its completion item carries. */
async function drainReason(
  collection: TaskCollectionRef,
  initialTasks: TaskInit[],
  worker: TaskWorker
): Promise<{ terminationReason?: string; counts?: Record<string, number> }> {
  const board = taskBoard({
    name: `awaiting-answer-board-${seq}`,
    collection: () => collection,
    concurrency: 1,
    initialTasks,
    workers: worker,
  });
  const result = await testBlock(board.drain, { input: undefined });
  type MetaItem = { type?: string; component?: string; data?: { status?: string; terminationReason?: string; counts?: Record<string, number> } };
  const meta = (result.items as MetaItem[]).filter(
    (i) => i.type === "component" && i.component === "task-board-meta" && i.data?.status === "completed"
  );
  expect(meta).toHaveLength(1);
  return meta[0]!.data!;
}

/** A worker that settles every row it is handed, unless the row's goal says to ask or to fail. */
function workerFor(collection: TaskCollectionRef): TaskWorker {
  return handler({
    name: "awaiting-answer-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ done: z.boolean() }),
    execute: async (input, ctx) => {
      if (input.goal === "ask") {
        const asked = await askMidway(ctx, collection, [{ kind: "question", prompt: "Which date column?" }]);
        if (!asked.ok) throw new Error(`askMidway declined: ${asked.reason}`);
      }
      if (input.goal === "fail") throw new Error("this row fails");
      return { done: true };
    },
  }) as TaskWorker;
}

const QUESTION = { kind: "question" as const, prompt: "Which date column?" };

describe("a drain stopped on a row waiting for an answer", () => {
  it("reports awaiting-answer when the row was filed on a question", async () => {
    const collection = freshCollection();
    const meta = await drainReason(
      collection,
      [
        { id: "done", goal: "settle" },
        { id: "held", goal: "settle", questions: [QUESTION] },
      ],
      workerFor(collection)
    );
    expect(meta.terminationReason).toBe("awaiting-answer");
    expect(meta.counts).toMatchObject({ completed: 1, pending: 1 });
  });

  it("reports awaiting-answer when the row asked midway, though its lease is dropped", async () => {
    const collection = freshCollection();
    const meta = await drainReason(collection, [{ id: "midway", goal: "ask" }], workerFor(collection));
    expect(meta.terminationReason).toBe("awaiting-answer");
    expect(meta.counts).toMatchObject({ in_progress: 1 });
  });

  it("counts a row that depends on the held one as waiting with it, since the answer releases both", async () => {
    const collection = freshCollection();
    const meta = await drainReason(
      collection,
      [
        { id: "held", goal: "settle", questions: [QUESTION] },
        { id: "after", goal: "settle", deps: ["held"] },
      ],
      workerFor(collection)
    );
    expect(meta.terminationReason).toBe("awaiting-answer");
  });

  it("still reports blocked-by-failures when a row failed beside the held one", async () => {
    const collection = freshCollection();
    const meta = await drainReason(
      collection,
      [
        { id: "held", goal: "settle", questions: [QUESTION] },
        { id: "broken", goal: "fail" },
      ],
      workerFor(collection)
    );
    expect(meta.counts).toMatchObject({ errored: 1 });
    expect(meta.terminationReason).toBe("blocked-by-failures");
  });
});
