/**
 * The one task-turn test (FIX-1816 BR-5a, FIX-1817 S1): a turn the receiving
 * gate serves, read from server-set state only, the claim the gate stamps and
 * the task session's own field, and nothing a caller hands in.
 */
import { describe, expect, it } from "vitest";
import { isTaskTurn, TASK_SESSION_TASK_KEY } from "../../src";
import { stampCurrentClaim } from "../../src/task-board/flow-policy-wiring";

const ctxWith = (state: Record<string, unknown> | undefined) => ({ session: { state } });

/** Run `fn` in an async scope of its own, so a stamped claim doesn't leak into the next test. */
const isolated = <T>(fn: () => T): Promise<T> =>
  new Promise((resolve) => setImmediate(() => resolve(fn())));

describe("isTaskTurn", () => {
  it("is a task turn inside the claim the gate stamps", async () => {
    const seen = await isolated(() => {
      stampCurrentClaim({ collectionId: "tasks", taskId: "t1", attempt: 1, createdAt: 1 });
      return isTaskTurn(ctxWith({}));
    });
    expect(seen).toBe(true);
  });

  it("is a task turn in a session a hand-over opened for a task, claim or not (a replay after a park)", async () => {
    expect(await isolated(() => isTaskTurn(ctxWith({ [TASK_SESSION_TASK_KEY]: "task_1" })))).toBe(true);
  });

  it("is not one in a conversation's own turn: no claim, no task named on the session", async () => {
    expect(await isolated(() => isTaskTurn(ctxWith({ workerId: "lead" })))).toBe(false);
    expect(await isolated(() => isTaskTurn(ctxWith(undefined)))).toBe(false);
    expect(await isolated(() => isTaskTurn({}))).toBe(false);
  });

  it("is not fooled by a task id that isn't a string", async () => {
    expect(await isolated(() => isTaskTurn(ctxWith({ [TASK_SESSION_TASK_KEY]: 7 })))).toBe(false);
  });
});
