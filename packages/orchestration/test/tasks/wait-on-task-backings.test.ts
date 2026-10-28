/**
 * `waitOnTask` on the real collection backings (FIX-2082): every check refuses
 * before anything is written; the deadline lapses the slot and cancels
 * nothing, losing to an ending already written; a replay of the call parks on
 * the same gate; and a stopped wait whose cancel fails leaves the cancel owed
 * for the next touch (FIX-1844).
 *
 * The request's context is hand-built (a durable `runOnce` memo, as the request
 * store keeps it, and a `suspend` the test scripts); the board is a real
 * resource- or state-backed collection, so every write goes through the
 * backing's own transitions.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { defineTaskCollection, getOrCreateTaskCollection, type TaskCollectionRef } from "../../src/tasks";
import { payOwedResumes, waitOnTask } from "../../src/tasks/helpers/wait-on-task";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const SESSION = "s_1";

function boardCtx(): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: SESSION, userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } }
  } as unknown as BlockContext;
}

/** A declared ledger that delivers its endings, so each row names the session that filed it (FIX-2078). */
function declared(settings?: Parameters<typeof defineTaskCollection>[0]["settings"]) {
  return defineTaskCollection({ id: "waits", scope: "user", delivery: {}, ...(settings !== undefined ? { settings } : {}) });
}

const BACKINGS: Record<string, () => Promise<TaskCollectionRef>> = {
  resource: async () => {
    const store = Object.assign(createFakeResourceCollection<JsonObject>("waits/**"), { config: declared() });
    return getOrCreateTaskCollection({
      ctx: boardCtx(),
      backing: "resource",
      collectionId: "waits",
      collection: store as ResourceCollectionRef<JsonObject>
    });
  },
  // A board kept in state stamps no filer: the wait reads its ledger's own filer rule.
  state: async () => {
    const board = await getOrCreateTaskCollection({
      ctx: boardCtx(),
      backing: "state",
      state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
      collectionId: "waits"
    });
    return Object.assign(Object.create(Object.getPrototypeOf(board)), board, { filerOf: () => SESSION }) as TaskCollectionRef;
  }
};

/** What the scripted gate does when the call parks. */
type Park = "park" | { deadline: true } | { stopped: true } | { answered: true };

/**
 * A request's context for one generator tool call. `memo` is the request's
 * `runOnce` record and outlives a crash: share it across two calls to model
 * the replay of one call.
 */
function turnCtx(memo: Map<string, unknown>, park: Park, options: { depth?: number; session?: string } = {}): BlockContext {
  return {
    _blockIdentity: { blockName: "getTask", blockInstanceId: "req_1:root/step[0]/tool[getTask][0%3Ac1]:0" },
    session: { identity: { type: "session", id: options.session ?? SESSION, userId: "alice" }, state: {}, stopRequest: async () => undefined },
    request: { identity: { type: "request", id: "req_1" } },
    requestHost: {
      resumeWait: async () => ({ ok: true }),
      hasWaitSweeper: true,
      waits: {
        deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 },
        depth: async () => options.depth ?? 1
      }
    },
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    },
    suspend: async () => {
      if (park === "park") throw new Error("parked");
      return "answered" in park ? park : { answered: false, ...park };
    }
  } as unknown as BlockContext;
}

const KEY = "req_1:root/step[0]/tool[getTask][0%3Ac1]";
const wait = { key: KEY, step: "req_1:root:0" };

async function filed(board: TaskCollectionRef, extra: Record<string, unknown> = {}): Promise<string> {
  return (await board.addTask({ goal: "Is ACME's SOC 2 current?", assignee: "researcher", ...extra })).id;
}

for (const [backing, build] of Object.entries(BACKINGS)) {
  describe(`waitOnTask on the ${backing} backing`, () => {
    it("takes the slot, then parks on the gate it planned; a replay of the call parks on the same gate", async () => {
      const board = await build();
      const id = await filed(board);
      const memo = new Map<string, unknown>();
      await expect(waitOnTask(turnCtx(memo, "park"), board, id, wait)).rejects.toThrow("parked");
      const slot = board.get(id)!.wait!;
      expect(slot).toMatchObject({ requestId: "req_1" });
      expect(slot.gateId.startsWith(`ask:waits:${id}#`)).toBe(true);
      await expect(waitOnTask(turnCtx(memo, "park"), board, id, wait)).rejects.toThrow("parked");
      expect(board.get(id)!.wait).toEqual(slot);
    });

    it("at the deadline lapses the slot and returns the task still running, nothing cancelled", async () => {
      const board = await build();
      const id = await filed(board);
      const result = await waitOnTask(turnCtx(new Map(), { deadline: true }), board, id, wait);
      expect(result).toMatchObject({ ok: true, ended: false, task: { id, status: "pending" } });
      expect(board.get(id)).toMatchObject({ status: "pending", wait: { lapsed: true, requestId: "req_1" } });
    });

    it("at a deadline the ending already won, returns the ending and lapses nothing", async () => {
      const board = await build();
      const id = await filed(board);
      // The ending lands as the request parks; the deadline resumes it first.
      const racing = Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        lapseWait: async (...args: Parameters<NonNullable<TaskCollectionRef["lapseWait"]>>) => {
          await board.claim("researcher-worker");
          await board.complete(id, "just in time");
          return board.lapseWait!(...args);
        }
      }) as TaskCollectionRef;
      const result = await waitOnTask(turnCtx(new Map(), { deadline: true }), racing, id, wait);
      expect(result).toMatchObject({ ok: true, ended: true, task: { id, status: "completed", output: "just in time" } });
      // Its resume was the request's, which has it: nothing else is owed.
      expect(board.get(id)?.resumeOwed).toBeUndefined();
      expect(board.get(id)?.wait?.lapsed).toBeUndefined();
    });

    for (const [label, ctx, extra, error] of [
      ["past the depth limit", { depth: 6 }, {}, "wait_too_deep"],
      ["from a session that didn't file it", { session: "s_other" }, {}, "wait_not_filer"]
    ] as const) {
      it(`refuses a wait ${label}, ${error}, writing nothing`, async () => {
        const board = await build();
        const id = await filed(board, extra);
        const before = board.get(id)!.revision;
        const result = await waitOnTask(turnCtx(new Map(), "park", ctx), board, id, wait);
        expect(result).toMatchObject({ ok: false, error });
        expect(board.get(id)!.revision).toBe(before);
        expect(board.get(id)!.wait).toBeUndefined();
      });
    }

    describe("a stopped wait whose own cancel fails (FIX-1844)", () => {
      /** The board, with its first cancel failing as a store blip would. */
      function failingFirstCancel(source: TaskCollectionRef): TaskCollectionRef {
        let failed = false;
        return Object.assign(Object.create(Object.getPrototypeOf(source)), source, {
          cancel: async (...args: Parameters<TaskCollectionRef["cancel"]>) => {
            if (!failed) {
              failed = true;
              throw new Error("store unavailable");
            }
            return source.cancel(...args);
          }
        }) as TaskCollectionRef;
      }

      it("still ends the request, and the next touch cancels the row it left open", async () => {
        const board = await build();
        const blip = failingFirstCancel(board);
        const id = await filed(board);

        const result = await waitOnTask(turnCtx(new Map(), { stopped: true }), blip, id, wait);
        expect(result).toMatchObject({ ok: false, error: "wait_ended_the_request" });
        // Nobody waits on the row now, and its worker would keep at it: the cancel is owed, on the row.
        expect(board.get(id)).toMatchObject({ status: "pending", cancelOwed: true });

        const touched = await payOwedResumes(turnCtx(new Map(), "park"), blip);
        const row = board.get(id);
        expect(row).toMatchObject({ status: "cancelled" });
        // The wait is over, so its ending owes the request nothing, and the debt is paid.
        expect(row?.resumeOwed).toBeUndefined();
        expect(row?.cancelOwed).toBeUndefined();
        expect(touched).toEqual({ resumed: [], stillOwed: [] });
      });

      it("a row whose worker ends it before the touch pays the debt with that ending, and owes the request nothing", async () => {
        const board = await build();
        const id = await filed(board);
        await waitOnTask(turnCtx(new Map(), { stopped: true }), failingFirstCancel(board), id, wait);
        await board.claim("researcher-worker");
        await board.complete(id, "done anyway");
        const row = board.get(id);
        expect(row).toMatchObject({ status: "completed" });
        expect(row?.cancelOwed).toBeUndefined();
        expect(row?.resumeOwed).toBeUndefined();
      });

      it("a touch with no cancel owed leaves an open wait alone", async () => {
        const board = await build();
        const id = await filed(board);
        await expect(waitOnTask(turnCtx(new Map(), "park"), board, id, wait)).rejects.toThrow("parked");
        await payOwedResumes(turnCtx(new Map(), "park"), board);
        expect(board.get(id)).toMatchObject({ status: "pending" });
        expect(board.get(id)?.cancelOwed).toBeUndefined();
      });

      it("a board whose list ignores the filter still cancels only the rows owed a cancel", async () => {
        const board = await build();
        const id = await filed(board);
        await expect(waitOnTask(turnCtx(new Map(), "park"), board, id, wait)).rejects.toThrow("parked");
        const unfiltered = Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
          list: () => board.list()
        }) as TaskCollectionRef;
        await payOwedResumes(turnCtx(new Map(), "park"), unfiltered);
        expect(board.get(id)).toMatchObject({ status: "pending" });
      });
    });
  });
}

/**
 * A task whose result goes to the conversation is never waited on (FIX-2080,
 * T-32): the conversation hears its result, so a request parked on it would
 * race the conversation for it. Refused before anything is written.
 */
describe("waitOnTask on a conversation-result task (FIX-2080)", () => {
  it("refuses wait_on_conversation_result, writing nothing", async () => {
    const store = Object.assign(createFakeResourceCollection<JsonObject>("waits/**"), {
      config: declared({ resultTo: ["filer", "conversation"] })
    });
    const board = await getOrCreateTaskCollection({
      ctx: boardCtx(),
      backing: "resource",
      collectionId: "waits",
      collection: store as ResourceCollectionRef<JsonObject>
    });
    const id = await filed(board, { resultTo: "conversation" });
    const result = await waitOnTask(turnCtx(new Map(), "park"), board, id, wait);
    expect(result).toMatchObject({ ok: false, error: "wait_on_conversation_result" });
    expect(board.get(id)?.wait).toBeUndefined();
  });
});

describe("a row filed before FIX-2078 names no filer (BP-030)", () => {
  it("is refused wait_not_filer, read as filer unknown, never as a match", async () => {
    // A ledger that delivers nothing stamps no filer, as no row before FIX-2078 carried one.
    const store = Object.assign(createFakeResourceCollection<JsonObject>("waits/**"), {
      config: defineTaskCollection({ id: "waits", scope: "user" })
    });
    const board = await getOrCreateTaskCollection({
      ctx: boardCtx(),
      backing: "resource",
      collectionId: "waits",
      collection: store as ResourceCollectionRef<JsonObject>
    });
    const id = await filed(board);
    expect(board.get(id)?.filer).toBeUndefined();
    const result = await waitOnTask(turnCtx(new Map(), "park"), board, id, wait);
    expect(result).toMatchObject({ ok: false, error: "wait_not_filer" });
  });
});
