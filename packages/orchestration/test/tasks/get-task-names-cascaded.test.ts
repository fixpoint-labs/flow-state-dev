/**
 * A filer that hears a failure through its own `getTask` hears the dependents
 * that failure cancelled, once (FIX-2138).
 *
 * A dependent cancelled by its dependency's failure owes no notice of its own
 * (FIX-2080 D2): the failure's notice names it. When `getTask` delivers the
 * failure instead of that notice, its answer names the dependents:
 *
 * - a wait that finds the task already failed, which drops the notice (FIX-2112);
 * - a wait parked on the task, which the failure resumes (no notice is owed);
 * - a read of a failure held for the request whose wait on it lapsed (FIX-2082).
 *
 * A `getTask` that doesn't deliver the failure names nothing: the notice does,
 * and a dependent is never named twice.
 *
 * Each runs on the in-memory stores and on SQLite.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type StoreAdapter } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";
import {
  createTaskToolsCapability,
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  taskSettledEntry,
  type TaskCollectionRef,
  type TaskSettledInput
} from "../../src";
import { payOwedResumes } from "../../src/tasks/helpers/wait-on-task";
import { act, statusOf, stepModel, toolResults, until, type StepFn } from "./wait-fixture";

const BOARD = "waits";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const STORES: ReadonlyArray<readonly [string, () => Promise<StoreAdapter>]> = [
  ["in-memory", async () => inMemoryStores()],
  [
    "sqlite",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "fsd-get-task-cascade-"));
      dirs.push(dir);
      return sqliteStores({ filename: join(dir, "store.db") });
    }
  ]
];

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

const roster = { has: (name: string) => name === "researcher", describe: () => "researcher" };

/** Claim the research (its dependent waits on it, so it is the one claimable row) and fail it for good. */
async function failResearch(ctx: BlockContext): Promise<string> {
  const board = (await boardOf(ctx))!;
  const claimed = await board.claim("researcher-worker");
  if (claimed === null) throw new Error("nothing to claim");
  await board.fail(claimed.id, "the research service is down");
  return claimed.id;
}

/**
 * A turn holding the task tools, plus `fail_research` (the colleague failing
 * the research while the turn runs); `fail` does the same as its own request,
 * `touch` resumes waits, and `onTaskSettled` records each notice in `heard`.
 *
 * With `worker`: the board is user-scoped, the turn's `pause` tool awaits the
 * test's `pauses[n]`, and `failClaimed` is a worker's run in a session of its
 * own: it reads the board and claims the research, then awaits `worker.wait`
 * before failing it, so a dependent filed meanwhile is one its view never held.
 */
function toolFlow(
  model: ReturnType<typeof stepModel>["model"],
  heard: TaskSettledInput[],
  worker?: { pauses: Array<() => Promise<void>>; claimed: () => void; wait: Promise<void> }
): FlowInstance {
  const tools = createTaskToolsCapability(boardOf, roster, { resumesWaits: true, dispatches: true });
  const failTool = handler({
    name: "fail_research",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => ({ failed: await failResearch(ctx as unknown as BlockContext) })
  });
  const pauseTool = handler({
    name: "pause",
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.any(),
    execute: async (input) => {
      await worker!.pauses[input.n]!();
      return { ok: true };
    }
  });
  return defineFlow({
    kind: "wait-board",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: worker === undefined ? "session" : "user", delivery: {} }) },
    actions: {
      run: {
        block: sequencer({ name: "turn" }).step(
          generator({ name: "agent", model, prompt: "p", uses: [tools], tools: worker === undefined ? [failTool] : [failTool, pauseTool] })
        ),
        inputSchema: z.object({}).passthrough()
      },
      fail: {
        block: handler({ name: "fail", inputSchema: z.object({}).passthrough(), outputSchema: z.any(), execute: (_i, ctx) => failResearch(ctx as unknown as BlockContext) })
      },
      failClaimed: {
        block: handler({
          name: "fail-claimed",
          inputSchema: z.object({}).passthrough(),
          outputSchema: z.any(),
          execute: async (_input, ctx) => {
            const board = (await boardOf(ctx as unknown as BlockContext))!;
            const claimed = await board.claim("researcher-worker");
            if (claimed === null) throw new Error("nothing to claim");
            worker!.claimed();
            await worker!.wait;
            await board.fail(claimed.id, "the research service is down");
            return claimed.id;
          }
        })
      },
      touch: {
        block: handler({
          name: "touch",
          inputSchema: z.object({}).passthrough(),
          outputSchema: z.any(),
          execute: async (_input, ctx) => payOwedResumes(ctx as unknown as BlockContext, (await boardOf(ctx as unknown as BlockContext))!)
        })
      },
      list: {
        block: handler({
          name: "list",
          inputSchema: z.object({}).passthrough(),
          outputSchema: z.any(),
          execute: async (_input, ctx) =>
            (await boardOf(ctx as unknown as BlockContext))!.list().map((t) => ({ id: t.id, status: t.status, causedBy: t.causedBy }))
        })
      }
    },
    internal: {
      actions: {
        onTaskSettled: taskSettledEntry({
          block: handler({
            name: "record-heard",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async (notice: TaskSettledInput) => {
              heard.push(notice);
              return {};
            }
          })
        })
      }
    }
  })({ id: "wait-board" });
}

const call =
  (toolCallId: string, toolName: string, args: () => Record<string, unknown>): StepFn =>
  () => ({ toolCalls: [{ toolCallId, toolName, args: args() }], finishReason: "tool-calls" });
const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

/** The ids `createTask` answered with, in order, from the results the model was sent on `step`. */
function filedIds(seen: GeneratorModelCallOptions[], step: number): string[] {
  return [...toolResults(seen[step]!.messages).matchAll(/"taskId":"([^"]+)"/g)].map((m) => m[1]!);
}

/** The research, then its dependent. */
const fileBoth = (seen: GeneratorModelCallOptions[]): StepFn[] => [
  call("c1", "createTask", () => ({ goal: "Find the key fact", assignee: "researcher" })),
  call("c2", "createTask", () => ({ goal: "Write the post", assignee: "researcher", deps: [filedIds(seen, 1)[0]] }))
];

/** The `getTask` answer the model was sent last on `step`. */
function lastAnswer(seen: GeneratorModelCallOptions[], step: number): Record<string, unknown> {
  const results = toolResults(seen[step]!.messages).split(" | ");
  const raw = JSON.parse(results[results.length - 1]!) as { value?: unknown };
  return (raw.value ?? raw) as Record<string, unknown>;
}

/** Past a notice's due time, so a notice owed would have been sent and heard. */
const pastNoticeDue = () => new Promise((r) => setTimeout(r, 2_600));

describe.each(STORES)("getTask names the dependents a failure it delivers cancelled (%s)", { timeout: 30_000 }, (_name, stores) => {
  async function host(flow: FlowInstance, waitDeadlines?: { minMs: number }) {
    const state = createFlowState({
      flows: { "wait-board": flow },
      stores: { default: { primary: await stores() } },
      durable: true,
      ...(waitDeadlines !== undefined ? { durabilityRetention: { sweepIntervalMs: 25 }, waitDeadlines } : {})
    });
    await state.getRouter();
    return state;
  }

  it("a wait that finds the task already failed: the answer names the dependent, and no notice is heard", async () => {
    const heard: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    const { model } = stepModel(
      [
        ...fileBoth(seen),
        call("f1", "fail_research", () => ({})),
        call("g1", "getTask", () => ({ id: filedIds(seen, 1)[0]!, wait: true })),
        finalAnswer
      ],
      seen
    );
    const flow = toolFlow(model, heard);
    const state = await host(flow);
    try {
      const run = await act(state as never, flow, "run");
      await until(state as never, run.requestId!, "completed");
      const [research, dependent] = filedIds(seen, 2);
      expect(lastAnswer(seen, 4)).toMatchObject({ ok: true, task: { id: research, status: "errored" }, cancelled: [dependent] });
      await pastNoticeDue();
      expect(heard).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("a wait parked on the task, resumed by its failure: the answer names the dependent, and no notice is heard", async () => {
    const heard: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    const { model } = stepModel(
      [...fileBoth(seen), finalAnswer, call("g1", "getTask", () => ({ id: filedIds(seen, 1)[0]!, wait: true })), finalAnswer],
      seen
    );
    const flow = toolFlow(model, heard);
    const state = await host(flow);
    try {
      await act(state as never, flow, "run");
      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      await act(state as never, flow, "fail");
      await act(state as never, flow, "touch");
      await until(state as never, parked.requestId!, "completed");
      const [research, dependent] = filedIds(seen, 2);
      expect(lastAnswer(seen, 4)).toMatchObject({ ok: true, task: { id: research, status: "errored" }, cancelled: [dependent] });
      await pastNoticeDue();
      expect(heard).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it.each([
    ["a read", false],
    ["a second wait", true]
  ])("%s of a failure held for the request whose wait lapsed: the answer names the dependent, and no notice is heard", async (_how, again) => {
    const heard: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    const { model } = stepModel(
      [
        ...fileBoth(seen),
        // Lapses at its deadline with the research still running.
        call("g1", "getTask", () => ({ id: filedIds(seen, 1)[0]!, wait: true, deadline: 50 })),
        // The failure lands on the lapsed slot: held for this request.
        call("f1", "fail_research", () => ({})),
        call("g2", "getTask", () => ({ id: filedIds(seen, 1)[0]!, ...(again ? { wait: true } : {}) })),
        finalAnswer
      ],
      seen
    );
    const flow = toolFlow(model, heard);
    const state = await host(flow, { minMs: 10 });
    try {
      const run = await act(state as never, flow, "run");
      await until(state as never, run.requestId!, "completed", 10_000);
      const [research, dependent] = filedIds(seen, 2);
      expect(lastAnswer(seen, 3)).toMatchObject({ ok: true, task: { id: research, status: "pending" } });
      expect(lastAnswer(seen, 5)).toMatchObject({ ok: true, task: { id: research, status: "errored" }, cancelled: [dependent] });
      await pastNoticeDue();
      expect(heard).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("a second wait on the task in the same request names nothing: the first answer delivered the failure", async () => {
    const heard: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    const { model } = stepModel(
      [
        ...fileBoth(seen),
        finalAnswer,
        call("g1", "getTask", () => ({ id: filedIds(seen, 1)[0]!, wait: true })),
        // After the resume: the model waits on the failed task again.
        call("g2", "getTask", () => ({ id: filedIds(seen, 1)[0]!, wait: true })),
        finalAnswer
      ],
      seen
    );
    const flow = toolFlow(model, heard);
    const state = await host(flow);
    try {
      await act(state as never, flow, "run");
      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      await act(state as never, flow, "fail");
      await act(state as never, flow, "touch");
      await until(state as never, parked.requestId!, "completed");
      const [research, dependent] = filedIds(seen, 2);
      expect(lastAnswer(seen, 4)).toMatchObject({ ok: true, task: { id: research, status: "errored" }, cancelled: [dependent] });
      const again = lastAnswer(seen, 5);
      expect(again).toMatchObject({ ok: true, task: { id: research, status: "errored" } });
      expect(again.cancelled).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });

  it("names a dependent the failing worker's run never read: the touch before naming cancels it", async () => {
    // The worker's run claims the research before the turn files its
    // dependent, so that run's cascade can't cancel the dependent; the turn's
    // wait delivers the failure, and its touch does.
    const heard: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    let release!: () => void;
    let claimed!: () => void;
    let failed!: () => void;
    const claimedYet = new Promise<void>((resolve) => (claimed = resolve));
    const failedYet = new Promise<void>((resolve) => (failed = resolve));
    const wait = new Promise<void>((resolve) => (release = resolve));
    let failing: Promise<unknown> | undefined;
    const worker = {
      claimed: () => claimed(),
      wait,
      pauses: [
        // The worker's run reads the board and claims the research.
        async () => {
          failing = act(state as never, flow, "failClaimed", {}, { sessionId: "s_worker" });
          await claimedYet;
        },
        // The research fails, in the worker's run, while this turn still runs.
        async () => {
          release();
          await failing;
          failed();
        }
      ]
    };
    const { model } = stepModel(
      [
        call("c1", "createTask", () => ({ goal: "Find the key fact", assignee: "researcher" })),
        call("p0", "pause", () => ({ n: 0 })),
        call("c2", "createTask", () => ({ goal: "Write the post", assignee: "researcher", deps: [filedIds(seen, 1)[0]] })),
        call("p1", "pause", () => ({ n: 1 })),
        call("g1", "getTask", () => ({ id: filedIds(seen, 1)[0]!, wait: true })),
        finalAnswer
      ],
      seen
    );
    const flow = toolFlow(model, heard, worker);
    const state = await host(flow);
    try {
      const run = await act(state as never, flow, "run");
      await failedYet;
      await until(state as never, run.requestId!, "completed");
      const [research, dependent] = filedIds(seen, 3);
      expect(lastAnswer(seen, 5)).toMatchObject({ ok: true, task: { id: research, status: "errored" }, cancelled: [dependent] });
      await pastNoticeDue();
      expect(heard.filter((notice) => notice.taskId === research || notice.taskId === dependent)).toEqual([]);
    } finally {
      release();
      await state.dispose();
    }
  });

  it("a read that doesn't deliver the failure names nothing: the notice names the dependent, once", async () => {
    const heard: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    const { model } = stepModel(
      [...fileBoth(seen), finalAnswer, call("g1", "getTask", () => ({ id: filedIds(seen, 1)[0]! })), finalAnswer],
      seen
    );
    const flow = toolFlow(model, heard);
    const state = await host(flow);
    try {
      await act(state as never, flow, "run");
      await act(state as never, flow, "fail");
      await pastNoticeDue();
      const read = await act(state as never, flow, "run");
      await until(state as never, read.requestId!, "completed");
      const [research, dependent] = filedIds(seen, 2);
      expect(heard).toEqual([expect.objectContaining({ taskId: research, ending: "errored", cancelled: [dependent] })]);
      const answer = lastAnswer(seen, 4);
      expect(answer).toMatchObject({ ok: true, task: { id: research, status: "errored" } });
      expect(answer.cancelled).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });
});
