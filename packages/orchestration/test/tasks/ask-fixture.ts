/**
 * The asking flow the FIX-1816 board tests share: a generator turn whose tool
 * asks through `addTaskAndWait`, and the requests that stand in for the
 * colleague and for a touch of the board.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type {
  BlockContext,
  FlowInstance,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult
} from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction, type StoreAdapter } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type TaskCollectionRef
} from "../../src/tasks";
import { addTaskAndWait, resumeOwedAsks } from "../../src/tasks/helpers/wait-for-response";

export const USER = "u_asker";
export const SESSION = "s_conversation";
export const BOARD = "asks";

export type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

/** A scripted step model. `seen` spans every runtime that shares it. */
export function stepModel(script: StepFn[], seen: GeneratorModelCallOptions[] = []) {
  const model: GeneratorModel = {
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
  return { model, seen };
}

export function toolResults(messages: unknown[]): string {
  const out: string[] = [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push(JSON.stringify(part.output));
    }
  }
  return out.join(" | ");
}

export const askCall = (id: string, question = "Is ACME's SOC 2 current?"): StepFn => () => ({
  toolCalls: [{ toolCallId: id, toolName: "ask_colleague", args: { question } }],
  finishReason: "tool-calls"
});
export const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) throw new Error("the board is not declared");
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

export type Settle =
  | { kind: "complete"; output: unknown }
  | { kind: "fail"; error: string }
  | { kind: "cancel" };

/**
 * The asking flow. `run` is the asking turn; `settle` stands in for the
 * colleague (claims the asked row and ends it); `touch` is a touch of the
 * board; `list` reads the board.
 */
export function askFlow(
  model: GeneratorModel,
  options: { maxAttempts?: number; endsOnFiling?: unknown } = {}
): FlowInstance {
  const askBoard = async (ctx: BlockContext): Promise<TaskCollectionRef> => {
    const board = await boardOf(ctx);
    if (options.endsOnFiling === undefined) return board;
    // The colleague finishes between the filing and the park.
    return Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
      addTask: async (init: Parameters<TaskCollectionRef["addTask"]>[0]) => {
        const task = await board.addTask(init);
        await board.claim("researcher-worker");
        await board.complete(task.id, options.endsOnFiling);
        return task;
      }
    }) as TaskCollectionRef;
  };
  const ask = handler({
    name: "ask_colleague",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.any(),
    execute: async (input, ctx) =>
      addTaskAndWait(ctx, await askBoard(ctx), {
        goal: input.question,
        assignee: "researcher",
        ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {})
      })
  });
  const settle = handler({
    name: "settle",
    inputSchema: z.object({ outcome: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await boardOf(ctx);
      const claimed = await board.claim("researcher-worker");
      if (claimed === null) throw new Error("no asked row to claim");
      const outcome = input.outcome as Settle;
      if (outcome.kind === "complete") await board.complete(claimed.id, outcome.output);
      else if (outcome.kind === "fail") await board.fail(claimed.id, outcome.error);
      else await board.cancel(claimed.id, "cancelled by the colleague");
      return board.get(claimed.id)?.status;
    }
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => resumeOwedAsks(ctx, await boardOf(ctx))
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx)).list().map((t) => ({
        id: t.id,
        status: t.status,
        ask: t.ask,
        resumeOwed: t.resumeOwed ?? false,
        attempts: t.attempts
      }))
  });
  return defineFlow({
    kind: "ask-board",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session" }) },
    actions: {
      run: {
        block: sequencer({ name: "turn" }).step(
          generator({ name: "agent", model, prompt: "p", tools: [ask] })
        ),
        inputSchema: z.object({}).passthrough()
      },
      settle: { block: settle },
      touch: { block: touch },
      list: { block: list }
    }
  })({ id: "ask-board" });
}

export function runtimeFor(
  flow: FlowInstance,
  primary: StoreAdapter = inMemoryStores(),
  durable = true,
  sweepIntervalMs?: number
) {
  return createFlowState({
    flows: { "ask-board": flow },
    stores: { default: { primary } },
    durable,
    ...(sweepIntervalMs !== undefined ? { durabilityRetention: { sweepIntervalMs } } : {})
  });
}

export async function act(
  state: ReturnType<typeof runtimeFor>,
  flow: FlowInstance,
  actionName: string,
  input: unknown = {}
) {
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

export async function statusOf(state: ReturnType<typeof runtimeFor>, requestId: string) {
  return (await (await state.getRuntime()).stores.request.get(requestId))?.status;
}

export async function until(
  state: ReturnType<typeof runtimeFor>,
  requestId: string,
  status: string
): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const record = await (await state.getRuntime()).stores.request.get(requestId);
    if (record?.status === status && (status !== "completed" || record.finalizedAtMs != null)) return;
    if (Date.now() > deadline) throw new Error(`request is "${record?.status}", never "${status}"`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export type Row = { id: string; status: string; ask?: { gateId: string; deadline: number }; resumeOwed: boolean; attempts: number };
export async function rows(state: ReturnType<typeof runtimeFor>, flow: FlowInstance): Promise<Row[]> {
  return (await act(state, flow, "list")).output as Row[];
}

