/**
 * A question is one kind of task hold (FIX-2317): the filer's hold (status
 * `held`) and a hold for the user (`Task.holds`) each keep a row from being
 * claimed on their own, through the one admission predicate, `isClaimable`.
 * If either stopped blocking, a board would start work its filer parked, or
 * work still waiting on the user's answer.
 */
import { describe, expect, it } from "vitest";
import { isClaimable } from "../../src/tasks";
import { taskSchema, type Task } from "../../src/tasks/schema/task";

const NOW = 1_000;
const base = { id: "t", goal: "Write the adoption script", attempts: 0, createdAt: 1, updatedAt: 1 };
const question = {
  id: "q1",
  actor: "user",
  openedAt: 1,
  source: { kind: "row", closedBy: [{ by: "answer" }] },
  ask: { kind: "question", prompt: "Which CSV export?" },
};
const stop = {
  id: "s1",
  actor: "user",
  openedAt: 1,
  source: { kind: "suspension", requestId: "r1", suspensionId: "s1" },
  ask: { kind: "approval", prompt: "Run it?" },
};

const task = (fields: Record<string, unknown>): Task => taskSchema.parse({ ...base, ...fields }) as Task;
const claimable = (row: Task) => isClaimable(row, () => undefined, NOW);

describe("one claim gate over every kind of hold", () => {
  it("claims a pending row nothing holds (the control)", () => {
    expect(claimable(task({ status: "pending" }))).toBe(true);
  });

  it("the filer's hold alone blocks the claim", () => {
    expect(claimable(task({ status: "held" }))).toBe(false);
  });

  it("a question hold alone blocks the claim, before a start and on a running row whose lease lapsed", () => {
    expect(claimable(task({ status: "pending", holds: [question] }))).toBe(false);
    expect(claimable(task({ status: "in_progress", attempts: 1, leaseUntil: NOW - 1, holds: [question] }))).toBe(false);
    // The same lapsed row with no hold is reclaimed: the hold is what blocks it.
    expect(claimable(task({ status: "in_progress", attempts: 1, leaseUntil: NOW - 1 }))).toBe(true);
  });

  it("a suspension hold, the mirror of a run's suspendForUser stop, blocks the claim too", () => {
    expect(claimable(task({ status: "in_progress", attempts: 1, leaseUntil: NOW - 1, holds: [stop] }))).toBe(false);
  });
});
