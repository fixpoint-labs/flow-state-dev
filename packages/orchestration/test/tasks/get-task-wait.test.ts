/**
 * `getTask({ id, wait, deadline })` as a model calls it (FIX-2082): a task
 * filed with `createTask`, now or in an earlier request, is waited on through
 * the read, which returns the task once it ends or as it stands at the
 * deadline. `createTask` never waits, and `dispatchTask` is gone (FIX-2083).
 *
 * The waiting request is a generator holding the task tools capability over a
 * durable board, the shape a coordinator's turn has. "The colleague" is a
 * later request in the same session that claims and settles the row, and the
 * board touch is a request that calls `payOwedResumes`: in Workforce the board
 * run makes that call (see Workforce's wait tests).
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
import { payOwedResumes } from "../../src/tasks/helpers/wait-on-task";
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
function toolFlow(model: ReturnType<typeof stepModel>["model"], resumesWaits = true, claim?: TaskClaimTicket): FlowInstance {
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
    execute: async (_input, ctx) => payOwedResumes(ctx, (await boardOf(ctx))!)
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx))!.list().map((t) => ({ id: t.id, status: t.status, wait: t.wait, createdAt: t.createdAt }))
  });
  return defineFlow({
    internal: { actions: { ...heard } },
    kind: "wait-board",
    // Each row names the session that filed it (FIX-2078): only that session may wait on it.
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session", delivery: {} }) },
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

type Row = { id: string; status: string; wait?: { gateId: string; deadline: number; requestId?: string; lapsed?: true }; createdAt: number };
const listRows = async (state: Awaited<ReturnType<typeof host>>, flow: FlowInstance) =>
  (await act(state as never, flow, "list")).output as Row[];

const call =
  (toolCallId: string, toolName: string, args: () => Record<string, unknown>): StepFn =>
  () => ({ toolCalls: [{ toolCallId, toolName, args: args() }], finishReason: "tool-calls" });
const createTask = (id: string) => call(id, "createTask", () => ({ goal: "Is ACME's SOC 2 current?", assignee: "researcher" }));
const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

/** The id `createTask` answered with, from the results the model was sent on `step`. */
function filedId(seen: GeneratorModelCallOptions[], step: number): string {
  return /"taskId":"([^"]+)"/.exec(toolResults(seen[step]!.messages))![1]!;
}

/** A tool's input fields, as the model was handed them on its first call. */
function fieldsOf(seen: GeneratorModelCallOptions[], name: string): string[] {
  const tool = seen[0]!.tools!.find((t) => t.name === name)!;
  return Object.keys((tool.parameters as z.AnyZodObject).shape).sort();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("where getTask offers wait", () => {
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
        // Waiting adds no tool.
        expect(names).toEqual(["createTask", "getTask", "listTasks", "updateTask"]);
        expect(fieldsOf(seen, "getTask")).toEqual(offered ? ["deadline", "id", "wait"] : ["id"]);
        // No other tool waits.
        expect(fieldsOf(seen, "createTask")).not.toContain("wait");
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
      expect(fieldsOf(seen, "getTask")).toEqual(["id"]);
    } finally {
      await state.dispose();
    }
  });
});

describe("getTask waits on a task this session filed", () => {
  it("a task filed in an earlier request is waited on in a later one, which gets it completed, with its output", async () => {
    const { model, seen } = stepModel([
      createTask("c1"),
      finalAnswer,
      call("g1", "getTask", () => ({ id: filedId(seen, 1), wait: true })),
      finalAnswer
    ]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const filing = await act(state as never, flow, "run");
      expect(await statusOf(state as never, filing.requestId!)).toBe("completed");
      const [filed] = await listRows(state, flow);
      // Filing takes no slot: the slot is the wait's, taken when it starts.
      expect(filed!.wait).toBeUndefined();

      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      const [row] = await listRows(state, flow);
      expect(row!.wait?.requestId).toBe(parked.requestId);

      await act(state as never, flow, "settle", { output: "Yes, renewed 2026-08" });
      await act(state as never, flow, "touch");
      await until(state as never, parked.requestId!, "completed");
      const read = toolResults(seen[3]!.messages);
      expect(read).toContain(`"id":"${row!.id}"`);
      expect(read).toContain('"status":"completed"');
      expect(read).toContain("Yes, renewed 2026-08");
    } finally {
      await state.dispose();
    }
  });

  it("a request working a task may wait too: no refusal on a task's own request", async () => {
    const claim: TaskClaimTicket = { collectionId: "tasks", taskId: "task_worked", attempt: 1, turn: 1, createdAt: 1 };
    const { model, seen } = stepModel([
      createTask("c1"),
      call("g1", "getTask", () => ({ id: filedId(seen, 1), wait: true })),
      finalAnswer
    ]);
    const flow = toolFlow(model, true, claim);
    const state = await host(flow, { durable: true, router: true });
    try {
      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      await act(state as never, flow, "settle", { output: "a piece's result" });
      await act(state as never, flow, "touch");
      await until(state as never, parked.requestId!, "completed");
      expect(toolResults(seen[2]!.messages)).toContain("a piece's result");
    } finally {
      await state.dispose();
    }
  });

  it("listTasks shows the open task a request waits on with waitedOn: true, and no other", async () => {
    const { model, seen } = stepModel([
      createTask("c1"),
      createTask("c2"),
      finalAnswer,
      call("g1", "getTask", () => ({ id: filedId(seen, 1), wait: true })),
      call("l1", "listTasks", () => ({})),
      finalAnswer,
      finalAnswer
    ]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      await act(state as never, flow, "run");
      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      // Another request of the session lists the board while the first waits.
      await act(state as never, flow, "run");
      const listed = JSON.parse(toolResults(seen[5]!.messages).split(" | ").pop()!).value.tasks as Array<Record<string, unknown>>;
      expect(listed).toHaveLength(2);
      expect(listed.filter((t) => t.waitedOn === true).map((t) => t.id)).toEqual([filedId(seen, 1)]);
    } finally {
      await state.dispose();
    }
  });

  it("refuses deadline without wait, and a deadline outside the host's bounds, naming the rule", async () => {
    const { model, seen } = stepModel([
      createTask("c1"),
      call("g1", "getTask", () => ({ id: filedId(seen, 1), deadline: 60_000 })),
      call("g2", "getTask", () => ({ id: filedId(seen, 1), wait: true, deadline: 999 })),
      finalAnswer
    ]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true });
    try {
      const run = await act(state as never, flow, "run");
      expect(await statusOf(state as never, run.requestId!)).toBe("completed");
      expect(toolResults(seen[2]!.messages)).toContain('"error":"deadline_without_wait');
      expect(toolResults(seen[3]!.messages)).toContain('"error":"wait_deadline_out_of_range');
      expect((await listRows(state, flow))[0]!.wait).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });

  it("a real sweep tick resumes the wait at the five-minute default, not before, with the task still running", async () => {
    const { model, seen } = stepModel([
      createTask("c1"),
      call("g1", "getTask", () => ({ id: filedId(seen, 1), wait: true })),
      finalAnswer
    ]);
    const flow = toolFlow(model);
    const state = await host(flow, { durable: true, router: true, sweepIntervalMs: 25 });
    try {
      const parked = await act(state as never, flow, "run");
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");
      const real = Date.now.bind(Date);
      const at = (offset: number) => vi.spyOn(Date, "now").mockImplementation(() => real() + offset);

      at(4 * 60_000 + 50_000);
      await new Promise((r) => setTimeout(r, 300)); // a dozen ticks
      expect(await statusOf(state as never, parked.requestId!)).toBe("suspended");

      at(5 * 60_000 + 10_000);
      await until(state as never, parked.requestId!, "completed");
      expect(toolResults(seen[2]!.messages)).toContain('"status":"pending"');
      // Nothing cancelled, and the slot lapsed; released when the request ended.
      const [row] = await listRows(state, flow);
      expect(row).toMatchObject({ status: "pending" });
      expect(row!.wait).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });
});
