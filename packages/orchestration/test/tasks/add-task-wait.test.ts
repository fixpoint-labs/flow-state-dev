/**
 * `addTask({ waitForResponse, timeoutMs })` as a model calls it (FIX-1816 P3,
 * V3 and V6 through the task tools, and the D1 check).
 *
 * The asking turn is a generator holding the task tools capability over a
 * durable board, the shape a coordinator's turn has. "The colleague" is a
 * later request in the same conversation that claims and settles the row, and
 * the board touch is a request that calls `resumeOwedAsks`: in Workforce the
 * notice and the board run make that call (see Workforce's ask tests).
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
  resumeOwedAsks,
  type TaskCollectionRef
} from "../../src";
import { stampCurrentClaim } from "../../src/task-board/flow-policy-wiring";
import { act, statusOf, stepModel, toolResults, until, type StepFn } from "./ask-fixture";

const BOARD = "asks";

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

const roster = { has: (name: string) => name === "researcher", describe: () => "researcher" };

/** The asking flow: `run` is a turn holding the task tools; `settle`, `touch` and `list` as in the ask fixture. */
function toolFlow(model: ReturnType<typeof stepModel>["model"], resumesAsks = true): FlowInstance {
  // This flow's `touch` action is its waker, so the board resumes asks.
  const tools = createTaskToolsCapability(boardOf, roster, { resumesAsks });
  const settle = handler({
    name: "settle",
    inputSchema: z.object({ output: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = (await boardOf(ctx))!;
      const claimed = await board.claim("researcher-worker");
      if (claimed === null) throw new Error("no asked row to claim");
      await board.complete(claimed.id, input.output);
      return claimed.id;
    }
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => resumeOwedAsks(ctx, (await boardOf(ctx))!)
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx))!.list().map((t) => ({ id: t.id, status: t.status, ask: t.ask, createdAt: t.createdAt }))
  });
  return defineFlow({
    kind: "ask-board",
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
  })({ id: "ask-board" });
}

type Host = { durable: boolean; router: boolean; sweepIntervalMs?: number };

async function host(flow: FlowInstance, options: Host) {
  const state = createFlowState({
    flows: { "ask-board": flow },
    stores: { default: { primary: inMemoryStores() } },
    durable: options.durable,
    ...(options.sweepIntervalMs !== undefined ? { durabilityRetention: { sweepIntervalMs: options.sweepIntervalMs } } : {})
  });
  if (options.router) await state.getRouter();
  return state;
}

type Row = { id: string; status: string; ask?: { gateId: string; deadline: number }; createdAt: number };
const listRows = async (state: Awaited<ReturnType<typeof host>>, flow: FlowInstance) =>
  (await act(state as never, flow, "list")).output as Row[];

const addTaskCall =
  (id: string, args: Record<string, unknown>): StepFn =>
  () => ({ toolCalls: [{ toolCallId: id, toolName: "addTask", args: { goal: "Is ACME's SOC 2 current?", ...args } }], finishReason: "tool-calls" });
const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

/** The addTask tool's input fields, as the model was handed them on its first call. */
function addTaskFields(seen: GeneratorModelCallOptions[]): string[] {
  const tool = seen[0]!.tools!.find((t) => t.name === "addTask")!;
  return Object.keys((tool.parameters as z.AnyZodObject).shape).sort();
}

/** Run `fn` in an async scope of its own, so a stamped claim stays in it. */
const isolated = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => setImmediate(() => fn().then(resolve, reject)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("where addTask offers waitForResponse (BR-5, D1)", () => {
  for (const [label, options, offered] of [
    ["a durable host whose durability sweeper runs", { durable: true, router: true }, true],
    ["a durable host with no sweeper", { durable: true, router: false }, false],
    ["a host with no durable execution", { durable: false, router: true }, false]
  ] as const) {
    it(`${offered ? "offers" : "does not offer"} it on ${label}; the eight tools are the eight either way`, async () => {
      const { model, seen } = stepModel([finalAnswer]);
      const flow = toolFlow(model);
      const state = await host(flow, options);
      try {
        await act(state as never, flow, "run", {}, { sweeper: options.router });
        const names = seen[0]!.tools!.map((t) => t.name).sort();
        // D1: waiting adds no tool.
        expect(names).toEqual([
          "addTask",
          "assignTask",
          "blockTask",
          "cancelTask",
          "completeTask",
          "failTask",
          "listTasks",
          "updateTask"
        ]);
        const base = ["assignee", "deps", "goal", "input", "metadata", "priority"];
        expect(addTaskFields(seen)).toEqual(offered ? [...base, "timeoutMs", "waitForResponse"].sort() : base);
      } finally {
        await state.dispose();
      }
    });
  }

  it("does not offer it on a board with no waker, even on a host that could hold the ask", async () => {
    const { model, seen } = stepModel([finalAnswer]);
    const flow = toolFlow(model, false);
    const state = await host(flow, { durable: true, router: true });
    try {
      await act(state as never, flow, "run");
      expect(addTaskFields(seen)).toEqual(["assignee", "deps", "goal", "input", "metadata", "priority"]);
    } finally {
      await state.dispose();
    }
  });

  it("leaves a plain addTask as it was: it files and returns at once (BR-6)", async () => {
    const { model, seen } = stepModel([addTaskCall("c1", { assignee: "researcher" }), finalAnswer]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const run = await act(state as never, flow, "run");
      expect(await statusOf(state as never, run.requestId!)).toBe("completed");
      const [row] = await listRows(state, flow);
      expect(row).toMatchObject({ status: "pending" });
      expect(row!.ask).toBeUndefined();
      expect(toolResults(seen[1]!.messages)).toMatch(/"ok":true,"taskId":"task_[^"]+"}/);
    } finally {
      await state.dispose();
    }
  });
});

describe("addTask waits for its answer (BR-1, BR-2)", () => {
  it("files one row marked asked, parks, and returns the row's output as answer once it completes", async () => {
    const { model, seen } = stepModel([addTaskCall("c1", { assignee: "researcher", waitForResponse: true }), finalAnswer]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      const [row] = await listRows(state, flow);
      // The default bound: five minutes from filing (BR-14).
      expect(row!.ask!.deadline - row!.createdAt).toBeGreaterThanOrEqual(5 * 60_000 - 1_000);
      expect(row!.ask!.deadline - row!.createdAt).toBeLessThanOrEqual(5 * 60_000);

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

describe("listTasks marks an asked task", () => {
  it("shows the asked row with asked: true, and a filed row without it", async () => {
    const listCall: StepFn = () => ({ toolCalls: [{ toolCallId: "l1", toolName: "listTasks", args: {} }], finishReason: "tool-calls" });
    // The first turn asks and waits; the second files a task without waiting, then lists the board.
    const { model, seen } = stepModel([
      addTaskCall("c1", { assignee: "researcher", waitForResponse: true }),
      finalAnswer,
      addTaskCall("c0", { assignee: "researcher" }),
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
      expect(listed.filter((t) => t.asked === true)).toHaveLength(1);
      expect(listed.filter((t) => !("asked" in t))).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

describe("refused before anything is filed", () => {
  for (const [label, args, code] of [
    ["an assignee the roster doesn't name (BR-4)", { assignee: "nobody", waitForResponse: true }, "unknown_assignee"],
    ["timeoutMs under 30 s (BR-14a)", { assignee: "researcher", waitForResponse: true, timeoutMs: 29_999 }, "wait_timeout_out_of_range"],
    ["timeoutMs over an hour (BR-14a)", { assignee: "researcher", waitForResponse: true, timeoutMs: 3_600_001 }, "wait_timeout_out_of_range"],
    ["timeoutMs without waitForResponse", { assignee: "researcher", timeoutMs: 60_000 }, "wait_timeout_without_wait"]
  ] as const) {
    it(`${label}: ${code}, nothing filed, nothing parked`, async () => {
      const { model, seen } = stepModel([addTaskCall("c1", args), finalAnswer]);
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

  it("on a task turn: wait_unavailable, so an ask is never asked from inside an ask (BR-5a)", async () => {
    const { model, seen } = stepModel([addTaskCall("c1", { assignee: "researcher", waitForResponse: true }), finalAnswer]);
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
      const { model } = stepModel([addTaskCall("c1", { assignee: "researcher", waitForResponse: true, timeoutMs }), finalAnswer]);
      const flow = toolFlow(model);
      const state = await host(flow, { durable: true, router: true });
      try {
        const parked = await act(state as never, flow, "run");
        expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
        const [row] = await listRows(state, flow);
        expect(row!.ask!.deadline - row!.createdAt).toBeGreaterThanOrEqual(timeoutMs - 1_000);
        expect(row!.ask!.deadline - row!.createdAt).toBeLessThanOrEqual(timeoutMs);
      } finally {
        await state.dispose();
      }
    });
  }

  for (const [label, timeoutMs, before, after] of [
    ["a set timeoutMs", 30_000, 29_000, 31_000],
    ["the five-minute default", undefined, 4 * 60_000 + 50_000, 5 * 60_000 + 10_000]
  ] as const) {
    it(`a real sweep tick times the ask out at ${label}, not before, and cancels its row`, async () => {
      const args = { assignee: "researcher", waitForResponse: true, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
      const { model, seen } = stepModel([addTaskCall("c1", args), finalAnswer]);
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
