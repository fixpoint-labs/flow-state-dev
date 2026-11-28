/**
 * One mapper from a stored board task to what a screen shows: workforce's
 * `boardTaskOf`, which the inbox view answers its tasks through and the task
 * screens read their rows through. Tasks and a task's route read an entry
 * the same way because there is only this one.
 */
import { describe, expect, it } from "vitest";
import { boardTaskOf } from "@flow-state-dev/workforce/browser";

const BOARD = "sess_lead.tasks";

const read = (stored: unknown) => boardTaskOf(BOARD, "sess_lead", "t_fallback", stored);

describe("a stored board task, as a screen reads it", () => {
  it("reads its goal as its title when it was filed with none", () => {
    expect(read({ id: "t1", goal: "Ship the release notes", status: "pending" }).title).toBe("Ship the release notes");
  });

  it("reads a run link with a non-number attempt as no run", () => {
    expect(read({ id: "t2", goal: "g", status: "in_progress", run: { sessionId: "s", requestId: "r", attempt: Number.NaN } }).run).toBeNull();
  });

  it("drops a hold that doesn't parse, keeps the stored status, and names a task with no id by its key", () => {
    const task = read({ goal: "g", status: "blocked", holds: [{ nonsense: true }] });
    expect([task.id, task.status, task.holds]).toEqual(["t_fallback", "blocked", []]);
  });
});
