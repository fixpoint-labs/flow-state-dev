/**
 * `addTaskAndWait` on the real collection backings (FIX-1816): the ask is
 * filed once across a crash between its row's commit and the record of the
 * filing, and an ask whose row completed just before its timeout's cancel
 * answers with the row, not with a timeout.
 *
 * The turn's context is hand-built (a durable `runOnce` memo that keeps a
 * result only once its step resolves, as the request store does, and a
 * `suspend` the test scripts); the board is a real resource- or state-backed
 * collection, so every write goes through the backing's own transitions.
 */
import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { defineTaskCollection, getOrCreateTaskCollection, type TaskCollectionRef } from "../../src/tasks";
import { addTaskAndWait } from "../../src/tasks/helpers/wait-for-response";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

function boardCtx(): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } }
  } as unknown as BlockContext;
}

/** The boards' clock: real time, moved on by `lateBy` where a test needs the colleague to finish late. */
let lateBy = 0;
const boardClock = () => Date.now() + lateBy;

const BACKINGS: Record<string, () => Promise<TaskCollectionRef>> = {
  resource: async () => {
    const declared = defineTaskCollection({ id: "asks", scope: "user" });
    const store = Object.assign(createFakeResourceCollection<JsonObject>("asks/**"), { config: declared });
    return getOrCreateTaskCollection({
      ctx: boardCtx(),
      backing: "resource",
      collectionId: "asks",
      collection: store as ResourceCollectionRef<JsonObject>,
      now: boardClock
    });
  },
  state: async () =>
    getOrCreateTaskCollection({
      ctx: boardCtx(),
      backing: "state",
      state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
      collectionId: "asks",
      now: boardClock
    })
};

/** What the scripted gate does when the call parks. */
type Park = "park" | { timedOut: true };

/**
 * A turn's context for one generator tool call. `memo` is the request's
 * `runOnce` record and outlives a crash: share it across two calls to model
 * the replay of one call.
 */
function turnCtx(memo: Map<string, unknown>, park: Park): BlockContext {
  return {
    _blockIdentity: { blockName: "addTask", blockInstanceId: "req_1:root/step[0]/tool[addTask][0%3Ac1]:0" },
    session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
    request: { identity: { type: "request", id: "req_1" } },
    requestHost: { resumeAsk: async () => ({ ok: true }), hasAskSweeper: true },
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    },
    suspend: async () => {
      if (park === "park") throw new Error("parked");
      return { answered: false, error: { code: "wait_timed_out", message: "The ask timed out." } };
    }
  } as unknown as BlockContext;
}

const init = { goal: "Is ACME's SOC 2 current?", assignee: "researcher" };

/** The tool call's logical id, which a replay shares. */
const LOGICAL_ID = "req_1:root/step[0]/tool[addTask][0%3Ac1]";

for (const [backing, build] of Object.entries(BACKINGS)) {
  describe(`addTaskAndWait on the ${backing} backing`, () => {
    it("files one row when the process dies after the row's commit and before the filing is recorded", async () => {
      const board = await build();
      let died = false;
      // The first filing commits its row, then the process dies before the call goes on.
      const dying = Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        addTask: async (row: Parameters<TaskCollectionRef["addTask"]>[0]) => {
          const added = await board.addTask(row);
          if (!died) {
            died = true;
            throw new Error("the process died");
          }
          return added;
        }
      }) as TaskCollectionRef;
      const memo = new Map<string, unknown>();

      await expect(addTaskAndWait(turnCtx(memo, "park"), dying, init)).rejects.toThrow("the process died");
      // The replay of the same call, after the restart.
      await expect(addTaskAndWait(turnCtx(memo, "park"), dying, init)).rejects.toThrow("parked");

      expect(board.list()).toHaveLength(1);
    });

    it("a replay of an ask filed before the id step existed finds that filing, under its old key", async () => {
      const board = await build();
      const taskId = "task_legacy";
      const gateId = `ask:asks:${taskId}`;
      // What the earlier code recorded: the filing itself, under fsd.ask.file.
      await board.addTask({ ...init, id: taskId, ask: { gateId, deadline: Date.now() + 300_000 } });
      const memo = new Map<string, unknown>([
        [`fsd.ask.file:${LOGICAL_ID}`, { taskId, gateId, deadline: Date.now() + 300_000 }]
      ]);
      await expect(addTaskAndWait(turnCtx(memo, "park"), board, init)).rejects.toThrow("parked");
      expect(board.list().map((row) => row.id)).toEqual([taskId]);
    });

    it("a crash between the id step and the filing, then downtime past the bound, files with a fresh deadline", async () => {
      const board = await build();
      let failed = false;
      // The process dies before the row is written.
      const dying = Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        addTask: async (row: Parameters<TaskCollectionRef["addTask"]>[0]) => {
          if (!failed) {
            failed = true;
            throw new Error("the process died");
          }
          return board.addTask(row);
        }
      }) as TaskCollectionRef;
      const memo = new Map<string, unknown>();
      await expect(addTaskAndWait(turnCtx(memo, "park"), dying, init, { timeoutMs: 60_000 })).rejects.toThrow("the process died");
      // Down for ten minutes, longer than the ask's bound.
      const real = Date.now.bind(Date);
      vi.spyOn(Date, "now").mockImplementation(() => real() + 10 * 60_000);
      try {
        const restartedAt = Date.now();
        await expect(addTaskAndWait(turnCtx(memo, "park"), dying, init, { timeoutMs: 60_000 })).rejects.toThrow("parked");
        const [row] = board.list();
        expect(row!.ask!.deadline).toBeGreaterThanOrEqual(restartedAt + 60_000);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("an ask whose row completed just before its timeout's cancel answers with the row, not wait_timed_out", async () => {
      const board = await build();
      let reads = 0;
      // The row completes as soon as it is filed; the call's reads before the
      // cancel (the open check, and the cancel's own) still see it running.
      const racing = Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        addTask: async (row: Parameters<TaskCollectionRef["addTask"]>[0]) => {
          const added = await board.addTask(row);
          await board.claim("researcher-worker");
          await board.complete(added.id, "Yes, renewed 2026-08");
          return added;
        },
        get: (id: string) => {
          const row = board.get(id);
          reads += 1;
          return reads <= 2 && row !== undefined ? { ...row, status: "in_progress" } : row;
        }
      }) as TaskCollectionRef;

      const result = await addTaskAndWait(turnCtx(new Map(), { timedOut: true }), racing, init);
      expect(result).toMatchObject({ ok: true, answer: "Yes, renewed 2026-08" });
      expect(board.list()[0]).toMatchObject({ status: "completed" });
    });

    it("an ask whose row completed after its deadline, just before the timeout's cancel, stays wait_timed_out", async () => {
      const board = await build();
      let reads = 0;
      const racing = Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        addTask: async (row: Parameters<TaskCollectionRef["addTask"]>[0]) => {
          const added = await board.addTask(row);
          await board.claim("researcher-worker");
          // The colleague finishes ten minutes on, past the five-minute deadline.
          lateBy = 10 * 60_000;
          await board.complete(added.id, "too late");
          return added;
        },
        get: (id: string) => {
          const row = board.get(id);
          reads += 1;
          return reads <= 2 && row !== undefined ? { ...row, status: "in_progress" } : row;
        }
      }) as TaskCollectionRef;
      try {
        const result = await addTaskAndWait(turnCtx(new Map(), { timedOut: true }), racing, init);
        expect(result).toMatchObject({ ok: false, error: "wait_timed_out" });
      } finally {
        lateBy = 0;
      }
    });
  });
}
