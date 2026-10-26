/**
 * The worker's envelope: a retry's `feedback` is its error, never an answer,
 * and an answer to a question reaches the next turn as a steer naming it
 * (FIX-2131, on FIX-2133's hold), so the envelope has no answer of its own.
 */
import { describe, expect, it } from "vitest";
import { packWorkerInput } from "../../src/task-board/blocks/worker-step";
import type { Task, TaskCollectionRef } from "../../src/tasks";

const row = (patch: Partial<Task>): Task =>
  ({ id: "t", goal: "Pick a region", status: "in_progress", attempts: 2, createdAt: 1, updatedAt: 1, ...patch }) as Task;
const board = { get: () => undefined } as unknown as TaskCollectionRef;

describe("the worker's envelope", () => {
  it("carries no answer: a retry after a failure gets its feedback, the error", async () => {
    const input = await packWorkerInput(row({ feedback: "tests failed" }), board);
    expect("answer" in input).toBe(false);
    expect(input.feedback).toBe("tests failed");
  });

  it("carries every steer, taken or not, so a retry is never run as first filed (FIX-2086 D1)", async () => {
    const steers: Task["steers"] = [
      { id: "s1", message: "Use the North America numbers", from: "filer", at: 1, takenBy: 1 },
      { id: "s2", message: "Add the totals", from: "user", by: "u_alice", at: 2 },
    ];
    const input = await packWorkerInput(row({ steers }), board);
    expect(input.steers).toEqual([
      { message: "Use the North America numbers", from: "filer" },
      { message: "Add the totals", from: "user" },
    ]);
    expect("steers" in (await packWorkerInput(row({}), board))).toBe(false);
  });

  it("carries the task a follow-up follows, which a per-task dispatch keys its session by", async () => {
    const input = await packWorkerInput(row({ id: "root-f1", followUpOf: "root" }), board);
    expect(input.followUpOf).toBe("root");
    expect("followUpOf" in (await packWorkerInput(row({}), board))).toBe(false);
  });
});
