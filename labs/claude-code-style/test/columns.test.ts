/**
 * The board's columns, against the spec's one table: a column is what the
 * person owes the task, read from its status and what it waits on, never a
 * mark the lab keeps.
 */
import { describe, expect, it } from "vitest";
import type { TaskRow } from "../src/adapter";
import { columnOf } from "../src/lib/columns";

const task = (patch: Partial<TaskRow>): TaskRow => ({ id: "t", title: "t", goal: "g", status: "in_progress", ...patch });

describe("columnOf", () => {
  it.each([
    ["pending", task({ status: "pending" }), "working"],
    ["in progress", task({}), "working"],
    ["held with no open question", task({ status: "held" }), "working"],
    ["held on a question", task({ status: "held", waitingOn: { kind: "question", prompt: "EU or US?" } }), "waiting"],
    ["waiting on your input", task({ status: "in_progress", waitingOn: { kind: "input", prompt: "Which plan?" } }), "waiting"],
    ["waiting on your approval", task({ status: "in_progress", waitingOn: { kind: "approval", prompt: "Send it?" } }), "waiting"],
    ["failed", task({ status: "errored" }), "waiting"],
    ["waiting on your review", task({ status: "in_progress", waitingOn: { kind: "review", prompt: "Draft attached" } }), "review"],
    ["completed", task({ status: "completed" }), "resolved"],
    ["cancelled", task({ status: "cancelled" }), "resolved"],
  ])("puts a task that is %s under its column", (_name, row, column) => {
    expect(columnOf(row, false)).toBe(column);
  });

  it("puts a pinned task under Pinned whatever its status", () => {
    expect(columnOf(task({ status: "in_progress", waitingOn: { kind: "review", prompt: "x" } }), true)).toBe("pinned");
    expect(columnOf(task({ status: "completed" }), true)).toBe("pinned");
  });
});
