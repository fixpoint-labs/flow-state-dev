/**
 * `dispatchTask({ wait, timeoutMs })` as a model calls it (FIX-1816 P3,
 * V3 and V6 through the task tools, and the D1 check), moved from the filing tool by FIX-1875.
 *
 * The waiting turn is a generator holding the task tools capability over a
 * durable board, the shape a coordinator's turn has. "The colleague" is a
 * later request in the same conversation that claims and settles the row, and
 * the board touch is a request that calls `payOwedResumes`: in Workforce the
 * notice and the board run make that call (see Workforce's wait tests).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  createTaskToolsCapability,
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type TaskClaimTicket,
  type TaskCollectionRef
} from "../../src";
import { payOwedResumes } from "../../src/tasks/helpers/wait-for-response";
import { openWorkerClaimScope, stampCurrentClaim } from "../../src/task-board/flow-policy-wiring";
import { act, statusOf, stepModel, toolResults, until, type StepFn } from "./wait-fixture";
import { heard } from "../fixtures/heard";

const BOARD = "waits";

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

const roster = { has: (name: string) => name === "researcher", describe: () => "researcher" };

/** The waiting flow: `run` is a turn holding the task tools; `settle`, `touch` and `list` as in the wait fixture. */
function toolFlow(
  model: ReturnType<typeof stepModel>["model"],
  resumesWaits = true,
  taskTurnInstead?: string,
  claim?: TaskClaimTicket
): FlowInstance {
  // This flow's `touch` action is its waker, so the board resumes waits.
  const tools = createTaskToolsCapability(boardOf, roster, {
    resumesWaits,
    dispatches: true,
    ...(taskTurnInstead !== undefined ? { taskTurnInstead } : {})
  });
  const settle = handler({
    name: "settle",
    inputSchema: z.object({ output: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = (await boardOf(ctx))!;
      const claimed = await board.claim("researcher-worker");
      if (claimed === null) throw new Error("no waited-on row to claim");
      await board.complete(claimed.id, input.output);
      return claimed.id;
    }
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => payOwedResumes(ctx, (await boardOf(ctx))!)
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx))!.list().map((t) => ({ id: t.id, status: t.status, wait: t.wait, createdAt: t.createdAt }))
  });
  return defineFlow({ internal: { actions: { ...heard } },
    kind: "wait-board",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session" }) },
    actions: {
      run: {
        // With `claim`, the turn is a task turn: it stamps the claim in its own
        // request before the generator runs, as the receiving gate does.
        block: (claim === undefined
          ? sequencer({ name: "turn" })
          : sequencer({ name: "turn" }).tap((_input: unknown, ctx) => {
              openWorkerClaimScope();
              stampCurrentClaim(claim, ctx);
            })
        ).step(generator({ name: "agent", model, prompt: "p", uses: [tools] })),
        inputSchema: z.object({}).passthrough()
      },
      settle: { block: settle },
      touch: { block: touch },
      list: { block: list }
    }
  })({ id: "wait-board" });
}

type Host = { durable: boolean; router: boolean; sweepIntervalMs?: number };

async function host(flow: FlowInstance, options: Host) {
  const state = createFlowState({
    flows: { "wait-board": flow },
    stores: { default: { primary: inMemoryStores() } },
    durable: options.durable,
    ...(options.sweepIntervalMs !== undefined ? { durabilityRetention: { sweepIntervalMs: options.sweepIntervalMs } } : {})
  });
  if (options.router) await state.getRouter();
  return state;
}

type Row = { id: string; status: string; wait?: { gateId: string; deadline: number }; createdAt: number };
const listRows = async (state: Awaited<ReturnType<typeof host>>, flow: FlowInstance) =>
  (await act(state as never, flow, "list")).output as Row[];

const dispatchTaskCall =
  (id: string, args: Record<string, unknown>): StepFn =>
  () => ({ toolCalls: [{ toolCallId: id, toolName: "dispatchTask", args: { goal: "Is ACME's SOC 2 current?", ...args } }], finishReason: "tool-calls" });
const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

/** The dispatchTask tool's input fields, as the model was handed them on its first call. */
function dispatchTaskFields(seen: GeneratorModelCallOptions[]): string[] {
  const tool = seen[0]!.tools!.find((t) => t.name === "dispatchTask")!;
  return Object.keys((tool.parameters as z.AnyZodObject).shape).sort();
}

/** The claim a task turn's gate holds, stamped by `toolFlow`'s turn when given. */
const WORKED_CLAIM: TaskClaimTicket = { collectionId: "tasks", taskId: "task_worked", attempt: 1, createdAt: 1 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("where dispatchTask offers wait (BR-5, D1)", () => {
  /** `dispatchTask`'s fields where it can't wait: createTask's, and `taskId`. */
  const DISPATCH_BASE_FIELDS = [
    "assignee",
    "context",
    "deps",
    "followUpOf",
    "goal",
    "held",
    "input",
    "labels",
    "maxAttempts",
    "metadata",
    "priority",
    "resultTo",
    "session",
    "taskId",
    "title"
  ];

  for (const [label, options, offered] of [
    ["a durable host whose durability sweeper runs", { durable: true, router: true }, true],
    ["a durable host with no sweeper", { durable: true, router: false }, false],
    ["a host with no durable execution", { durable: false, router: true }, false]
  ] as const) {
    it(`${offered ? "offers" : "does not offer"} it on ${label}; the task tools are the same either way`, async () => {
      const { model, seen } = stepModel([finalAnswer]);
      const flow = toolFlow(model);
      const state = await host(flow, options);
      try {
        await act(state as never, flow, "run", {}, { sweeper: options.router });
        const names = seen[0]!.tools!.map((t) => t.name).sort();
        // D1: waiting adds no tool.
        expect(names).toEqual(["answerTask", "createTask", "dispatchTask", "getTask", "listTasks", "updateTask"]);
        const base = DISPATCH_BASE_FIELDS;
        expect(dispatchTaskFields(seen)).toEqual(offered ? [...base, "timeoutMs", "wait"].sort() : base);
      } finally {
        await state.dispose();
      }
    });
  }

  it("does not offer it on a board with no waker, even on a host that could hold the wait", async () => {
    const { model, seen } = stepModel([finalAnswer]);
    const flow = toolFlow(model, false);
    const state = await host(flow, { durable: true, router: true });
    try {
      await act(state as never, flow, "run");
      expect(dispatchTaskFields(seen)).toEqual(DISPATCH_BASE_FIELDS);
    } finally {
      await state.dispose();
    }
  });

  it("leaves a plain dispatchTask as it was: it files and returns at once (BR-6)", async () => {
    const { model, seen } = stepModel([dispatchTaskCall("c1", { assignee: "researcher" }), finalAnswer]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const run = await act(state as never, flow, "run");
      expect(await statusOf(state as never, run.requestId!)).toBe("completed");
      const [row] = await listRows(state, flow);
      expect(row).toMatchObject({ status: "pending" });
      expect(row!.wait).toBeUndefined();
      expect(toolResults(seen[1]!.messages)).toMatch(/"ok":true,"taskId":"task_[^"]+"}/);
    } finally {
      await state.dispose();
    }
  });
});

describe("dispatchTask waits for its answer (BR-1, BR-2)", () => {
  it("files one row marked waited-on, parks, and returns the row's output as answer once it completes", async () => {
    const { model, seen } = stepModel([dispatchTaskCall("c1", { assignee: "researcher", wait: true }), finalAnswer]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      const [row] = await listRows(state, flow);
      // The default bound: five minutes from filing (BR-14).
      expect(row!.wait!.deadline - row!.createdAt).toBeGreaterThanOrEqual(5 * 60_000 - 1_000);
      expect(row!.wait!.deadline - row!.createdAt).toBeLessThanOrEqual(5 * 60_000);

      await act(state as never, flow, "settle", { output: "Yes, renewed 2026-08" });
      await act(state as never, flow, "touch");
      await until(state as never, parked.requestId!, "completed");
      expect(toolResults(seen[1]!.messages)).toContain(`"ok":true,"taskId":"${row!.id}","answer":"Yes, renewed 2026-08"`);
      expect(await listRows(state, flow)).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

describe("listTasks marks a waited-on task", () => {
  it("shows the waited-on row with waitedOn: true, and a filed row without it", async () => {
    const listCall: StepFn = () => ({ toolCalls: [{ toolCallId: "l1", toolName: "listTasks", args: {} }], finishReason: "tool-calls" });
    // The first turn dispatches and waits; the second files a task without waiting, then lists the board.
    const { model, seen } = stepModel([
      dispatchTaskCall("c1", { assignee: "researcher", wait: true }),
      finalAnswer,
      dispatchTaskCall("c0", { assignee: "researcher" }),
      listCall,
      finalAnswer
    ]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const parked = await act(state as never, flow, "run");
      await act(state as never, flow, "settle", { output: "done" });
      await act(state as never, flow, "touch");
      await until(state as never, parked.requestId!, "completed");
      await act(state as never, flow, "run");
      const listed = JSON.parse(toolResults(seen[4]!.messages).split(" | ").pop()!).value.tasks as Array<Record<string, unknown>>;
      expect(listed).toHaveLength(2);
      expect(listed.filter((t) => t.waitedOn === true)).toHaveLength(1);
      expect(listed.filter((t) => !("waitedOn" in t))).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

describe("refused before anything is filed", () => {
  for (const [label, args, code] of [
    ["an assignee the roster doesn't name (BR-4)", { assignee: "nobody", wait: true }, "unknown_assignee"],
    ["timeoutMs under 30 s (BR-14a)", { assignee: "researcher", wait: true, timeoutMs: 29_999 }, "wait_timeout_out_of_range"],
    ["timeoutMs over an hour (BR-14a)", { assignee: "researcher", wait: true, timeoutMs: 3_600_001 }, "wait_timeout_out_of_range"],
    ["timeoutMs without wait", { assignee: "researcher", timeoutMs: 60_000 }, "wait_timeout_without_wait"]
  ] as const) {
    it(`${label}: ${code}, nothing filed, nothing parked`, async () => {
      const { model, seen } = stepModel([dispatchTaskCall("c1", args), finalAnswer]);
      const flow = toolFlow(model);
      const state = await host(flow, { durable: true, router: true });
      try {
        const run = await act(state as never, flow, "run");
        expect(await statusOf(state as never, run.requestId!)).toBe("completed");
        expect(toolResults(seen[1]!.messages)).toContain(`"error":"${code}`);
        expect(await listRows(state, flow)).toEqual([]);
      } finally {
        await state.dispose();
      }
    });
  }

  it("on a task turn: wait_unavailable, so a wait is never started from inside a wait (BR-5a)", async () => {
    const { model, seen } = stepModel([dispatchTaskCall("c1", { assignee: "researcher", wait: true }), finalAnswer]);
    const flow = toolFlow(model, true, undefined, WORKED_CLAIM);
    const state = await host(flow, { durable: true, router: true });
    try {
      const run = await act(state as never, flow, "run");
      expect(await statusOf(state as never, run.requestId!)).toBe("completed");
      expect(toolResults(seen[1]!.messages)).toContain('"error":"wait_unavailable');
      // A plain board's task turn completes its task when it returns, so
      // nothing wakes it: it is told only to hand the task over.
      expect(toolResults(seen[1]!.messages)).toContain("Hand the task over without waiting instead.");
      expect(await listRows(state, flow)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("on a task turn, with the layer's own way to wait: the refusal and the description say it", async () => {
    const instead = "File it without wait and end your turn; its ending wakes this task.";
    const { model, seen } = stepModel([dispatchTaskCall("c1", { assignee: "researcher", wait: true }), finalAnswer]);
    const flow = toolFlow(model, true, instead, WORKED_CLAIM);
    const state = await host(flow, { durable: true, router: true });
    try {
      await act(state as never, flow, "run");
      const refusal = toolResults(seen[1]!.messages);
      expect(refusal).toContain('"error":"wait_unavailable');
      expect(refusal).toContain(instead);
      expect(refusal).not.toContain("Hand the task over without waiting instead.");
      const dispatch = (seen[0]!.tools as Array<{ name?: string; description?: string }> | undefined)?.find((tool) => tool.name === "dispatchTask");
      expect(dispatch?.description).toContain(`so you can't wait: ${instead}`);
      expect(await listRows(state, flow)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});

describe("the bound: timeoutMs, honoured at the exact limits (BR-14, BR-14a)", () => {
  for (const timeoutMs of [30_000, 3_600_000]) {
    it(`files at ${timeoutMs}, with its deadline that far from filing, never clamped`, async () => {
      const { model } = stepModel([dispatchTaskCall("c1", { assignee: "researcher", wait: true, timeoutMs }), finalAnswer]);
      const flow = toolFlow(model);
      const state = await host(flow, { durable: true, router: true });
      try {
        const parked = await act(state as never, flow, "run");
        expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
        const [row] = await listRows(state, flow);
        expect(row!.wait!.deadline - row!.createdAt).toBeGreaterThanOrEqual(timeoutMs - 1_000);
        expect(row!.wait!.deadline - row!.createdAt).toBeLessThanOrEqual(timeoutMs);
      } finally {
        await state.dispose();
      }
    });
  }

  for (const [label, timeoutMs, before, after] of [
    ["a set timeoutMs", 30_000, 29_000, 31_000],
    ["the five-minute default", undefined, 4 * 60_000 + 50_000, 5 * 60_000 + 10_000]
  ] as const) {
    it(`a real sweep tick times the wait out at ${label}, not before, and cancels its row`, async () => {
      const args = { assignee: "researcher", wait: true, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
      const { model, seen } = stepModel([dispatchTaskCall("c1", args), finalAnswer]);
      const flow = toolFlow(model);
      const state = await host(flow, { durable: true, router: true, sweepIntervalMs: 25 });
      try {
        const parked = await act(state as never, flow, "run");
        expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
        const real = Date.now.bind(Date);
        const at = (offset: number) => vi.spyOn(Date, "now").mockImplementation(() => real() + offset);

        at(before);
        await new Promise((r) => setTimeout(r, 300)); // a dozen ticks
        expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");

        at(after);
        await until(state as never, parked.requestId!, "completed");
        expect(toolResults(seen[1]!.messages)).toContain('"error":"wait_timed_out');
        expect((await listRows(state, flow))[0]).toMatchObject({ status: "cancelled" });
      } finally {
        await state.dispose();
      }
    });
  }
});
