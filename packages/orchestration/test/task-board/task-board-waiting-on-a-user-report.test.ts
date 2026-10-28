/**
 * A drain that stops on work waiting on a user reports "waiting-on-a-user".
 * A filed question and a midway ask reach that by different rungs; a failure
 * beside either still reports "blocked-by-failures".
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { createStateBackedTaskCollection, type Task, type TaskCollectionRef, type TaskInit, type TaskWorker } from "../../src/tasks";
import { askMidway, taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createBoardMetaCompleted } from "../../src/task-board/blocks/board-meta";
import { createFakeSequencerState } from "../helpers";

let seq = 0;

function freshCollection(): TaskCollectionRef {
  seq += 1;
  return createStateBackedTaskCollection({
    collectionId: `waiting-on-a-user-${seq}`,
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
    name: `waiting-on-a-user-board-${seq}`,
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
    name: "waiting-on-a-user-worker",
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

/** QUESTION as a stored open row hold, for rows written straight to the store. */
const STORED_QUESTION = {
  id: "q-1",
  actor: "user",
  openedAt: 1,
  source: { kind: "row", closedBy: [{ by: "answer" }] },
  ask: QUESTION,
};

describe("a drain stopped on a row waiting on a user", () => {
  it("reports waiting-on-a-user when the row was filed on a question", async () => {
    const collection = freshCollection();
    const meta = await drainReason(
      collection,
      [
        { id: "done", goal: "settle" },
        { id: "held", goal: "settle", questions: [QUESTION] },
      ],
      workerFor(collection)
    );
    expect(meta.terminationReason).toBe("waiting-on-a-user");
    expect(meta.counts).toMatchObject({ completed: 1, pending: 1 });
  });

  it("reports waiting-on-a-user when the row asked midway, though its lease is dropped", async () => {
    const collection = freshCollection();
    const meta = await drainReason(collection, [{ id: "midway", goal: "ask" }], workerFor(collection));
    expect(meta.terminationReason).toBe("waiting-on-a-user");
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
    expect(meta.terminationReason).toBe("waiting-on-a-user");
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

/**
 * The closure seed and the rung, on rows stored directly and read by the
 * completion block alone: an open hold says a user owes the row a turn;
 * nothing else does.
 */
describe("the completion reason over stored rows", () => {
  const NOW = 1_000_000;

  /** A collection at a fixed clock holding exactly `rows`, as stored. */
  async function storedCollection(rows: Record<string, unknown>[]): Promise<TaskCollectionRef> {
    seq += 1;
    const tasks = Object.fromEntries(
      rows.map((row) => [row.id as string, { goal: row.id, attempts: 1, deps: [], createdAt: 1, updatedAt: 1, ...row }])
    );
    return createStateBackedTaskCollection({
      collectionId: `waiting-on-a-user-stored-${seq}`,
      state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks }),
      now: () => NOW,
    });
  }

  async function reasonOf(
    collection: TaskCollectionRef,
    runsElsewhere?: (task: Task) => boolean
  ): Promise<string | undefined> {
    const block = createBoardMetaCompleted({
      name: `waiting-on-a-user-meta-${seq}`,
      collection: async () => collection,
      collectionId: collection.collectionId,
      ...(runsElsewhere !== undefined ? { runsElsewhere } : {}),
    });
    const result = await testBlock(block, { input: [{ shouldContinue: false, reason: "blocked" }] });
    expect(result.error).toBeNull();
    type MetaItem = { type?: string; component?: string; data?: { terminationReason?: string } };
    return (result.items as MetaItem[]).find((i) => i.type === "component" && i.component === "task-board-meta")?.data
      ?.terminationReason;
  }

  it("reports waiting-on-a-user for a run stopped for a review, its lease dropped", async () => {
    // A review is a run's stop for a user, mirrored as a suspension hold;
    // the user's answer resumes it, so its lapsed lease is not abandonment.
    const collection = await storedCollection([
      {
        id: "reviewing",
        status: "in_progress",
        leaseUntil: NOW - 1,
        questions: [
          {
            id: "susp-1",
            actor: "user",
            openedAt: 1,
            source: { kind: "suspension", requestId: "req-1", suspensionId: "susp-1" },
            ask: { kind: "review", prompt: "Review the draft?" },
          },
        ],
      },
    ]);
    expect(await reasonOf(collection)).toBe("waiting-on-a-user");
  });

  it("reports blocked-by-failures for a running row with a lapsed lease and nothing open on it", async () => {
    // Abandoned: no hold, so nothing owes it a turn. The seed must not admit it.
    const collection = await storedCollection([{ id: "abandoned", status: "in_progress", leaseUntil: NOW - 1 }]);
    expect(await reasonOf(collection)).toBe("blocked-by-failures");
  });

  it("reports blocked-by-failures for a row filed on a question whose dependency can never complete", async () => {
    // Answering releases the hold but not the dependency: an older build
    // could store a dep on a row that is not on the board.
    const collection = await storedCollection([
      {
        id: "held-on-missing",
        status: "pending",
        attempts: 0,
        deps: ["missing"],
        questions: [STORED_QUESTION],
      },
    ]);
    expect(await reasonOf(collection)).toBe("blocked-by-failures");
  });

  it("reports blocked-by-failures for a held-status row, even with an open question on it", async () => {
    const collection = await storedCollection([
      {
        id: "held-status",
        status: "held",
        attempts: 0,
        questions: [STORED_QUESTION],
      },
    ]);
    expect(await reasonOf(collection)).toBe("blocked-by-failures");
  });

  /** A row filed on one open question, as stored. */
  const questionRow = (id: string): Record<string, unknown> => ({
    id,
    status: "pending",
    attempts: 0,
    questions: [STORED_QUESTION],
  });

  it("reports waiting-on-a-user, not blocked-by-failures, with a dispatched row beside the question row", async () => {
    // The question row is not dispatched, so `dispatched` cannot match here;
    // what this pins is that the dispatched row, going somewhere, does not
    // turn a board that waits on a user into a failure.
    const collection = await storedCollection([
      questionRow("asked"),
      { id: "background-work", status: "in_progress", assignee: "background", leaseUntil: NOW + 60_000 },
    ]);
    const runsElsewhere = (task: Task): boolean => task.assignee === "background";
    expect(await reasonOf(collection, runsElsewhere)).toBe("waiting-on-a-user");
  });
});
