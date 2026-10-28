/**
 * Which chain a wait's depth counts (FIX-2082), on the real engine walk.
 *
 * - Inside a task's request, an inline plan step holds a claim on a plan row.
 *   That row is a step of the task, which adds no depth: a wait the step makes
 *   counts the chain above the task. Counted from the step's row instead, the
 *   chain above is lost and a sixth wait gets through.
 * - A wait that waits again at its deadline counts the chain again before
 *   each new park, since it may have grown between the two, and counts it
 *   once per park: a replay reads the same answer. A plan drain waiting again
 *   on a row it handed over is the exception: that wait already exists, so it
 *   never refuses on depth.
 */
import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createRequestWaits } from "../../../engine/src/durability/wait-chain";
import { defineTaskCollection, getOrCreateTaskCollection, type TaskCollectionRef } from "../../src/tasks";
import { waitOnTask } from "../../src/tasks/helpers/wait-on-task";
import { createFakeResourceCollection } from "../helpers";

// The request's own task and the inline step's claim, as the admission gate and the drain would set them.
const own = vi.hoisted(() => ({
  admitted: undefined as { taskId: string } | undefined,
  claim: undefined as { collectionId: string; taskId: string } | undefined
}));
vi.mock("../../src/task-board/task-request", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  admittedTaskOf: () => (own.admitted === undefined ? undefined : { ref: { collectionId: "waits" }, taskId: own.admitted.taskId })
}));
vi.mock("../../src/task-board/flow-policy-wiring", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  currentWorkerClaim: () => own.claim
}));

const SESSION = "s_1";
const DEADLINES = { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 };

async function board(): Promise<TaskCollectionRef> {
  const ctx = {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: SESSION, userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } }
  } as unknown as BlockContext;
  const store = Object.assign(createFakeResourceCollection<JsonObject>("waits/**"), {
    config: defineTaskCollection({ id: "waits", scope: "user", delivery: {} })
  });
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "waits", collection: store as ResourceCollectionRef<JsonObject> });
}

/** A parked wait gate, as the engine lists them: `requestId` waits on `taskId`, working `ownTask`. */
const gate = (requestId: string, taskId: string, ownTask?: string) => ({
  requestId,
  reason: "wait",
  status: "pending",
  suspensionId: `g-${requestId}`,
  userId: "alice",
  data: { board: "waits", taskId, deadline: 1, ...(ownTask !== undefined ? { own: { board: "waits", taskId: ownTask } } : {}) }
});

function turnCtx(memo: Map<string, unknown>, depth: RequestWaitsLike["depth"], suspend: () => Promise<unknown>): BlockContext {
  return {
    _blockIdentity: { blockName: "getTask", blockInstanceId: "req_1:root/step[0]/tool[getTask][0%3Ac1]:0" },
    session: { identity: { type: "session", id: SESSION, userId: "alice" }, state: {}, stopRequest: async () => undefined },
    request: { identity: { type: "request", id: "req_1" } },
    requestHost: { resumeWait: async () => ({ ok: true }), hasWaitSweeper: true, waits: { deadlines: DEADLINES, depth } },
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    },
    suspend
  } as unknown as BlockContext;
}
type RequestWaitsLike = { depth: (input: { binding?: unknown; own?: unknown }) => Promise<number> };

const KEY = "req_1:root/step[0]/tool[getTask][0%3Ac1]";

describe("a wait made inside an inline plan step of a task's request", () => {
  it("counts the chain above the task, so the sixth wait is refused", async () => {
    const ref = await board();
    const next = (await ref.addTask({ goal: "the sixth hop", assignee: "researcher" })).id;
    // Five waits above the task t1 this request works: a waits on t1, b on a's task, and so on up.
    const parked = [gate("a", "t1", "t0"), gate("b", "t0", "tm1"), gate("c", "tm1", "tm2"), gate("d", "tm2", "tm3"), gate("e", "tm3")];
    const waits = createRequestWaits({
      provider: { listSuspended: async () => parked as never, loadSuspension: async () => null },
      deadlines: DEADLINES,
      userId: "alice",
      requestId: "req_1",
      own: undefined,
      sessionId: SESSION,
      readRequest: async () => undefined
    });
    own.admitted = { taskId: "t1" };
    // The inline step's claim: a plan row, a step of t1.
    own.claim = { collectionId: "plan", taskId: "p1" };
    const result = await waitOnTask(
      turnCtx(new Map(), waits.depth, async () => {
        throw new Error("parked");
      }),
      ref,
      next,
      { key: KEY, step: "req_1:root:0" }
    );
    expect(result).toMatchObject({ ok: false, error: "wait_too_deep" });
    expect(ref.get(next)!.wait).toBeUndefined();
    own.admitted = undefined;
    own.claim = undefined;
  });
});

describe("a wait that waits again at its deadline", () => {
  it("counts the chain again before each new park, once per park, and is refused when it grew past five", async () => {
    const ref = await board();
    const id = (await ref.addTask({ goal: "the handed-over row", assignee: "researcher" })).id;
    const answers = [1, 6];
    const counted: number[] = [];
    const depth = async () => {
      counted.push(counted.length);
      return answers[counted.length - 1]!;
    };
    const atDeadline = async () => ({ answered: false, deadline: true });
    const memo = new Map<string, unknown>();
    const options = { key: "req_1:root/step[0]/tool[getTask][0%3Ac1]", waitAgain: true } as const;

    const result = await waitOnTask(turnCtx(memo, depth, atDeadline), ref, id, options);
    // The first park was counted at 1; the second, after the chain grew, at 6.
    expect(result).toMatchObject({ ok: false, error: "wait_too_deep" });
    expect(counted).toHaveLength(2);

    // The replay of the same wait reads both counts back: none is taken again.
    await waitOnTask(turnCtx(memo, depth, atDeadline), ref, id, options);
    expect(counted).toHaveLength(2);
  });

  it("a drain waiting again on a row it handed over never refuses on depth: the wait already exists", async () => {
    const ref = await board();
    const id = (await ref.addTask({ goal: "the handed-over row", assignee: "researcher" })).id;
    const counted: number[] = [];
    // Past five from the second park on, as if a lower wait slipped in between parks.
    const depth = async () => {
      counted.push(counted.length);
      return counted.length === 1 ? 1 : 6;
    };
    const outcomes = [{ answered: false, deadline: true }, { answered: false, deadline: true }, { answered: true, answer: "done" }];
    let parks = 0;
    const suspend = async () => outcomes[parks++]!;
    const options = { key: "fsd.plan.dispatch:b:t:1:wait", waitAgain: true, ownBoard: true } as const;

    const result = await waitOnTask(turnCtx(new Map(), depth, suspend), ref, id, options);
    expect(result).toMatchObject({ ok: true, task: { id } });
    // Three parks; only the first was counted.
    expect(parks).toBe(3);
    expect(counted).toHaveLength(1);
  });
});
