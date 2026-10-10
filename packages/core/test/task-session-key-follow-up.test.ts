/**
 * A follow-up runs in the session of the task it follows, on every board
 * whose seat hands off `per-task` (FIX-1817): the per-task key is the task the
 * row follows up when its payload names one, so the follow-up adopts that
 * task's child session instead of minting an empty one.
 */
import { describe, expect, it } from "vitest";
import { taskSessionKeyFor, type TaskDispatchInput } from "../src/types/dispatch";

const envelope = (taskId: string, payload: Record<string, unknown>): TaskDispatchInput =>
  ({ boardId: "board", seat: "w", taskId, attempt: 1, createdAt: 1, payload }) as TaskDispatchInput;

describe("the per-task session key of a follow-up", () => {
  it("is the key of the task it follows", () => {
    const root = taskSessionKeyFor("b", "per-task", envelope("root", { taskId: "root" }), {} as never);
    const follow = taskSessionKeyFor("b", "per-task", envelope("root-f1", { taskId: "root-f1", followUpOf: "root" }), {} as never);
    expect(follow).toBe(root);
  });

  it("is the task's own for any other row", () => {
    const one = taskSessionKeyFor("b", "per-task", envelope("t1", { taskId: "t1" }), {} as never);
    const two = taskSessionKeyFor("b", "per-task", envelope("t2", { taskId: "t2" }), {} as never);
    expect(one).not.toBe(two);
  });
});
