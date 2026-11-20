/**
 * The board's columns, against the spec's one table: a column is what the
 * person owes the task, read from its status and what it waits on, never a
 * mark the lab keeps.
 */
import { describe, expect, it } from "vitest";
import type { CodingBoardTask } from "../src/app";
import { ask, codingBoardTask } from "./coding-board-task";
import { columnOf, dismissalKey, waitingOnYou } from "../src/lib/columns";

const task = (patch: Partial<CodingBoardTask>): CodingBoardTask => codingBoardTask({ id: "t", title: "t", goal: "g", ...patch });

describe("columnOf", () => {
  it.each([
    ["pending", task({ status: "pending" }), "working"],
    ["in progress", task({}), "working"],
    ["held with no open question", task({ status: "held" }), "working"],
    ["held on a question", task({ status: "held", asks: [ask("question", "EU or US?")] }), "waiting"],
    ["waiting on your input", task({ status: "in_progress", asks: [ask("input", "Which plan?")] }), "waiting"],
    ["waiting on your approval", task({ status: "in_progress", asks: [ask("approval", "Send it?")] }), "waiting"],
    ["failed", task({ status: "errored" }), "waiting"],
    ["waiting on your review", task({ status: "in_progress", asks: [ask("review", "Draft attached")] }), "review"],
    ["completed", task({ status: "completed" }), "resolved"],
    ["cancelled", task({ status: "cancelled" }), "resolved"],
  ])("puts a task that is %s under its column", (_name, row, column) => {
    expect(columnOf(row, false)).toBe(column);
  });

  it("moves a failure you dismissed from Waiting on you to Resolved, and only that attempt's", () => {
    expect(columnOf(task({ status: "errored", attempts: 1 }), false, true)).toBe("resolved");
    // A dismissal is a failed task's alone: it never resolves work under way.
    expect(columnOf(task({ status: "in_progress", attempts: 1 }), false, true)).toBe("working");
    expect(dismissalKey(task({ id: "t", attempts: 1 }))).not.toBe(dismissalKey(task({ id: "t", attempts: 2 })));
  });

  it("puts a pinned task under Pinned whatever its status", () => {
    expect(columnOf(task({ status: "in_progress", asks: [ask("review", "x")] }), true)).toBe("pinned");
    expect(columnOf(task({ status: "completed" }), true)).toBe("pinned");
  });
});

describe("waitingOnYou", () => {
  it("counts what you owe a session: questions, input, reviews and failures, never work under way or done", () => {
    const tasks = [
      task({ status: "held", asks: [ask("question", "EU or US?")] }),
      task({ status: "in_progress", asks: [ask("review", "Draft attached")] }),
      task({ status: "errored" }),
      task({}),
      task({ status: "held" }),
      task({ status: "completed" }),
      task({ status: "cancelled" }),
    ];
    expect(waitingOnYou(tasks)).toBe(3);
  });

  it("leaves out a failure you dismissed", () => {
    const failed = task({ id: "f", status: "errored", attempts: 1 });
    expect(waitingOnYou([failed])).toBe(1);
    expect(waitingOnYou([failed], new Set([dismissalKey(failed)]))).toBe(0);
    // Retried and failed again: a new attempt, which waits on you again.
    expect(waitingOnYou([{ ...failed, attempts: 2 }], new Set([dismissalKey(failed)]))).toBe(1);
  });
});
