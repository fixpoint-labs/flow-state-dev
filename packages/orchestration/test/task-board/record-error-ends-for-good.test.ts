/** The recorder ends a final failure on this attempt. An ordinary error still retries. */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import { createRecordError, TaskEndsForGoodError } from "../../src/task-board/blocks/record-result";
import { createStateBackedTaskCollection, ticketForClaim, type TaskCollectionRef } from "../../src/tasks";
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

    await runForTest(recorder(collection), new TaskEndsForGoodError("refused: names no project"), ctx);

    expect(collection.get("t")).toMatchObject({ status: "errored", attempts: 1, error: "refused: names no project" });
  });

  it("cancels the row instead when the worker asks for a cancel", async () => {
    const { collection, ctx } = await claimedWithAttemptsLeft();

    await runForTest(
      recorder(collection),
      new TaskEndsForGoodError("refused: remote not allowed", { ending: "cancelled" }),
      ctx,
    );

    expect(collection.get("t")).toMatchObject({ status: "cancelled", attempts: 1 });
  });

  it("still re-queues an ordinary failure with attempts left", async () => {
    const { collection, ctx } = await claimedWithAttemptsLeft();

    await runForTest(recorder(collection), new Error("flaky"), ctx);

    expect(collection.get("t")?.status).toBe("pending");
  });
});
