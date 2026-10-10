/**
 * The worker's envelope carries an answer only to the attempt it answers
 * (FIX-1817 S5's input): `answer` is the row's `feedback` when the row was
 * re-queued by an answer (`answered`), and absent otherwise, so a retry after
 * a failure, whose `feedback` is the error, is never handed it as an answer.
 */
import { describe, expect, it } from "vitest";
import { packWorkerInput } from "../../src/task-board/blocks/worker-step";
import type { Task, TaskCollectionRef } from "../../src/tasks";

const row = (patch: Partial<Task>): Task =>
  ({ id: "t", goal: "Pick a region", status: "in_progress", attempts: 2, createdAt: 1, updatedAt: 1, ...patch }) as Task;
const board = { get: () => undefined } as unknown as TaskCollectionRef;

describe("the envelope's answer", () => {
  it("is the feedback of a row re-queued by an answer", async () => {
    const input = await packWorkerInput(row({ feedback: "eu-west", answered: true }), board);
    expect(input).toMatchObject({ answer: "eu-west", feedback: "eu-west" });
  });

  it("is absent on a retry after a failure, whose feedback is the error", async () => {
    const input = await packWorkerInput(row({ feedback: "tests failed" }), board);
    expect("answer" in input).toBe(false);
    expect(input.feedback).toBe("tests failed");
  });

  it("carries the task a follow-up follows, which a per-task hand-off keys its session by", async () => {
    const input = await packWorkerInput(row({ id: "root-f1", followUpOf: "root" }), board);
    expect(input.followUpOf).toBe("root");
    expect("followUpOf" in (await packWorkerInput(row({}), board))).toBe(false);
  });
});
