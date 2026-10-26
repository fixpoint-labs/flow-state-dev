/**
 * `reportProgress` (FIX-2081 D3): the worker's one task tool. It acts on the
 * row its turn's claim holds and takes no id; it reports a status note and a
 * checkpoint of the output; neither changes the status; the latest
 * checkpoint is the task's output, so the final result is written only when
 * the worker never checkpointed; and a finished task refuses it.
 *
 * Driven inside a real board drain, so the claim is the one the drain's
 * worker body stamps, and the ending is the drain's own recorder.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createStateBackedTaskCollection,
  ticketForClaim,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createReportProgress } from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

function boardCollection(collectionId: string): TaskCollectionRef {
  return createStateBackedTaskCollection({
    collectionId,
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
  });
}

/** A drain over `collection` whose one worker runs `turn`, given the tool and the turn's context. */
async function drainWith(
  collection: TaskCollectionRef,
  ids: string[],
  turn: (tool: ReturnType<typeof createReportProgress>, input: { taskId: string }, ctx: BlockContext) => Promise<unknown>,
) {
  const progress = createReportProgress({ resolve: async () => collection });
  const worker = handler({
    name: "progress-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
    execute: async (input, ctx) => turn(progress, input, ctx as BlockContext),
  }) as TaskWorker;
  const board = taskBoard({
    name: `${collection.collectionId}-board`,
    collection: () => collection,
    concurrency: 1,
    initialTasks: ids.map((id, i) => ({ id, goal: `do ${id}`, priority: ids.length - i })),
    workers: worker,
  });
  const result = await testBlock(board.drain, { input: undefined });
  expect(result.error).toBeNull();
}

describe("reportProgress on a task turn", () => {
  it("writes a note and a checkpoint on the row its claim holds, and the status stays running", async () => {
    const collection = boardCollection("progress-own");
    const seen: unknown[] = [];
    await drainWith(collection, ["mine"], async (progress, _input, ctx) => {
      expect(await progress.offered(ctx)).toBe(true);
      seen.push(await runForTest(progress.tool, { statusNote: "Drafting the summary", output: "two sections" }, ctx));
      seen.push(collection.get("mine"));
      return "the final answer";
    });
    expect(seen[0]).toEqual({ ok: true, taskId: "mine" });
    expect(seen[1]).toMatchObject({ status: "in_progress", statusNote: "Drafting the summary", output: "two sections", checkpointed: true });
  });

  it("keeps the latest checkpoint as the output: the final result doesn't replace it", async () => {
    const collection = boardCollection("progress-latest");
    await drainWith(collection, ["mine"], async (progress, _input, ctx) => {
      await runForTest(progress.tool, { output: "first draft" }, ctx);
      await runForTest(progress.tool, { output: "second draft" }, ctx);
      return "the final answer";
    });
    expect(collection.get("mine")).toMatchObject({ status: "completed", output: "second draft" });
  });

  it("writes the final result as the output when the worker never checkpointed, a status note alone included", async () => {
    const collection = boardCollection("progress-none");
    await drainWith(collection, ["mine"], async (progress, _input, ctx) => {
      await runForTest(progress.tool, { statusNote: "Halfway" }, ctx);
      return "the final answer";
    });
    expect(collection.get("mine")).toMatchObject({ status: "completed", output: "the final answer", statusNote: "Halfway" });
  });

  it("takes no id: a turn reports only on the row it holds, never a sibling", async () => {
    const collection = boardCollection("progress-sibling");
    const fields = Object.keys((createReportProgress({ resolve: async () => collection }).tool as any).config.inputSchema.shape);
    expect(fields.sort()).toEqual(["output", "statusNote"]);
    await drainWith(collection, ["first", "second"], async (progress, input, ctx) => {
      await runForTest(progress.tool, { output: `checkpoint of ${input.taskId}` }, ctx);
      return "done";
    });
    expect(collection.get("first")?.output).toBe("checkpoint of first");
    expect(collection.get("second")?.output).toBe("checkpoint of second");
  });

  it("refuses a report with neither field, and writes nothing", async () => {
    const collection = boardCollection("progress-empty");
    let answer: unknown;
    await drainWith(collection, ["mine"], async (progress, _input, ctx) => {
      answer = await runForTest(progress.tool, {}, ctx);
      return "done";
    });
    expect(answer).toMatchObject({ ok: false, error: expect.stringMatching(/^progress_takes_a_note_or_output:/) });
    expect(collection.get("mine")).not.toHaveProperty("statusNote");
  });
});

describe("reportProgress off a task turn, and once the task has finished", () => {
  it("is not offered, and refused, on a turn that holds no task", async () => {
    const collection = boardCollection("progress-off");
    const progress = createReportProgress({ resolve: async () => collection });
    const ctx = { session: { identity: { id: "s1" }, state: {} }, request: { identity: { id: "r1" } } } as never;
    expect(await progress.offered(ctx)).toBe(false);
    expect(await runForTest(progress.tool, { statusNote: "hi" }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^not_a_task_turn:/),
    });
  });

  it("the collection refuses a report on a finished task, and keeps its output", async () => {
    for (const make of [boardCollection]) {
      const collection = make("progress-finished");
      await collection.addTask({ id: "t", goal: "g" });
      const claimed = (await collection.claim("w"))!;
      const claim = ticketForClaim(collection.collectionId, claimed);
      await collection.complete("t", "the result", { claim });
      const outcome = await collection.reportProgress!("t", { output: "late" }, { claim });
      expect(outcome).toMatchObject({ outcome: "declined", reason: "terminal" });
      expect(collection.get("t")?.output).toBe("the result");
    }
  });

  it("a failed attempt keeps the checkpoint for the next one", async () => {
    const collection = boardCollection("progress-retry");
    await collection.addTask({ id: "t", goal: "g", maxAttempts: 2 });
    const first = (await collection.claim("w"))!;
    const claim = ticketForClaim(collection.collectionId, first);
    await collection.reportProgress!("t", { output: "partial" }, { claim });
    await collection.fail("t", "boom", { claim });
    expect(collection.get("t")).toMatchObject({ status: "pending", output: "partial", checkpointed: true });
  });

  it("keeps a failed attempt's checkpoint as the output when a later attempt completes without one (D3)", async () => {
    // The owner's rule, literally: the latest checkpoint is the output, and the
    // final answer counts only when no checkpoint was ever made.
    const collection = boardCollection("progress-retry-literal");
    await collection.addTask({ id: "t", goal: "g", maxAttempts: 2 });
    const first = ticketForClaim(collection.collectionId, (await collection.claim("w"))!);
    await collection.reportProgress!("t", { output: "partial" }, { claim: first });
    await collection.fail("t", "boom", { claim: first });
    const second = ticketForClaim(collection.collectionId, (await collection.claim("w"))!);
    await collection.complete("t", "the full answer", { claim: second });
    expect(collection.get("t")).toMatchObject({ status: "completed", output: "partial", checkpointed: true });
  });

});
