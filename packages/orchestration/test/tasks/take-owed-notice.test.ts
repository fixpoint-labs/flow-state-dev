/**
 * A running request takes an owed notice in its own name (FIX-2159):
 * `takeOwedNotice` goes through the take record `onTaskSettled` writes
 * (FIX-2123), so the copy `onTaskSettled` queued for after the request never
 * handles the notice twice and never loses it before its acknowledgement.
 *
 * On the real engine with a durable host:
 *
 *   1. a request that started BEFORE the ending sees it (the take reads the
 *      row committed: its own snapshot of the board does not show it);
 *   2. the request takes it, clears it, and the queued copy that runs after
 *      finds nothing owed: heard once, in the request;
 *   3. when the queued copy took it first, the request's take is refused:
 *      heard once, by the copy;
 *   4. when the request took it and failed before clearing it, the queued
 *      copy takes it over once the request has ended: heard once; and a
 *      request that failed after the clear drops it: at most once;
 *   5. a request that only READS the finished row leaves the notice owed, and
 *      the queued copy says it again: heard twice, which is why the take exists.
 *
 * The "turn" is a handler held open on a gate, standing in for a person's
 * turn between its answer and the answer again.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { takeOwedNotice, taskSettledEntry, type TaskSettledInput } from "../../src";
import {
  clearNotice,
  defineTaskCollection,
  getOrCreateTaskCollection,
  isNoticeOwed,
  resolveResourceCollection,
  type TaskCollectionRef
} from "../../src/tasks";

const BOARD = "conv-board";
const USER = "u_filer";
const SESSION = "s_main";
const NOTICE = { boardId: BOARD, taskId: "t1", attempt: 1, ending: "completed" as const, output: "the first result" };

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, BOARD)!;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

interface TurnLog {
  sawInSnapshot?: boolean;
  take?: "taken" | "refused";
}

function host(options: { turnFailsAt?: "before-ack" | "after-ack"; entryGate?: Promise<void>; readOnly?: boolean } = {}) {
  const heardInTurn: string[] = [];
  const heardByEntry: TaskSettledInput[] = [];
  const log: TurnLog = {};
  let release!: () => void;
  const turnGate = new Promise<void>((resolve) => (release = resolve));
  let turnStarted!: () => void;
  const started = new Promise<void>((resolve) => (turnStarted = resolve));

  const seed = handler({
    name: "seed",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      await (await boardOf(ctx)).createTask({ id: "t1", goal: "Find the fact" });
      return {};
    }
  });
  // The delegate's ending, written by another request: the row owes this session its notice.
  const end = handler({
    name: "end",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      await (await boardOf(ctx)).patchMetadata("t1", { "noticeOwed:1:completed": { attempt: 1, ending: "completed", due: Date.now() } });
      return {};
    }
  });
  const read = handler({
    name: "read",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, ctx) => (await boardOf(ctx)).get("t1")?.metadata ?? null
  });
  // The person's turn: it reads the board at its start, then waits (its answer), then takes.
  const turn = handler({
    name: "turn",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const ref = await boardOf(ctx);
      ref.get("t1");
      turnStarted();
      await turnGate;
      log.sawInSnapshot = isNoticeOwed(ref.get("t1")!, NOTICE);
      // A request without the take can only read the finished row.
      if (options.readOnly === true) {
        heardInTurn.push(String(NOTICE.output));
        return {};
      }
      const taken = await takeOwedNotice(ctx, NOTICE);
      log.take = taken === undefined ? "refused" : "taken";
      if (taken === undefined) return {};
      // The queued handling's order: acknowledge, then say the line (D1).
      if (options.turnFailsAt === "before-ack") throw new Error("the turn failed after its take, before its acknowledgement");
      await ref.patchMetadata("t1", clearNotice(NOTICE));
      if (options.turnFailsAt === "after-ack") throw new Error("the turn failed after its acknowledgement, before its line");
      heardInTurn.push(String(NOTICE.output));
      return {};
    }
  });

  const flow = defineFlow({
    kind: "take-host",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session", delivery: {} }) },
    actions: { seed: { block: seed }, end: { block: end }, read: { block: read }, respond: { block: turn } },
    internal: {
      actions: {
        onTaskSettled: taskSettledEntry({
          block: handler({
            name: "record-heard",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async (notice: TaskSettledInput) => {
              heardByEntry.push(notice);
              await options.entryGate;
              return {};
            }
          })
        })
      }
    }
  })({ id: "take-host" });
  const state = createFlowState({ flows: { "take-host": flow }, stores: { default: { primary: inMemoryStores() } }, durable: true });
  const act = async (actionName: string, input: unknown = {}, internal = false) => {
    await state.getRouter();
    const runtime = await state.getRuntime();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName,
      input,
      userId: USER,
      sessionId: SESSION,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
      ...(internal ? { source: "internal" } : {})
    } as never);
    if ((result as { error?: unknown }).error !== undefined) throw new Error(`${actionName}: ${JSON.stringify((result as { error?: unknown }).error)}`);
    return (result as { output?: unknown }).output;
  };
  return { act, heardInTurn, heardByEntry, log, release, started, dispose: () => state.dispose() };
}

describe("a running request takes an owed notice in its own name (FIX-2159)", () => {
  it("takes an ending its snapshot doesn't show, and the queued copy finds nothing owed", async () => {
    const h = host();
    try {
      await h.act("seed");
      const turn = h.act("respond");
      await h.started;
      await h.act("end");
      h.release();
      await turn;
      expect(h.log).toEqual({ sawInSnapshot: false, take: "taken" });
      // The queued onTaskSettled runs after the turn ends.
      expect(await h.act("onTaskSettled", NOTICE, true)).toEqual({ owed: false });
      expect(h.heardInTurn).toEqual(["the first result"]);
      expect(h.heardByEntry).toEqual([]);
      const metadata = (await h.act("read")) as Record<string, { by?: string } | null>;
      expect(metadata["noticeOwed:1:completed"] ?? null).toBeNull();
      // The take record stays as the durable "taken in request R" mark.
      expect(metadata["noticeTaken:1:completed"]?.by).toEqual(expect.any(String));
    } finally {
      await h.dispose();
    }
  });

  it("is refused when the queued copy took it first: heard once, by the copy", async () => {
    let open!: () => void;
    const entryGate = new Promise<void>((resolve) => (open = resolve));
    const h = host({ entryGate });
    try {
      await h.act("seed");
      const turn = h.act("respond");
      await h.started;
      await h.act("end");
      const copy = h.act("onTaskSettled", NOTICE, true);
      for (let i = 0; i < 300 && h.heardByEntry.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      h.release();
      await turn;
      expect(h.log.take).toBe("refused");
      open();
      await copy;
      expect(h.heardInTurn).toEqual([]);
      expect(h.heardByEntry).toHaveLength(1);
    } finally {
      open();
      await h.dispose();
    }
  });

  it("a request that took it and failed before clearing it: the copy takes it over, heard once", async () => {
    const h = host({ turnFailsAt: "before-ack" });
    try {
      await h.act("seed");
      const turn = h.act("respond").catch((error: Error) => error);
      await h.started;
      await h.act("end");
      h.release();
      expect(await turn).toBeInstanceOf(Error);
      expect(h.log.take).toBe("taken");
      await h.act("onTaskSettled", NOTICE, true);
      expect(h.heardInTurn).toEqual([]);
      expect(h.heardByEntry).toHaveLength(1);
      const metadata = (await h.act("read")) as Record<string, unknown>;
      expect(metadata["noticeOwed:1:completed"] ?? null).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it("a request that failed after clearing it, before its line: dropped, never twice (at most once)", async () => {
    const h = host({ turnFailsAt: "after-ack" });
    try {
      await h.act("seed");
      const turn = h.act("respond").catch((error: Error) => error);
      await h.started;
      await h.act("end");
      h.release();
      expect(await turn).toBeInstanceOf(Error);
      expect(await h.act("onTaskSettled", NOTICE, true)).toEqual({ owed: false });
      expect(h.heardInTurn).toEqual([]);
      expect(h.heardByEntry).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("a request that only reads the finished row, without the take: the queued copy says it again, heard twice", async () => {
    const h = host({ readOnly: true });
    try {
      await h.act("seed");
      const turn = h.act("respond");
      await h.started;
      await h.act("end");
      h.release();
      await turn;
      await h.act("onTaskSettled", NOTICE, true);
      expect(h.heardInTurn).toEqual(["the first result"]);
      expect(h.heardByEntry).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});
