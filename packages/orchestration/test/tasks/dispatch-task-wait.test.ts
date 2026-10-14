/**
 * `dispatchTask({ wait, timeoutMs })` as a model calls it (FIX-1816 P3,
 * V3 and V6 through the task tools, and the D1 check), moved from `addTask` by FIX-1875.
 *
 * The waiting turn is a generator holding the task tools capability over a
 * durable board, the shape a coordinator's turn has. "The colleague" is a
 * later request in the same conversation that claims and settles the row, and
 * the board touch is a request that calls `resumeOwedWaits`: in Workforce the
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
  resumeOwedWaits,
  type TaskCollectionRef
} from "../../src";
import { stampCurrentClaim } from "../../src/task-board/flow-policy-wiring";
import { act, statusOf, stepModel, toolResults, until, type StepFn } from "./wait-fixture";

const BOARD = "waits";

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

const roster = { has: (name: string) => name === "researcher", describe: () => "researcher" };

/** The waiting flow: `run` is a turn holding the task tools; `settle`, `touch` and `list` as in the wait fixture. */
function toolFlow(model: ReturnType<typeof stepModel>["model"], resumesWaits = true): FlowInstance {
  // This flow's `touch` action is its waker, so the board resumes waits.
  const tools = createTaskToolsCapability(boardOf, roster, { resumesWaits, dispatches: true });
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
    execute: async (_input, ctx) => resumeOwedWaits(ctx, (await boardOf(ctx))!)
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx))!.list().map((t) => ({ id: t.id, status: t.status, wait: t.wait, createdAt: t.createdAt }))
  });
  return defineFlow({
    kind: "wait-board",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session" }) },
    actions: {
      run: {
        block: sequencer({ name: "turn" }).step(generator({ name: "agent", model, prompt: "p", uses: [tools] })),
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

/** Run `fn` in an async scope of its own, so a stamped claim stays in it. */
const isolated = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => setImmediate(() => fn().then(resolve, reject)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("where dispatchTask offers wait (BR-5, D1)", () => {
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
        expect(names).toEqual([
          "addTask",
          "answerTask",
          "assignTask",
          "blockTask",
          "cancelTask",
          "completeTask",
          "dispatchTask",
          "failTask",
          "listTasks",
          "readTask",
          "updateTask"
        ]);
        const base = ["assignee", "deps", "followUpOf", "goal", "input", "metadata", "priority", "taskId"];
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
      expect(dispatchTaskFields(seen)).toEqual(["assignee", "deps", "followUpOf", "goal", "input", "metadata", "priority", "taskId"]);
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
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const run = await isolated(async () => {
        // The gate's claim, as it stamps it before the turn it serves.
        stampCurrentClaim({ collectionId: "tasks", taskId: "task_worked", attempt: 1, createdAt: 1 });
        return act(state as never, flow, "run");
      });
      expect(await statusOf(state as never, run.requestId!)).toBe("completed");
      expect(toolResults(seen[1]!.messages)).toContain('"error":"wait_unavailable');
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
