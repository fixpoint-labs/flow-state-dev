/**
 * The durable release of a lapsed wait slot (FIX-2082). The release at the
 * request's end runs in the request's own process; when that process is gone
 * (a crash), the filer's pass releases the slot once the request has stopped
 * running, so an ending held for it still reaches the filer once.
 *
 * - The lapse owes the filer's pass a wake, before it writes.
 * - The pass releases a slot whose request has ended (`RequestWaits.ended`),
 *   turning an ending it held into the filer's notice, and looks again later
 *   at one whose request still runs or is parked.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import { REQUEST_END_SEAM, type BlockContext, type ResourceCollectionRef } from "@flow-state-dev/core/types";
import { defineTaskCollection, getOrCreateTaskCollection, type TaskCollectionRef } from "../../src/tasks";
import { payBoardDebts } from "../../src";
import { deliverHeldEnding, lapsedSlotsHeldInProcess, releaseEndedWaits, waitOnTask } from "../../src/tasks/helpers/wait-on-task";
import { LAPSED_SLOT_CHECK_CAP_MS, LAPSED_SLOT_CHECK_MS } from "../../src/tasks/notice/task-notice";
import { createFakeResourceCollection } from "../helpers";

const SESSION = "s_1";
const DEADLINES = { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 };

type Owed = { entry: string; dueAt: number; sessionId?: string };

/** A request's context with the host verbs a wait and a pass read. `ended` answers for the waiting request. */
function hostCtx(owed: Owed[], ended: () => boolean, memo = new Map<string, unknown>(), requestId = "req_1"): BlockContext {
  return {
    // A request-end seam whose hooks never run: the request doesn't end in this process.
    [REQUEST_END_SEAM]: { add: () => undefined },
    emit: { component: () => undefined },
    _blockIdentity: { blockName: "getTask", blockInstanceId: "req_1:root/step[0]/tool[getTask][0%3Ac1]:0" },
    session: { identity: { type: "session", id: SESSION, userId: "alice" }, state: {}, stopRequest: async () => undefined },
    request: { identity: { type: "request", id: requestId } },
    requestHost: {
      resumeWait: async () => ({ ok: true }),
      hasWaitSweeper: true,
      waits: {
        deadlines: DEADLINES,
        depth: async () => 1,
        ended: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, ended()]))
      },
      wakes: {
        owe: async (wake: Owed) => {
          owed.push(wake);
        },
        read: async () => undefined,
        settle: async () => undefined,
        maxDebtAgeMs: 86_400_000
      }
    },
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    },
    suspend: async () => ({ answered: false, deadline: true })
  } as unknown as BlockContext;
}

async function boardFor(ctx: BlockContext): Promise<TaskCollectionRef> {
  const store = Object.assign(createFakeResourceCollection<JsonObject>("waits/**"), {
    config: defineTaskCollection({ id: "waits", scope: "user", delivery: {} })
  });
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "waits", collection: store as ResourceCollectionRef<JsonObject> });
}

const wait = { key: "req_1:root/step[0]/tool[getTask][0%3Ac1]", step: "req_1:root:0" };

const owedMarkers = (row: { metadata?: Record<string, unknown> }) =>
  Object.entries(row.metadata ?? {}).filter(([key, value]) => key.startsWith("noticeOwed:") && value !== null);

describe("a lapsed wait slot, released by the filer's pass", () => {
  it("the lapse owes the filer's pass a wake, about thirty seconds out", async () => {
    const owed: Owed[] = [];
    const ctx = hostCtx(owed, () => false);
    const board = await boardFor(ctx);
    const id = (await board.addTask({ goal: "slow work", assignee: "researcher" })).id;
    const before = Date.now();
    expect(await waitOnTask(ctx, board, id, wait)).toMatchObject({ ok: true, ended: false });
    expect(board.get(id)!.wait).toMatchObject({ lapsed: true, requestId: "req_1" });
    const wake = owed.find((w) => w.dueAt >= before + LAPSED_SLOT_CHECK_MS);
    expect(wake).toMatchObject({ entry: "onTaskSettled", sessionId: SESSION });
  });

  it("keeps the slot while its request runs, and releases it once the request has ended: the held ending is owed to the filer", async () => {
    let requestEnded = false;
    const owed: Owed[] = [];
    const ctx = hostCtx(owed, () => requestEnded);
    const board = await boardFor(ctx);
    const id = (await board.addTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(ctx, board, id, wait);
    // The task ends while the request still runs: held for it.
    await board.claim("researcher-worker");
    await board.complete(id, "done late");

    const now = Date.now();
    expect(await releaseEndedWaits(ctx, board, now)).toBe(now + LAPSED_SLOT_CHECK_MS);
    expect(board.get(id)!.wait).toMatchObject({ lapsed: true });
    // The pass looks again then.
    expect((await payBoardDebts(ctx, board, { now })).nextDue).toBeLessThanOrEqual(now + LAPSED_SLOT_CHECK_MS);

    // The process died; the request reads ended (interrupted). The next pass releases the slot.
    requestEnded = true;
    expect(await releaseEndedWaits(ctx, board, Date.now())).toBeUndefined();
    const row = board.get(id)!;
    expect(row.wait).toBeUndefined();
    expect(owedMarkers(row)).toHaveLength(1);
  });

  it("does nothing on a board with no lapsed slot, or on a host that can't say whether a request ended", async () => {
    const ctx = hostCtx([], () => true);
    const board = await boardFor(ctx);
    const id = (await board.addTask({ goal: "slow work", assignee: "researcher" })).id;
    expect(await releaseEndedWaits(ctx, board, Date.now())).toBeUndefined();
    await waitOnTask(ctx, board, id, wait);
    const blind = { ...ctx, requestHost: { ...ctx.requestHost, waits: { deadlines: DEADLINES, depth: async () => 1 } } } as unknown as BlockContext;
    expect(await releaseEndedWaits(blind, board, Date.now())).toBeUndefined();
    expect(board.get(id)!.wait).toMatchObject({ lapsed: true });
  });

  it("looks again less and less often while the request runs or is parked, and stops past the maximum age", async () => {
    const owed: Owed[] = [];
    const ctx = hostCtx(owed, () => false);
    const board = await boardFor(ctx);
    const id = (await board.addTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(ctx, board, id, wait);
    const lapsedAt = board.get(id)!.wait!.deadline;
    // The first looks come every thirty seconds; then the gap grows with the slot's age, up to an hour.
    expect(await releaseEndedWaits(ctx, board, lapsedAt + 1_000, 86_400_000)).toBe(lapsedAt + 1_000 + LAPSED_SLOT_CHECK_MS);
    expect(await releaseEndedWaits(ctx, board, lapsedAt + 300_000, 86_400_000)).toBe(lapsedAt + 600_000);
    expect(await releaseEndedWaits(ctx, board, lapsedAt + 5 * 3_600_000, 86_400_000)).toBe(
      lapsedAt + 5 * 3_600_000 + LAPSED_SLOT_CHECK_CAP_MS
    );
    // Ten days on, with the request still parked: past the maximum age, the pass owes nothing for it.
    const tenDays = lapsedAt + 10 * 86_400_000;
    expect(await releaseEndedWaits(ctx, board, tenDays, 86_400_000)).toBeUndefined();
    expect((await payBoardDebts(ctx, board, { now: tenDays })).nextDue).toBeUndefined();
    // The slot itself stays: the request's end, or a later pass that finds it ended, releases it.
    expect(board.get(id)!.wait).toMatchObject({ lapsed: true });
  });
});

describe("the slots this process holds to release at a request's end", () => {
  it("forgets a request once the pass released its last slot", async () => {
    let requestEnded = false;
    const ctx = hostCtx([], () => requestEnded, new Map(), "req_forget_pass");
    const board = await boardFor(ctx);
    const id = (await board.addTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(ctx, board, id, wait);
    expect(lapsedSlotsHeldInProcess().get("req_forget_pass")).toEqual(new Set([id]));
    requestEnded = true;
    await releaseEndedWaits(ctx, board, Date.now());
    expect(lapsedSlotsHeldInProcess().has("req_forget_pass")).toBe(false);
  });

  it("forgets a request once its read delivered its last held ending", async () => {
    const ctx = hostCtx([], () => false, new Map(), "req_forget_read");
    const board = await boardFor(ctx);
    const id = (await board.addTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(ctx, board, id, wait);
    await board.claim("researcher-worker");
    await board.complete(id, "done late");
    expect(lapsedSlotsHeldInProcess().get("req_forget_read")).toEqual(new Set([id]));
    await deliverHeldEnding(ctx, board, board.get(id)!);
    expect(lapsedSlotsHeldInProcess().has("req_forget_read")).toBe(false);
  });
});
