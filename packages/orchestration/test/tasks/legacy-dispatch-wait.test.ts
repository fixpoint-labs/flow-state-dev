/**
 * A `dispatchTask({ wait })` call a request parked on before FIX-2082, replayed
 * after the upgrade (BP-030): the filing it recorded names the gate and the
 * deadline, the request reads the outcome recorded there, and answers in the
 * shape that call answered. Its old timeout cancels nothing any more: the slot
 * lapses, as any wait's does at its deadline. A new call, which recorded no
 * filing, is answered `undefined`, for its caller to refuse.
 */
import { describe, expect, it } from "vitest";
import type { WaitOutcome } from "@flow-state-dev/core/types";
import { createStateBackedTaskCollection, type Task, type TaskCollectionRef } from "../../src/tasks";
import { replayLegacyDispatchWait } from "../../src/tasks/helpers/wait-on-task";
import { createFakeSequencerState } from "../helpers";

const CALL = "req_1:root/step[0]/tool[dispatchTask][0%3Ac1]";

/** A board holding the row the call filed before the upgrade, its slot as that filing wrote it. */
async function legacyBoard(): Promise<TaskCollectionRef> {
  // A filing before FIX-2082 wrote the slot with the row: a gate and a deadline, no request.
  const row = { id: "t", goal: "g", assignee: "ops", status: "pending", attempts: 0, createdAt: 1, updatedAt: 1, wait: { gateId: "ask:tasks:t#n", deadline: 5_000 } };
  return createStateBackedTaskCollection({
    collectionId: "tasks",
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: { t: row } }),
    now: () => 1000
  });
}

/** A replay of the call: its recorded filing, and the outcome recorded on its gate. */
function replayCtx(recorded: unknown, outcome: WaitOutcome) {
  const memo = new Map<string, unknown>();
  return {
    _blockIdentity: { blockName: "dispatchTask", blockInstanceId: `${CALL}:0` },
    request: { identity: { id: "req_1" } },
    session: { identity: { id: "s1" }, stopRequest: async () => "stopped" as const },
    runOnce: async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (key === `fsd.ask.file:${CALL}`) return recorded as T;
      if (!memo.has(key)) memo.set(key, await fn());
      return memo.get(key) as T;
    },
    suspend: async () => outcome
  } as never;
}

const FILING = { taskId: "t", gateId: "ask:tasks:t#n", deadline: 5_000 };

describe("a dispatchTask({ wait }) parked before FIX-2082, replayed", () => {
  it("answers a completion as that call did: the task's output as answer", async () => {
    const tasks = await legacyBoard();
    const replayed = await replayLegacyDispatchWait(replayCtx(FILING, { answered: true, answer: "renewed" }), tasks);
    expect(replayed).toEqual({ ok: true, taskId: "t", answer: "renewed" });
  });

  it("answers its old timeout without cancelling anything: the task runs on, its slot lapsed", async () => {
    const tasks = await legacyBoard();
    const outcome: WaitOutcome = { answered: false, error: { code: "wait_timed_out", message: "timed out" } };
    const replayed = await replayLegacyDispatchWait(replayCtx(FILING, outcome), tasks);
    expect(replayed).toMatchObject({ ok: false, taskId: "t", error: expect.stringMatching(/^wait_timed_out: .*runs on/) });
    // Lapsed for the request that waited, so an ending is held for it, and released when it ends.
    expect(tasks.get("t") as Task).toMatchObject({ status: "pending", wait: { gateId: "ask:tasks:t#n", requestId: "req_1", lapsed: true } });
  });

  it("answers a failure with the error naming it", async () => {
    const tasks = await legacyBoard();
    const outcome: WaitOutcome = { answered: false, error: { code: "wait_task_failed", message: "unreachable" } };
    expect(await replayLegacyDispatchWait(replayCtx(FILING, outcome), tasks)).toEqual({
      ok: false,
      taskId: "t",
      error: "wait_task_failed: unreachable"
    });
  });

  it("answers undefined for a call that recorded no filing: a new call, refused by its caller", async () => {
    const tasks = await legacyBoard();
    expect(await replayLegacyDispatchWait(replayCtx(null, { answered: true, answer: "x" }), tasks)).toBeUndefined();
  });
});
