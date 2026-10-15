/**
 * The one task-turn test (FIX-1816 BR-5a, FIX-1817 S1): a turn the receiving
 * gate serves, read from server-set state only, the claim the gate stamps and
 * the task session's own field, and nothing a caller hands in.
 */
import { describe, expect, it } from "vitest";
import { isTaskTurn, TASK_SESSION_TASK_KEY } from "../../src";
import { currentWorkerClaim, openWorkerClaimScope, stampCurrentClaim } from "../../src/task-board/flow-policy-wiring";

const ctxWith = (state: Record<string, unknown> | undefined) => ({ session: { state } });

/** Run `fn` in an async scope of its own, so a stamped claim doesn't leak into the next test. */
const isolated = <T>(fn: () => T): Promise<T> =>
  new Promise((resolve) => setImmediate(() => resolve(fn())));

describe("isTaskTurn", () => {
  it("is a task turn inside the claim the gate stamps", async () => {
    const seen = await isolated(() => {
      openWorkerClaimScope();
      const ctx = ctxWith({});
      stampCurrentClaim({ collectionId: "tasks", taskId: "t1", attempt: 1, createdAt: 1 }, ctx);
      return isTaskTurn(ctx);
    });
    expect(seen).toBe(true);
  });

  it("is not a task turn in another request the claimed turn started (a resume, a hand-off)", async () => {
    // The async chain runs on into requests the worker starts in-process; the
    // claim does not. A resumed coordinator turn or a handed-off agent turn
    // that read the worker's claim would refuse to wait, or park on a question.
    const inRequest = (id: string) => ({ session: { state: {} }, request: { identity: { id }, incarnation: "i1" } });
    const seen = await isolated(() => {
      openWorkerClaimScope();
      stampCurrentClaim({ collectionId: "tasks", taskId: "t1", attempt: 1, createdAt: 1 }, inRequest("r_worker"));
      return [isTaskTurn(inRequest("r_worker")), isTaskTurn(inRequest("r_started"))];
    });
    expect(seen).toEqual([true, false]);
  });

  it("is not a task turn under a claim its entry stamped as no task turn (a delegated post)", async () => {
    // A post's turn answers the person: it may wait on work it hands off and
    // has no filer to ask. Its claim still fences its task-tool writes.
    const ctx = { session: { state: {} }, request: { identity: { id: "r_post" }, incarnation: "i1" } };
    const seen = await isolated(() => {
      openWorkerClaimScope();
      stampCurrentClaim({ collectionId: "tasks", taskId: "post:1", attempt: 1, createdAt: 1 }, ctx, { taskTurn: false });
      return [isTaskTurn(ctx), currentWorkerClaim(ctx)?.taskId];
    });
    expect(seen).toEqual([false, "post:1"]);
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
