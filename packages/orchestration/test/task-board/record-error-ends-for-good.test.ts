/**
 * The recorder ends a final failure on this attempt. An ordinary error still
 * retries, and so does a final failure about another row: an inner board's
 * "don't retry" must not cost the outer row the attempts its filer chose.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { createRecordError, TaskEndsForGoodError } from "../../src/task-board/blocks/record-result";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import {
  createStateBackedTaskCollection,
  isTerminalStatus,
  ticketForClaim,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import { createFakeSequencerState } from "../helpers";

/** A claimed row with attempts to spare, and the recorder's context holding its claim. */
async function claimedWithAttemptsLeft(): Promise<{ collection: TaskCollectionRef; ctx: BlockContext }> {
  const state = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const collection = createStateBackedTaskCollection({ collectionId: "tasks", state });
  await collection.addTask({ id: "t", goal: "work", maxAttempts: 3 });
  const task = (await collection.claim("w"))!;
  const bodyState = createFakeSequencerState<{ currentClaim?: unknown }>({
    currentClaim: ticketForClaim("tasks", task),
  });
  return { collection, ctx: { sequencer: bodyState } as unknown as BlockContext };
}

function recorder(collection: TaskCollectionRef) {
  return createRecordError({ name: "ends-for-good", collection: async () => collection, onError: "skip" });
}

describe("the error recorder and a failure no retry can change", () => {
  it("fails the row for good on this attempt, with the worker's reason", async () => {
    const { collection, ctx } = await claimedWithAttemptsLeft();

    await runForTest(recorder(collection), new TaskEndsForGoodError("refused: names no project", { taskId: "t" }), ctx);

    expect(collection.get("t")).toMatchObject({ status: "errored", attempts: 1, error: "refused: names no project" });
  });

  it("cancels the row instead when the worker asks for a cancel", async () => {
    const { collection, ctx } = await claimedWithAttemptsLeft();

    await runForTest(
      recorder(collection),
      new TaskEndsForGoodError("refused: remote not allowed", { taskId: "t", ending: "cancelled" }),
      ctx,
    );

    expect(collection.get("t")).toMatchObject({ status: "cancelled", attempts: 1 });
  });

  it("still re-queues an ordinary failure with attempts left", async () => {
    const { collection, ctx } = await claimedWithAttemptsLeft();

    await runForTest(recorder(collection), new Error("flaky"), ctx);

    expect(collection.get("t")?.status).toBe("pending");
  });

  it("treats a marker naming another row as an ordinary failure", async () => {
    const { collection, ctx } = await claimedWithAttemptsLeft();

    await runForTest(recorder(collection), new TaskEndsForGoodError("an inner row's verdict", { taskId: "inner" }), ctx);

    expect(collection.get("t")?.status).toBe("pending");
  });

  // A store that throws on a declined transition instead of honouring
  // `ifAllowed` is the extension point the advisory seam exists for. A row
  // someone else already cancelled must not turn the cancel arm's write into
  // an error that escapes the recorder and abandons the board's siblings.
  it("contains a declined cancel on a store that throws on an illegal transition", async () => {
    const { collection: inner, ctx } = await claimedWithAttemptsLeft();
    const throwsWhenTerminal =
      (verb: "fail" | "cancel") =>
      async (id: string, ...rest: unknown[]) => {
        const row = inner.get(id);
        if (row !== undefined && isTerminalStatus(row.status)) throw new Error(`illegal ${row.status} -> ${verb}`);
        return (inner[verb] as (...args: unknown[]) => Promise<unknown>)(id, ...rest);
      };
    const collection = { ...inner, fail: throwsWhenTerminal("fail"), cancel: throwsWhenTerminal("cancel") } as unknown as TaskCollectionRef;
    await inner.cancel("t", "a coordinator cancelled it");

    await runForTest(
      recorder(collection),
      new TaskEndsForGoodError("refused", { taskId: "t", ending: "cancelled" }),
      ctx,
    );

    expect(inner.get("t")).toMatchObject({ status: "cancelled", error: "a coordinator cancelled it" });
  });
});

describe("a board nested inside a worker", () => {
  /**
   * The outer board's worker drains an inner board that fails (`onError:
   * "fail"`), so the inner worker's error reaches the outer recorder. Returns
   * how many times the outer worker ran.
   */
  async function outerRunsWhenInnerThrows(innerError: (taskId: string) => Error): Promise<number> {
    let outerRuns = 0;
    const innerWorker = handler({
      name: "inner-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.null(),
      execute: (input) => {
        throw innerError(input.taskId);
      },
    }) as TaskWorker;
    const inner = taskBoard({
      name: "inner",
      collection: { collectionId: "inner" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: innerWorker,
      initialTasks: [{ id: "inner-t", goal: "inner", maxAttempts: 1 }],
      onError: "fail",
    });
    const outerWorker = sequencer({ name: "outer-worker", inputSchema: taskWorkerInputSchema })
      .tap(() => {
        outerRuns += 1;
      })
      .tap(inner.drain) as unknown as TaskWorker;
    const outer = taskBoard({
      name: "outer",
      collection: { collectionId: "outer" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: outerWorker,
      initialTasks: [{ id: "outer-t", goal: "outer", maxAttempts: 3 }],
      onError: "skip",
    });

    await testBlock(outer.drain, { input: undefined });
    return outerRuns;
  }

  it("does not let the inner row's 'don't retry' end the outer row on its first attempt", async () => {
    const runs = await outerRunsWhenInnerThrows((taskId) => new TaskEndsForGoodError("inner refused", { taskId }));
    expect(runs).toBeGreaterThan(1);
  });

  it("control: a plain inner error gives the outer row its retry", async () => {
    const runs = await outerRunsWhenInnerThrows(() => new Error("inner failed"));
    expect(runs).toBeGreaterThan(1);
  });
});
