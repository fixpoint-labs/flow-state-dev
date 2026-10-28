/**
 * The rows that run in one session (FIX-2160): its tasks and their follow-ups.
 *
 * Why it matters: a message about a coding task is refused while any row in
 * the task's session is open, and a follow-up waiting to start has no run link
 * of its own yet. A reader that kept only rows linked to the session would let
 * a message resume the coding session the follow-up is about to resume.
 */
import { describe, expect, it } from "vitest";
import { rowsInSession, type Task, type TaskCollectionRef } from "../../src/tasks";

const row = (id: string, over: Partial<Task> = {}) => ({ id, status: "completed", ...over }) as Task;
const ledger = (rows: Task[]) => ({ list: () => rows }) as unknown as TaskCollectionRef;

describe("rowsInSession", () => {
  it("keeps a linked task and its follow-up waiting to start, and nothing else", () => {
    const rows = [
      row("root", { run: { sessionId: "s1" } as Task["run"] }),
      row("next", { status: "pending", followUpOf: "root" }),
      row("other", { run: { sessionId: "s2" } as Task["run"] }),
      row("loose", { status: "pending" }),
    ];

    expect(rowsInSession(ledger(rows), "s1").map((task) => task.id)).toEqual(["root", "next"]);
  });

  it("finds the chain from a follow-up that ran there, as well as from its root", () => {
    const rows = [
      row("root", { run: { sessionId: "s0" } as Task["run"] }),
      row("next", { followUpOf: "root", run: { sessionId: "s1" } as Task["run"] }),
    ];

    expect(rowsInSession(ledger(rows), "s1").map((task) => task.id)).toEqual(["root", "next"]);
  });

  it("is empty for a session no row ran in", () => {
    expect(rowsInSession(ledger([row("loose", { status: "pending" })]), "s1")).toEqual([]);
  });
});
