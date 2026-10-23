/**
 * The waiting flow the wait tests share (FIX-1816; a wait on a filed task
 * since FIX-2082): a generator turn whose tool files a task on the board, once
 * per call, and waits on it through `waitOnTask`, as `createTask` then
 * `getTask({ wait })` do; and the requests that stand in for the colleague and
 * for a touch of the board.
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
import { deliverHeldEnding, payOwedResumes, toolCallOf, waitOnTask } from "../../src/tasks/helpers/wait-on-task";
import { taskSettledEntry, type TaskSettledInput } from "../../src";

export const USER = "u_asker";
export const SESSION = "s_conversation";
export const BOARD = "waits";

export type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult | Promise<GeneratorModelResult>;

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

export const waitCall = (id: string, question = "Is ACME's SOC 2 current?", deadline?: number): StepFn => (_options) => ({
  toolCalls: [{ toolCallId: id, toolName: "wait_on_colleague", args: { question, ...(deadline !== undefined ? { deadline } : {}) } }],
  finishReason: "tool-calls"
});
export const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

/** A step that waits on a task already filed, by id, as `getTask({ id, wait: true })` does. */
export const waitAgain = (callId: string, id: () => string, deadline?: number): StepFn => (_options) => ({
  toolCalls: [{ toolCallId: callId, toolName: "wait_again", args: { id: id(), ...(deadline !== undefined ? { deadline } : {}) } }],
  finishReason: "tool-calls"
});

/** A step that reads a task without waiting, as a plain `getTask({ id })` does. */
export const readTask = (callId: string, id: () => string): StepFn => (_options) => ({
  toolCalls: [{ toolCallId: callId, toolName: "read_task", args: { id: id() } }],
  finishReason: "tool-calls"
});

/** The task id a wait call's result names, from the tool results the model was sent. */
export function waitedTaskId(seen: GeneratorModelCallOptions[], step: number): string {
  const match = /"taskId":"([^"]+)"/.exec(toolResults(seen[step]!.messages));
  if (match === null) throw new Error(`no task id in the results step ${step} was sent`);
  return match[1]!;
}

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) throw new Error("the board is not declared");
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

export type Settle =
  | { kind: "complete"; output: unknown }
  | { kind: "fail"; error: string }
  | { kind: "cancel"; reason?: string };

/**
 * The waiting flow. `run` is the waiting turn; `settle` stands in for the
 * colleague (claims the waited-on row and ends it); `touch` is a touch of the
 * board; `list` reads the board.
 */
export function waitFlow(
  model: GeneratorModel,
  options: {
    maxAttempts?: number;
    endsOnFiling?: unknown;
    failCancelOnce?: boolean;
    failClearOnce?: boolean;
    endsAfterMark?: unknown;
    /** Declare `onTaskSettled`, recording each notice it hears in `heard`: the filer's pass then runs on its own. */
    heard?: TaskSettledInput[];
    /** The board's scope: `session` (the default), or `user`, which every session of the user reaches. */
    scope?: "session" | "user";
  } = {}
): FlowInstance {
  let cancelFailed = false;
  let clearFailed = false;
  const waitBoard = async (ctx: BlockContext): Promise<TaskCollectionRef> => {
    const board = await boardOf(ctx);
    const settle = async (id: string, output: unknown) => {
      await board.claim("researcher-worker");
      await board.complete(id, output);
    };
    if (options.endsAfterMark !== undefined) {
      // The colleague finishes after the waiting call took the slot and before
      // its gate is written: the ending owes a resume nothing is parked for yet.
      return Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        markWait: async (...args: Parameters<NonNullable<TaskCollectionRef["markWait"]>>) => {
          const outcome = await board.markWait!(...args);
          await settle(args[0], options.endsAfterMark);
          return outcome;
        }
      }) as TaskCollectionRef;
    }
    if (options.failClearOnce === true) {
      // The waiting call's first clear of its row's marker fails, as a store blip would.
      return Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        clearResumeOwed: async (id: string) => {
          if (!clearFailed) {
            clearFailed = true;
            throw new Error("store unavailable");
          }
          return board.clearResumeOwed!(id);
        }
      }) as TaskCollectionRef;
    }
    if (options.failCancelOnce === true) {
      // The waiting call's first cancel of its row fails, as a store blip would.
      return Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
        cancel: async (...args: Parameters<TaskCollectionRef["cancel"]>) => {
          if (!cancelFailed) {
            cancelFailed = true;
            throw new Error("store unavailable");
          }
          return board.cancel(...args);
        }
      }) as TaskCollectionRef;
    }
    if (options.endsOnFiling === undefined) return board;
    // The colleague finishes between the filing and the wait.
    return Object.assign(Object.create(Object.getPrototypeOf(board)), board, {
      addTask: async (init: Parameters<TaskCollectionRef["addTask"]>[0]) => {
        const task = await board.addTask(init);
        await settle(task.id, options.endsOnFiling);
        return task;
      }
    }) as TaskCollectionRef;
  };
  const wait = handler({
    name: "wait_on_colleague",
    inputSchema: z.object({ question: z.string(), deadline: z.number().optional() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await waitBoard(ctx);
      const call = toolCallOf(ctx)!;
      // Filed once per call, as `createTask` files on a board that starts work.
      const taskId = await ctx.runOnce!(`fixture.file:${call.logicalId}`, async () => {
        const task = await board.addTask({
          goal: input.question,
          assignee: "researcher",
          ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {})
        });
        return task.id;
      });
      const waited = await waitOnTask(ctx, board, taskId, {
        key: call.logicalId,
        step: call.stepKey,
        ...(input.deadline !== undefined ? { deadlineMs: input.deadline } : {})
      });
      if (!waited.ok) return { ok: false, taskId, error: `${waited.error}: ${waited.message}` };
      const { status, output, error } = waited.task;
      return { ok: true, taskId, status, ...(output !== undefined ? { output } : {}), ...(error !== undefined ? { error } : {}) };
    }
  });
  /** The task as the tools return it. */
  const shown = (task: { id: string; status: string; output?: unknown; error?: string }) => ({
    ok: true,
    taskId: task.id,
    status: task.status,
    ...(task.output !== undefined ? { output: task.output } : {}),
    ...(task.error !== undefined ? { error: task.error } : {})
  });
  const waitAgainTool = handler({
    name: "wait_again",
    inputSchema: z.object({ id: z.string(), deadline: z.number().optional() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await boardOf(ctx);
      const call = toolCallOf(ctx)!;
      const waited = await waitOnTask(ctx, board, input.id, {
        key: call.logicalId,
        step: call.stepKey,
        ...(input.deadline !== undefined ? { deadlineMs: input.deadline } : {})
      });
      return waited.ok ? shown(waited.task) : { ok: false, taskId: input.id, error: `${waited.error}: ${waited.message}` };
    }
  });
  const readTaskTool = handler({
    name: "read_task",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await boardOf(ctx);
      await board.refresh?.(input.id);
      const task = board.get(input.id)!;
      await deliverHeldEnding(ctx, board, task);
      return shown(task);
    }
  });
  const settle = handler({
    name: "settle",
    inputSchema: z.object({ outcome: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await boardOf(ctx);
      const claimed = await board.claim("researcher-worker");
      if (claimed === null) throw new Error("no waited-on row to claim");
      const outcome = input.outcome as Settle;
      if (outcome.kind === "complete") await board.complete(claimed.id, outcome.output);
      else if (outcome.kind === "fail") await board.fail(claimed.id, outcome.error);
      else await board.cancel(claimed.id, outcome.reason ?? "cancelled by the colleague");
      return board.get(claimed.id)?.status;
    }
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => payOwedResumes(ctx, await boardOf(ctx))
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx)).list().map((t) => ({
        id: t.id,
        status: t.status,
        wait: t.wait,
        resumeOwed: t.resumeOwed ?? false,
        attempts: t.attempts,
        metadata: t.metadata
      }))
  });
  return defineFlow({
    kind: "wait-board",
    // Its rows' endings are delivered to their filer, and each row names it
    // (FIX-2078): only the session that filed a task may wait on it.
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: options.scope ?? "session", delivery: {} }) },
    actions: {
      run: {
        block: sequencer({ name: "turn" }).step(
          generator({ name: "agent", model, prompt: "p", tools: [wait, waitAgainTool, readTaskTool] })
        ),
        inputSchema: z.object({}).passthrough()
      },
      settle: { block: settle },
      touch: { block: touch },
      list: { block: list }
    },
    ...(options.heard !== undefined
      ? {
          internal: {
            actions: {
              onTaskSettled: taskSettledEntry({
                block: handler({
                  name: "record-heard",
                  inputSchema: z.any(),
                  outputSchema: z.any(),
                  execute: (notice: TaskSettledInput) => {
                    options.heard!.push(notice);
                    return {};
                  }
                })
              })
            }
          }
        }
      : {})
  })({ id: "wait-board" });
}

export function runtimeFor(
  flow: FlowInstance,
  primary: StoreAdapter = inMemoryStores(),
  durable = true,
  sweepIntervalMs?: number,
  waitDeadlines?: { defaultMs?: number; minMs?: number; maxMs?: number }
) {
  return createFlowState({
    flows: { "wait-board": flow },
    stores: { default: { primary } },
    durable,
    ...(sweepIntervalMs !== undefined ? { durabilityRetention: { sweepIntervalMs } } : {}),
    ...(waitDeadlines !== undefined ? { waitDeadlines } : {})
  });
}

export async function act(
  state: ReturnType<typeof runtimeFor>,
  flow: FlowInstance,
  actionName: string,
  input: unknown = {},
  options: { sweeper?: boolean; sessionId?: string } = {}
) {
  // The router builds the host's durability sweeper, which a wait needs: a
  // host with none can't bound one, and refuses it (BR-5).
  if (options.sweeper !== false) await state.getRouter();
  const runtime = await state.getRuntime();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName,
    input,
    userId: USER,
    sessionId: options.sessionId ?? SESSION,
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
  status: string,
  withinMs = 5_000
): Promise<void> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const record = await (await state.getRuntime()).stores.request.get(requestId);
    if (record?.status === status && (status !== "completed" || record.finalizedAtMs != null)) return;
    if (Date.now() > deadline) throw new Error(`request is "${record?.status}", never "${status}"`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export type Row = {
  id: string;
  status: string;
  wait?: { gateId: string; deadline: number; requestId?: string; lapsed?: true };
  resumeOwed: boolean;
  attempts: number;
  metadata?: Record<string, unknown>;
};
export async function rows(state: ReturnType<typeof runtimeFor>, flow: FlowInstance, sessionId?: string): Promise<Row[]> {
  return (await act(state, flow, "list", {}, sessionId !== undefined ? { sessionId } : {})).output as Row[];
}
