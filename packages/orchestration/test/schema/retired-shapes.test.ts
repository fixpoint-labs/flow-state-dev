/**
 * The retired-shape read: a task row stored in a shape a published version
 * wrote reads in the current shape. Two shapes are read: `blocked`, which
 * orchestration 0.5.0 and earlier stored, and a task's own hold marked
 * `source.kind: "row"`, which every version before FIX-2479 stored; the shapes
 * no published version wrote are not read at all.
 */
import { describe, expect, it } from "vitest";
import { withRetiredShapes } from "../../src/tasks/schema/retired-shapes";
import { persistedTaskStatusSchema } from "../../src/tasks/schema/task-status";
import { taskSchema } from "../../src/tasks/schema/task";
import { taskHoldSchema } from "../../src/tasks/schema/hold";
import { newOwnHolds } from "../../src/tasks/collection/holds";

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

  // FIX-2479 D1. A task's own hold (a question, a confirm, an external wait) is written
  // `"task"`; one stored under the retired `"row"` reads as `"task"` on both reads, so no
  // reader downstream branches on `"row"`.
  describe("a task's own hold stored under the row marker", () => {
    const legacy = {
      id: "q1",
      actor: "user",
      openedAt: 1,
      source: { kind: "row", closedBy: [{ by: "answer" }] },
      ask: { kind: "question", prompt: "Which region?" },
    };
    const confirm = {
      ...legacy,
      id: "c1",
      ask: { kind: "confirm", prompt: "Ship it?", onNo: "cancel" },
    };
    const stop = {
      id: "susp_1",
      actor: "user",
      openedAt: 1,
      source: { kind: "suspension", requestId: "r", suspensionId: "susp_1" },
      ask: { kind: "input", prompt: "Which branch?" },
    };

    it("the parse path reads it as the task's own, a confirm included", () => {
      expect(taskHoldSchema.parse(legacy).source).toEqual({ kind: "task", closedBy: [{ by: "answer" }] });
      expect(taskHoldSchema.parse(confirm)).toMatchObject({
        source: { kind: "task" },
        ask: { kind: "confirm", onNo: "cancel" },
      });
      expect(taskSchema.parse({ ...row, status: "in_progress", holds: [legacy, stop] }).holds?.map((hold) => hold.source.kind)).toEqual(["task", "suspension"]);
    });

    it("the row read maps it forward and keeps a run's stop as it is", () => {
      const read = withRetiredShapes({ ...row, status: "in_progress", holds: [legacy, stop] });
      expect(read.holds.map((hold) => hold.source.kind)).toEqual(["task", "suspension"]);
      expect(read.holds[1]).toBe(stop);
      // A fixed point: read again, unchanged; a row whose holds are current is the same object.
      expect(withRetiredShapes(read)).toBe(read);
    });

    it("a hold written now says task, never row", () => {
      const [written] = newOwnHolds([{ kind: "question", prompt: "Which region?" }], 1);
      expect(written!.source.kind).toBe("task");
      expect(taskHoldSchema.parse(written).source.kind).toBe("task");
    });

    it("refuses a marker no version wrote", () => {
      expect(taskHoldSchema.safeParse({ ...legacy, source: { kind: "ask", closedBy: [{ by: "answer" }] } }).success).toBe(false);
    });
  });
});
