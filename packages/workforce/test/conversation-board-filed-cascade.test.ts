/**
 * The filed cascade's payment cancels only the work the ending owed for
 * (FIX-2080 D2). A retry's debt can be paid late, after a crash: by then the
 * next attempt may be running in the same session, or the task may have
 * completed, and the pieces that attempt filed carry the same parent. Only
 * the pieces filed by the time of the ending are the debt's.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { CASCADE_DUE_MS, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { FILED_MARKER, PIECE_OF } from "../src/conversation-board/board-entries";
import { filedCascadeOver } from "../src/conversation-board/cascade";

const ENDED_AT = 1_000;

/** A piece of `parent`, open, filed at `createdAt`. */
function piece(id: string, createdAt: number): Task {
  return { id, goal: id, status: "in_progress", attempts: 1, createdAt, updatedAt: createdAt, metadata: { [PIECE_OF]: "parent" } } as Task;
}

/** The parent row as a late payment finds it: `status`, with the debt its retry left. */
function parent(status: Task["status"], owed: Task["cascadeOwed"]): Task {
  return {
    id: "parent",
    goal: "parent",
    status,
    attempts: 2,
    createdAt: 0,
    updatedAt: 2_000,
    metadata: { [FILED_MARKER]: { session: "task-session", partition: "task-board" } },
    cascadeOwed: owed
  } as Task;
}

/** Pay the debt over a board holding `pieces`, and return the ids it cancelled. */
async function pay(row: Task, pieces: Task[]): Promise<string[]> {
  const cancelled: string[] = [];
  const board = {
    list: () => pieces,
    cancel: async (id: string) => {
      cancelled.push(id);
      return { outcome: "recorded" as const };
    }
  } as unknown as TaskCollectionRef;
  const cascade = filedCascadeOver(async () => board);
  expect(await cascade.pay({} as BlockContext, row)).toBe(true);
  return cancelled;
}

describe("a late payment of a filed cascade (FIX-2080 D2)", () => {
  const before = piece("first-attempt-piece", ENDED_AT - 100);
  const after = piece("second-attempt-piece", ENDED_AT + 500);
  const owed = { due: ENDED_AT + CASCADE_DUE_MS, endedAt: ENDED_AT };

  it("leaves the pieces of the retry that started before the debt was paid", async () => {
    expect(await pay(parent("in_progress", owed), [before, after])).toEqual(["first-attempt-piece"]);
  });

  it("leaves the pieces of an attempt that went on to complete", async () => {
    expect(await pay(parent("completed", owed), [before, after])).toEqual(["first-attempt-piece"]);
  });

  it("reads the ending's time off an older debt that recorded only its due time", async () => {
    expect(await pay(parent("in_progress", { due: ENDED_AT + CASCADE_DUE_MS }), [before, after])).toEqual(["first-attempt-piece"]);
  });
});
