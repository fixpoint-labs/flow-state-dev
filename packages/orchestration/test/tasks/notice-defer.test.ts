/**
 * `taskSettledEntry`'s `defer` (FIX-2113), on the real engine: a notice its
 * session turns away runs nothing and stays owed, stamped with when it was
 * turned away (beside its marker), so its age (which ends it as undeliverable)
 * counts from then.
 * One it doesn't turn away runs and is acknowledged.
 *
 * And its take (FIX-2123): a notice whose block fails is taken over by the
 * next copy, and one whose taker hasn't ended, running or parked, never is.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { taskSettledEntry, type TaskSettledInput } from "../../src";
import { defineTaskCollection, getOrCreateTaskCollection, resolveResourceCollection, type TaskCollectionRef } from "../../src/tasks";

const BOARD = "defer-board";
const USER = "u_filer";
const SESSION = "s_filer";

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, BOARD)!;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

/** How the flow's block handles a notice, besides recording it, and on what host. */
interface HostOptions {
  /** Throw on the first notice, before recording it. */
  readonly failFirst?: boolean;
  /** After recording a notice: wait for this, holding the notice's request open. */
  readonly gate?: Promise<void>;
  /** After recording a notice: park its request on a person. */
  readonly park?: boolean;
  /** A durable host, which records which requests are running and which have ended. */
  readonly durable?: boolean;
}

function host(defer: () => boolean, options: HostOptions = {}) {
  const heard: TaskSettledInput[] = [];
  let failed = false;
  const seed = handler({
    name: "seed",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.any(),
    execute: async ({ id }, ctx) => {
      await (await boardOf(ctx)).addTask({ id, goal: "Find the fact" });
      return {};
    }
  });
  const owe = handler({
    name: "owe",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.any(),
    execute: async ({ id }, ctx) => {
      // The ending owes this session its notice, due now: written by a request that filed nothing.
      await (await boardOf(ctx)).patchMetadata(id, { "noticeOwed:1:completed": { attempt: 1, ending: "completed", due: Date.now() } });
      return {};
    }
  });
  const read = handler({
    name: "read",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.any(),
    execute: async ({ id }, ctx) => (await boardOf(ctx)).get(id)?.metadata ?? null
  });
  const flow = defineFlow({
    kind: "defer-host",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session", delivery: {} }) },
    actions: { seed: { block: seed }, owe: { block: owe }, read: { block: read } },
    internal: {
      actions: {
        onTaskSettled: taskSettledEntry({
          block: handler({
            name: "record-heard",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async (notice: TaskSettledInput, ctx) => {
              if (options.failFirst === true && !failed) {
                failed = true;
                throw new Error("the handling failed");
              }
              heard.push(notice);
              await options.gate;
              if (options.park === true) await ctx.suspend!({ reason: "human_approval", message: "Tell the customer?" });
              return {};
            }
          }),
          defer: async () => defer()
        })
      }
    }
  })({ id: "defer-host" });
  const state = createFlowState({
    flows: { "defer-host": flow },
    stores: { default: { primary: inMemoryStores() } },
    ...(options.durable === true ? { durable: true } : {})
  });
  const act = async (actionName: string, input: unknown, internal = false) => {
    // The router builds a durable host's request waits, which say what is running and what has ended.
    if (options.durable === true) await state.getRouter();
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
  /** File the task, then owe its notice from a request that filed nothing. */
  const owed = async (id: string) => {
    await act("seed", { id });
    await act("owe", { id });
  };
  return { heard, act, owed, dispose: () => state.dispose() };
}

const notice = { boardId: BOARD, taskId: "t1", attempt: 1, ending: "completed" as const, output: "fact" };

describe("a notice its session turns away (defer)", () => {
  it("runs nothing, stays owed, and records when it was turned away", async () => {
    const h = host(() => true);
    try {
      await h.owed("t1");
      const before = Date.now();
      await h.act("onTaskSettled", notice, true);
      expect(h.heard).toEqual([]);
      const metadata = (await h.act("read", { id: "t1" })) as Record<string, { at?: number } | null>;
      expect(metadata["noticeOwed:1:completed"]).toMatchObject({ attempt: 1, ending: "completed" });
      expect(metadata["noticeDeferred:1:completed"]!.at).toBeGreaterThanOrEqual(before);
    } finally {
      await h.dispose();
    }
  });

  it("runs and is acknowledged when it isn't turned away", async () => {
    const h = host(() => false);
    try {
      await h.owed("t1");
      await h.act("onTaskSettled", notice, true);
      expect(h.heard).toEqual([expect.objectContaining({ taskId: "t1", ending: "completed" })]);
      const metadata = (await h.act("read", { id: "t1" })) as Record<string, unknown>;
      expect(metadata["noticeOwed:1:completed"] ?? null).toBeNull();
    } finally {
      await h.dispose();
    }
  });
});

describe("a notice whose block fails (FIX-2123)", () => {
  it("stays owed, taken by the request that failed, and the next copy takes it over and is heard once", async () => {
    const h = host(() => false, { failFirst: true, durable: true });
    try {
      await h.owed("t1");
      await expect(h.act("onTaskSettled", notice, true)).rejects.toThrow(/execution_error/);
      expect(h.heard).toEqual([]);
      const failed = (await h.act("read", { id: "t1" })) as Record<string, { by?: string } | null>;
      expect(failed["noticeOwed:1:completed"]).toMatchObject({ attempt: 1, ending: "completed" });
      expect(failed["noticeTaken:1:completed"]?.by).toEqual(expect.any(String));

      // The filer's pass sends it again: the request that took it has ended, so this copy takes it over.
      await h.act("onTaskSettled", notice, true);
      expect(h.heard).toEqual([expect.objectContaining({ taskId: "t1", ending: "completed" })]);
      const metadata = (await h.act("read", { id: "t1" })) as Record<string, unknown>;
      expect(metadata["noticeOwed:1:completed"] ?? null).toBeNull();
      // A later copy finds it delivered.
      await h.act("onTaskSettled", notice, true);
      expect(h.heard).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});

describe("a notice taken by a request that hasn't ended (FIX-2123)", () => {
  it.each([
    ["still running its block", false],
    ["parked on a person in its block", true]
  ] as const)("is not taken over by a second copy while that request is %s: the block runs once", async (_name, park) => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const h = host(() => false, park ? { durable: true, park: true } : { durable: true, gate });
    try {
      await h.owed("t1");
      const first = h.act("onTaskSettled", notice, true).catch(() => undefined);
      if (park) await first;
      for (let i = 0; i < 300 && h.heard.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(h.heard).toHaveLength(1);

      // The filer's pass sends it again while the first copy is delivering it.
      const before = Date.now();
      expect(await h.act("onTaskSettled", notice, true)).toEqual({ owed: false });
      expect(h.heard).toHaveLength(1);
      const metadata = (await h.act("read", { id: "t1" })) as Record<string, { at?: number } | null>;
      // Still owed, and recorded as turned away, so it doesn't age out while it is delivered.
      expect(metadata["noticeOwed:1:completed"]).toMatchObject({ attempt: 1, ending: "completed" });
      expect(metadata["noticeDeferred:1:completed"]!.at).toBeGreaterThanOrEqual(before);

      open();
      await first;
      expect(h.heard).toHaveLength(1);
    } finally {
      open();
      await h.dispose();
    }
  });
});
