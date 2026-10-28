/**
 * A wait parked before the rename resumes after it, on SQLite.
 *
 * A turn's tool files a task for a colleague and waits on it through
 * `waitOnTask`, as `createTask` then `getTask({ wait: true })` do, and parks. The stored records are then put back the way the build before the
 * rename wrote them: the gate's reason `"ask"` and the row's mark under `ask`.
 * The runtime is thrown away, and a second one opens the same SQLite file.
 *
 * On the second runtime the public resume route still refuses the old gate,
 * the colleague ends the row, and the next touch of the board resumes the turn
 * with the answer. The replayed call finds its filing under the run-once keys
 * it was recorded under, so the board holds one row: the colleague's work runs
 * once.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type {
  BlockContext,
  FlowInstance,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult
} from "@flow-state-dev/core/types";
import { createFlowState, runAction, type FlowState } from "@flow-state-dev/engine";
import { payBoardDebts } from "@flow-state-dev/orchestration";
import { waitOnTask } from "@flow-state-dev/orchestration/task-board";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type TaskCollectionRef
} from "@flow-state-dev/orchestration/tasks";
import { sqliteStores } from "@flow-state-dev/store-sqlite";

const USER = "u_waiting";
const SESSION = "s_conversation";
const BOARD = "waits";
const KIND = "wait-upgrade";

type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

/** A scripted step model; `seen` spans both runtimes. */
function stepModel(script: StepFn[], seen: GeneratorModelCallOptions[]): GeneratorModel {
  return {
    modelId: "step-model",
    async generate() {
      throw new Error("legacy generate must not be called");
    },
    async generateStep(options) {
      seen.push(options);
      const entry = script[seen.length - 1];
      if (entry === undefined) throw new Error(`no script entry for step ${seen.length - 1}`);
      return entry(options);
    }
  };
}

function toolResults(messages: unknown[]): string {
  const out: string[] = [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push(JSON.stringify(part.output));
    }
  }
  return out.join(" | ");
}

const script: StepFn[] = [
  () => ({
    toolCalls: [{ toolCallId: "c1", toolName: "wait_on_colleague", args: { question: "Is ACME's SOC 2 current?" } }],
    finishReason: "tool-calls"
  }),
  (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" })
];

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) throw new Error("the board is not declared");
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

/**
 * `run` is the waiting turn; `settle` is the colleague ending the row; `touch`
 * touches the board; `list` reads it.
 */
function upgradeFlow(model: GeneratorModel): FlowInstance {
  const wait = handler({
    name: "wait_on_colleague",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await boardOf(ctx);
      // Filed once: the replay after the resume reads the filing back.
      const taskId = await ctx.runOnce!("fixture.file:c1", async () =>
        (await board.createTask({ goal: input.question, assignee: "researcher" })).id
      );
      const waited = await waitOnTask(ctx, board, taskId, { key: "fixture.wait:c1" });
      return waited.ok
        ? { taskId, status: waited.task.status, answer: waited.task.output }
        : { taskId, error: `${waited.error}: ${waited.message}` };
    }
  });
  const settle = handler({
    name: "settle",
    inputSchema: z.object({ output: z.unknown() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await boardOf(ctx);
      const claimed = await board.claim("researcher-worker");
      if (claimed === null) throw new Error("no row to claim");
      await board.complete(claimed.id, input.output);
      return board.get(claimed.id)?.status;
    }
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => payBoardDebts(ctx, await boardOf(ctx))
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx)).list().map((t) => ({ id: t.id, status: t.status, wait: t.wait, resumeOwed: t.resumeOwed ?? false }))
  });
  return defineFlow({
    kind: KIND,
    // Each row names the session that filed it, which alone may wait on it (FIX-2078, FIX-2082).
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session", delivery: {} }) },
    actions: {
      run: {
        block: sequencer({ name: "turn" }).step(generator({ name: "agent", model, prompt: "p", tools: [wait] })),
        inputSchema: z.object({}).passthrough()
      },
      settle: { block: settle },
      touch: { block: touch },
      list: { block: list }
    }
  })({ id: KIND });
}

let dir: string | undefined;
const live: FlowState[] = [];

afterEach(async () => {
  for (const state of live.splice(0)) await state.dispose();
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

function runtimeOn(filename: string, flow: FlowInstance): FlowState {
  const state = createFlowState({
    flows: { [KIND]: flow },
    stores: { default: { primary: sqliteStores({ filename }) } },
    durable: true
  });
  live.push(state);
  return state;
}

async function act(state: FlowState, flow: FlowInstance, actionName: string, input: unknown = {}) {
  // The router builds the durability sweeper, which a wait needs.
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
    runtimeConfig: runtime.runtimeConfig
  });
  if (result.error !== undefined) throw new Error(`${actionName} failed: ${JSON.stringify(result.error)}`);
  return result;
}

async function statusOf(state: FlowState, requestId: string): Promise<string | undefined> {
  return (await (await state.getRuntime()).stores.request.get(requestId))?.status;
}

async function until(state: FlowState, requestId: string, status: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const record = await (await state.getRuntime()).stores.request.get(requestId);
    if (record?.status === status && (status !== "completed" || record.finalizedAtMs != null)) return;
    if (Date.now() > deadline) throw new Error(`request is "${record?.status}", never "${status}"`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("a wait parked before the rename, across a SQLite restart", () => {
  it("resumes with the answer on the new build, files one row, and stays closed to the public route", async () => {
    dir = await mkdtemp(join(tmpdir(), "fsd-wait-upgrade-"));
    const filename = join(dir, "store.db");
    const seen: GeneratorModelCallOptions[] = [];

    // Before: the turn files its task and parks.
    const flowBefore = upgradeFlow(stepModel(script, seen));
    const before = runtimeOn(filename, flowBefore);
    const parked = await act(before, flowBefore, "run");
    const requestId = parked.requestId!;
    expect(await statusOf(before, requestId)).toBe("suspended");

    // Put the records back the way the build before the rename wrote them.
    const stores = (await before.getRuntime()).stores;
    const [gate] = await stores.suspensions.list({ sessionId: SESSION });
    expect(gate).toMatchObject({ reason: "wait", status: "pending" });
    await stores.suspensions.set({ ...gate!, reason: "ask" }); // retired-name-refusal: WR-9, the reason the build before the rename stored
    // The row is stored as written, not parsed, so it goes back as the old build wrote it.
    const key = `${BOARD}/${(gate!.data as { taskId: string }).taskId}`;
    const row = await stores.resourceState.get("session", SESSION, key);
    expect(row?.state).toHaveProperty("wait");
    const { wait, ...rest } = row!.state as Record<string, unknown>;
    await stores.resourceState.set("session", SESSION, key, { ...rest, ask: wait } as never, row!.version); // retired-name-refusal: WR-8, the shape the build before the rename stored
    const downgraded = (await stores.resourceState.get("session", SESSION, key))?.state as Record<string, unknown>;
    expect(downgraded).not.toHaveProperty("wait");
    expect(downgraded.ask).toMatchObject({ gateId: gate!.suspensionId }); // retired-name-refusal: WR-8, the downgraded row
    await before.dispose();
    live.splice(live.indexOf(before), 1);

    // After: a fresh runtime on the same file.
    const flowAfter = upgradeFlow(stepModel(script, seen));
    const after = runtimeOn(filename, flowAfter);
    const runtime = await after.getRuntime();
    expect((await runtime.stores.suspensions.get(requestId, gate!.suspensionId))?.reason).toBe("ask"); // retired-name-refusal: WR-9, still the old record

    // The old gate is a wait gate to the public route too: not found (WR-10).
    const router = await after.getRouter();
    const forged = await router.POST(
      new Request(`http://localhost/api/flows/${KIND}/requests/${requestId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: USER,
          suspensionId: gate!.suspensionId,
          action: "submit",
          data: { answered: true, answer: "forged" }
        })
      }),
      { params: { path: [KIND, "requests", requestId, "resume"] } }
    );
    expect(forged.status).toBe(404);
    expect((await runtime.stores.suspensions.get(requestId, gate!.suspensionId))?.status).toBe("pending");

    // The row reads as waited on, the colleague ends it, and a touch resumes the turn.
    expect((await act(after, flowAfter, "list")).output).toMatchObject([
      { status: "pending", wait: { gateId: gate!.suspensionId } }
    ]);
    await act(after, flowAfter, "settle", { output: "Yes, renewed 2026-08" });
    const touched = await act(after, flowAfter, "touch");
    // The pass's repairs resumed it: nothing is left outstanding but the settled row.
    expect(touched.error).toBeUndefined();
    await until(after, requestId, "completed");

    expect(seen).toHaveLength(2);
    expect(toolResults(seen[1]!.messages)).toContain("Yes, renewed 2026-08");
    const board = (await act(after, flowAfter, "list")).output as Array<Record<string, unknown>>;
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ status: "completed", resumeOwed: false });
  });
});
