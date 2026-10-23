/**
 * `taskSettledEntry`'s `defer` (FIX-2113), on the real engine: a notice its
 * session turns away runs nothing and stays owed, stamped with when it was
 * turned away (beside its marker), so its age (which ends it as undeliverable)
 * counts from then.
 * One it doesn't turn away runs and is acknowledged.
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

function host(defer: () => boolean, failFirst = false) {
  const heard: TaskSettledInput[] = [];
  let failed = false;
  const seed = handler({
    name: "seed",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.any(),
    execute: async ({ id }, ctx) => {
      const board = await boardOf(ctx);
      await board.addTask({ id, goal: "Find the fact" });
      // The ending owes this session its notice, due now.
      await board.patchMetadata(id, { "noticeOwed:1:completed": { attempt: 1, ending: "completed", due: Date.now() } });
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
    actions: { seed: { block: seed }, read: { block: read } },
    internal: {
      actions: {
        onTaskSettled: taskSettledEntry({
          block: handler({
            name: "record-heard",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: (notice: TaskSettledInput) => {
              if (failFirst && !failed) {
                failed = true;
                throw new Error("the handling failed");
              }
              heard.push(notice);
              return {};
            }
          }),
          defer: async () => defer()
        })
      }
    }
  })({ id: "defer-host" });
  const state = createFlowState({ flows: { "defer-host": flow }, stores: { default: { primary: inMemoryStores() } } });
  const act = async (actionName: string, input: unknown, internal = false) => {
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
  return { heard, act, dispose: () => state.dispose() };
}

const notice = { boardId: BOARD, taskId: "t1", attempt: 1, ending: "completed" as const, output: "fact" };

describe("a notice its session turns away (defer)", () => {
  it("runs nothing, stays owed, and records when it was turned away", async () => {
    const h = host(() => true);
    try {
      await h.act("seed", { id: "t1" });
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
      await h.act("seed", { id: "t1" });
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
    const h = host(() => false, true);
    try {
      // The request that filed the task sends its notice as it ends; that copy's block fails.
      await h.act("seed", { id: "t1" });
      const takenBy = async () =>
        ((await h.act("read", { id: "t1" })) as Record<string, { by?: string } | null>)["noticeTaken:1:completed"]?.by;
      for (let i = 0; i < 200 && (await takenBy()) === undefined; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(await takenBy()).toEqual(expect.any(String));
      expect(h.heard).toEqual([]);

      // The filer's pass sends it again: once the request that took it has ended, a copy takes it over.
      for (let i = 0; i < 200 && h.heard.length === 0; i += 1) {
        await h.act("onTaskSettled", notice, true);
        if (h.heard.length === 0) await new Promise((r) => setTimeout(r, 10));
      }
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
