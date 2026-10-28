/**
 * The durable release of a lapsed wait slot (FIX-2082). The release at the
 * request's end runs in the request's own process; when that process is gone
 * (a crash), the filer's pass releases the slot once the request has stopped
 * running, so an ending held for it still reaches the filer once.
 *
 * - The lapse owes the filer's pass a wake, before it writes.
 * - The pass releases a slot whose request has parked or ended
 *   (`requestStates`), turning an ending it held into the filer's notice, and
 *   looks again later at one whose request still runs.
 */
import { describe, expect, it, vi } from "vitest";
import { createRequestWaits } from "../../../engine/src/durability/wait-chain";
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
    const id = (await board.createTask({ goal: "slow work", assignee: "researcher" })).id;
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
    const id = (await board.createTask({ goal: "slow work", assignee: "researcher" })).id;
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
    const id = (await board.createTask({ goal: "slow work", assignee: "researcher" })).id;
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
    const id = (await board.createTask({ goal: "slow work", assignee: "researcher" })).id;
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

describe("a lapsed wait slot the pass can't read the request of", () => {
  // The engine answers a request it can't read as neither running nor ended,
  // which reads as parked: its slot is released, as a notice held for a
  // filing request it can't read is sent (FIX-2149). Matches the filing case
  // (FIX-2170).
  it("is released like a parked request's, as the filing case sends a notice held for a request it can't read, and nothing comes back every two seconds", async () => {
    const owed: Owed[] = [];
    const boardCtx = hostCtx(owed, () => false);
    const board = await boardFor(boardCtx);
    const bad = (await board.createTask({ goal: "a request whose gate can't be read", assignee: "researcher" })).id;
    const ok = (await board.createTask({ goal: "a request that ended", assignee: "researcher" })).id;
    await waitOnTask(hostCtx(owed, () => false, new Map(), "req_bad"), board, bad, wait);
    await waitOnTask(hostCtx(owed, () => false, new Map(), "req_ok"), board, ok, wait);

    // The engine's own answer, over a gate store that fails for one record.
    const records: Record<string, unknown> = {
      req_bad: { id: "req_bad", status: "interrupted", sessionId: SESSION, items: [{ type: "suspension", suspensionId: "g-bad" }] },
      req_ok: { id: "req_ok", status: "completed", sessionId: SESSION }
    };
    const waits = createRequestWaits({
      provider: {
        listSuspended: async () => [],
        loadSuspension: async () => {
          throw new Error("store unavailable");
        }
      },
      deadlines: DEADLINES,
      userId: "alice",
      requestId: "req_pass",
      own: undefined,
      sessionId: SESSION,
      readRequest: async (id) => records[id] as never
    });
    const pass = { ...boardCtx, requestHost: { ...boardCtx.requestHost, waits } } as unknown as BlockContext;

    const now = Date.now();
    const { nextDue } = await payBoardDebts(pass, board, { now });
    expect(board.get(ok)!.wait).toBeUndefined();
    expect(board.get(bad)!.wait).toBeUndefined();
    // Nothing is left to look at again: no check-in two seconds out, or at all.
    expect(nextDue).toBeUndefined();
  });
});

describe("a lapsed wait slot on a ledger two sessions share", () => {
  it("another session's pass never releases it: the engine answers that session's request as neither running nor ended, which isn't a park", async () => {
    const store = Object.assign(createFakeResourceCollection<JsonObject>("waits/**"), {
      config: defineTaskCollection({ id: "waits", scope: "user", delivery: {} })
    }) as unknown as ResourceCollectionRef<JsonObject>;
    const resolve = (ctx: BlockContext) => getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "waits", collection: store });

    // Session A's request lapses a wait on a task it filed, and still runs.
    const a = hostCtx([], () => false, new Map(), "req_a");
    const boardA = await resolve(a);
    const id = (await boardA.createTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(a, boardA, id, wait);
    await boardA.claim("researcher-worker");
    await boardA.complete(id, "done late");

    // Session B's pass, as the engine answers there: false and false for A's request.
    const base = hostCtx([], () => false, new Map(), "req_pass_b") as unknown as Record<string, any>;
    const no = async (ids: readonly string[]) => Object.fromEntries(ids.map((i) => [i, false]));
    const b = {
      ...base,
      session: { ...base.session, identity: { type: "session", id: "s_2", userId: "alice" } },
      requestHost: { ...base.requestHost, waits: { ...base.requestHost.waits, running: no, ended: no } }
    } as unknown as BlockContext;
    const boardB = await resolve(b);
    await releaseEndedWaits(b, boardB, Date.now());

    // Still held for A's running request: its next read gets the ending.
    expect(boardB.get(id)!.wait).toMatchObject({ lapsed: true, requestId: "req_a" });
    const markers = owedMarkers(boardB.get(id)!);
    expect(markers).toHaveLength(1);
    expect(markers[0]![1]).toMatchObject({ held: true });
  });
});

describe("the line the pass logs when it stops looking at a slot", () => {
  it("is logged once, by the pass that crosses the bound, with the reason", async () => {
    const ctx = hostCtx([], () => false, new Map(), "req_log");
    const board = await boardFor(ctx);
    const id = (await board.createTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(ctx, board, id, wait);
    const lapsedAt = board.get(id)!.wait!.deadline;
    const maxAge = 86_400_000;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await releaseEndedWaits(ctx, board, lapsedAt + maxAge + 1_000, maxAge);
      await releaseEndedWaits(ctx, board, lapsedAt + maxAge + 2 * LAPSED_SLOT_CHECK_CAP_MS, maxAge);
      await releaseEndedWaits(ctx, board, lapsedAt + 10 * maxAge, maxAge);
      const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("stops looking"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("its request still runs");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the slots this process holds to release at a request's end", () => {
  it("forgets a request once the pass released its last slot", async () => {
    let requestEnded = false;
    const ctx = hostCtx([], () => requestEnded, new Map(), "req_forget_pass");
    const board = await boardFor(ctx);
    const id = (await board.createTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(ctx, board, id, wait);
    expect(lapsedSlotsHeldInProcess().get("req_forget_pass")).toEqual(new Set([id]));
    requestEnded = true;
    await releaseEndedWaits(ctx, board, Date.now());
    expect(lapsedSlotsHeldInProcess().has("req_forget_pass")).toBe(false);
  });

  it("forgets a request once its read delivered its last held ending", async () => {
    const ctx = hostCtx([], () => false, new Map(), "req_forget_read");
    const board = await boardFor(ctx);
    const id = (await board.createTask({ goal: "slow work", assignee: "researcher" })).id;
    await waitOnTask(ctx, board, id, wait);
    await board.claim("researcher-worker");
    await board.complete(id, "done late");
    expect(lapsedSlotsHeldInProcess().get("req_forget_read")).toEqual(new Set([id]));
    await deliverHeldEnding(ctx, board, board.get(id)!);
    expect(lapsedSlotsHeldInProcess().has("req_forget_read")).toBe(false);
  });
});
