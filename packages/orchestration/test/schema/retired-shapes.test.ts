/**
 * The retired-shape read: a task row stored in a shape a published version
 * wrote reads in the current shape. One shape is read, `blocked`, which
 * orchestration 0.5.0 and earlier stored; the shapes no published version
 * wrote are not read at all.
 */
import { describe, expect, it } from "vitest";
import { withRetiredShapes } from "../../src/tasks/schema/retired-shapes";
import { persistedTaskStatusSchema } from "../../src/tasks/schema/task-status";
import { taskSchema } from "../../src/tasks/schema/task";

const row = { id: "t", goal: "t", attempts: 0, createdAt: 1, updatedAt: 1 };

describe("the retired-shape read", () => {
  it("returns a row in no retired shape as the same object", () => {
    const current = { ...row, status: "pending" };
    expect(withRetiredShapes(current)).toBe(current);
  });

  it("blocked: reads as held, with the block's reason kept apart from what a worker reads", () => {
    const read = withRetiredShapes({ ...row, status: "blocked", error: "waiting on legal", metadata: { team: "a" } });
    expect(read).toMatchObject({ status: "held", metadata: { team: "a", heldReason: "waiting on legal" } });
    expect(read).not.toHaveProperty("error");
    expect(read).not.toHaveProperty("feedback");
    // A fixed point: read again, unchanged.
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("blocked: the parse path reads the status as held too", () => {
    expect(persistedTaskStatusSchema.parse("blocked")).toBe("held");
  });

  it("reads none of the shapes no published version wrote", () => {
    const shapes = [
      { ...row, status: "pending", undispatched: true },
      { ...row, status: "running", keptOpenBy: "queued", leaseUntil: 5 },
      { ...row, status: "running", keptOpenBy: "wait" },
      { ...row, status: "pending", questions: [{ id: "q" }] },
      { ...row, status: "pending", reopened: true }, // retired-name-refusal: the probe of a shape no longer read
      { ...row, status: "pending", sealed: { kind: "post" } },
    ];
    for (const stored of shapes) expect(withRetiredShapes(stored)).toBe(stored);
    // The parse path refuses a wait no published version wrote, rather than mapping it.
    expect(taskSchema.safeParse({ ...row, status: "running", keptOpenBy: "wait" }).success).toBe(false);
  });
});
