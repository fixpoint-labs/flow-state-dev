/**
 * What else holds a task session's task open (FIX-2077, rule 6), as Workforce
 * answers it: its pieces on the session's own board.
 *
 * Why it matters: the answer decides when the filer hears "done". A piece the
 * rule misses settles the task while that piece still runs. A message to the
 * session holds nothing: it is conversation, answered after the task settles.
 */
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { describe, expect, it } from "vitest";
import { piecesHold } from "../src/conversation-board/task-admission";
import { PIECE_OF } from "../src/conversation-board/board-entries";

function row(id: string, patch: Partial<Task>): Task {
  return { id, goal: id, status: "pending", attempts: 0, createdAt: 1, updatedAt: 1, ...patch } as Task;
}

/** A board that lists its rows, filtering on `filedByTask` the way the real one does. */
function boardOf(rows: Task[]): TaskCollectionRef {
  return {
    list: (filter?: { filedByTask?: string }) =>
      rows.filter((task) => filter?.filedByTask === undefined || task.filedByTask === filter.filedByTask)
  } as unknown as TaskCollectionRef;
}

describe("what holds a task session's task", () => {
  it("a piece stamped only with the task it is for (a row stored before filedByTask) holds the task while it is open", () => {
    const done = row("p1", { status: "completed", metadata: { [PIECE_OF]: "t" } });
    const open = row("p2", { status: "in_progress", metadata: { [PIECE_OF]: "t" } });

    expect(piecesHold(boardOf([done, open]), "t")).toBe(true);
    expect(piecesHold(boardOf([done]), "t")).toBe(false);
    // Another task's piece holds nothing here.
    expect(piecesHold(boardOf([row("p3", { status: "in_progress", metadata: { [PIECE_OF]: "other" } })]), "t")).toBe(false);
  });
});
