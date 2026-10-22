/**
 * A plan board hands a row filed `session: "new"` to a session of its own and
 * waits on it (FIX-2082 D2): the drain parks until the row ends, never moving
 * past it at a deadline, and the next row sees what it produced. Rows filed
 * with no session run inline, in the drain's own session. Nobody else is told
 * how a plan row ended: the drain is.
 *
 * Real runtime: `createFlowState` over in-memory stores, its dispatch seam,
 * its durability sweeper and its wakes. The handed-over row's work waits on a
 * gate the test opens, so the drain is seen parked before the row ends.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type TaskWorker,
  type TaskWorkerInput
} from "../../src/tasks";
import { taskSettledEntry } from "../../src";

// The engine's depth count, which a test can force past five: a chain that grew
// while the drain ran between two parks.
const forced = vi.hoisted(() => ({ depth: undefined as number | undefined }));
vi.mock("../../../engine/src/durability/wait-chain", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../engine/src/durability/wait-chain")>();
  return {
    ...original,
    createRequestWaits: (inputs: Parameters<typeof original.createRequestWaits>[0]) => {
      const waits = original.createRequestWaits(inputs);
      return { ...waits, depth: async (input: Parameters<typeof waits.depth>[0]) => forced.depth ?? waits.depth(input) };
    }
  };
});

const USER = "u_plan";
const SESSION = "s_plan";

/** The gate the handed-over step's work waits on, opened by the test. */
let open: () => void = () => undefined;
let opened: Promise<void> = Promise.resolve();
const holdTheStep = () => {
  opened = new Promise<void>((resolve) => {
    open = resolve;
  });
};

/** Every notice the drain's session heard: a plan board owes none. */
const notices: unknown[] = [];

function planFlow(): FlowInstance {
  const ledger = defineTaskCollection({ id: "plan-steps", scope: "user" });
  const inline = handler({
    name: "inline-step",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.string(),
    execute: (input: TaskWorkerInput, ctx) => `${input.goal} in ${ctx.session.identity.id} after ${JSON.stringify(input.deps ?? {})}`
  }) as TaskWorker;
  const ownSession = handler({
    name: "own-session-step",
    inputSchema: z.unknown(),
    outputSchema: z.string(),
    execute: async (input: TaskWorkerInput, ctx) => {
      await opened;
      return `${input.goal} in ${ctx.session.identity.id}`;
    }
  });
  const board = taskBoard({
    name: "plan",
    boardId: "plan",
    collection: ledger,
    workers: inline,
    newSession: dispatcher({ name: "own-session", type: "task", action: "work", session: "per-task" }),
    concurrency: 1,
    initialTasks: [
      { id: "outline", goal: "Outline", assignee: "writer" },
      { id: "fact-check", goal: "Fact-check", assignee: "writer", deps: ["outline"], session: "new" },
      { id: "publish", goal: "Publish", assignee: "writer", deps: ["fact-check"] }
    ]
  });
  const rows = handler({
    name: "plan-rows",
    inputSchema: z.unknown(),
    outputSchema: z.any(),
    resources: { "plan-steps": ledger },
    execute: async (_input, ctx) =>
      (
        await getOrCreateTaskCollection({
          ctx: ctx as never,
          backing: "resource",
          collectionId: "plan-steps",
          collection: resolveResourceCollection(ctx as never, "plan-steps")!
        })
      )
        .list()
        .map((row) => ({ id: row.id, status: row.status, output: row.output, resumeOwed: row.resumeOwed }))
  });
  return defineFlow({
    kind: "plan-hands-over",
    // The filer's pass resumes the drain: it reaches the ledger at flow level.
    resources: { "plan-steps": ledger },
    internal: {
      actions: {
        onTaskSettled: taskSettledEntry({
          block: handler({
            name: "note-heard",
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: (notice) => {
              notices.push(notice);
              return {};
            }
          })
        })
      }
    },
    actions: {
      run: { block: sequencer({ name: "run-plan", inputSchema: z.unknown() }).tap(board.drain).step(rows), durable: true },
      rows: { block: rows }
    },
    task: { actions: { work: { block: ownSession } } }
  } as never)({ id: "plan-hands-over" });
}

type Row = { id: string; status: string; output?: string; resumeOwed?: boolean };

describe("a plan board's row filed session: \"new\" (FIX-2082 D2)", () => {
  let state: ReturnType<typeof createFlowState> | undefined;
  afterEach(async () => {
    open();
    await state?.dispose();
    state = undefined;
    notices.length = 0;
    forced.depth = undefined;
  });

  async function boot(waitDeadlines?: { defaultMs: number; minMs: number }) {
    const flow = planFlow();
    state = createFlowState({
      flows: { "plan-hands-over": flow },
      stores: { default: { primary: inMemoryStores() } },
      durable: true,
      durabilityRetention: { sweepIntervalMs: 100 },
      ...(waitDeadlines !== undefined ? { waitDeadlines } : {})
    });
    await state.getRouter();
    const runtime = await state.getRuntime();
    const act = (actionName: string) =>
      runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName,
        input: {},
        userId: USER,
        sessionId: SESSION,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig
      });
    const statusOf = async (requestId: string) => (await runtime.stores.request.get(requestId))?.status;
    const until = async (check: () => Promise<boolean>, ms = 8_000) => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        if (await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return check();
    };
    const rowsNow = async () => (await act("rows")).output as Row[];
    /** How many times the request parked: each wait, and each wait again. */
    const parks = async (requestId: string) =>
      ((await runtime.stores.request.get(requestId)) as { items?: Array<{ type: string }> })?.items?.filter(
        (item) => item.type === "suspension"
      ).length ?? 0;
    return { act, statusOf, until, rowsNow, parks };
  }

  it("runs it in a session of its own, waits for it, and the next step sees what it produced", async () => {
    holdTheStep();
    const { act, statusOf, until, rowsNow } = await boot();
    const run = await act("run");
    expect(run.error).toBeUndefined();
    // Parked on the handed-over row, which still runs: the drain went no further.
    expect(await until(async () => (await statusOf(run.requestId!)) === "suspended")).toBe(true);
    expect((await rowsNow()).map((row) => [row.id, row.status])).toEqual([
      ["outline", "completed"],
      ["fact-check", "in_progress"],
      ["publish", "pending"]
    ]);

    open();
    expect(await until(async () => (await statusOf(run.requestId!)) === "completed")).toBe(true);
    const [outline, factCheck, publish] = await rowsNow();
    expect(outline!.output).toContain(`in ${SESSION}`);
    // The handed-over row ran in a session of its own.
    expect(factCheck).toMatchObject({ status: "completed" });
    const own = /in (\S+)$/.exec(factCheck!.output!)![1]!;
    expect(own).not.toBe(SESSION);
    // The next row ran inline, after it, with its output: a value only it produced.
    expect(publish).toMatchObject({ status: "completed" });
    expect(publish!.output).toContain(`in ${SESSION}`);
    expect(publish!.output).toContain(own);
    // Its ending resumed the drain, which owes nothing more.
    expect(factCheck!.resumeOwed ?? false).toBe(false);
    // Nobody was told how a plan row ended: the drain heard it.
    expect(notices).toEqual([]);
  });

  it("waits through its deadlines, never moving past the running row", async () => {
    holdTheStep();
    const { act, statusOf, until, rowsNow, parks } = await boot({ defaultMs: 1_000, minMs: 1_000 });
    const run = await act("run");
    expect(await until(async () => (await statusOf(run.requestId!)) === "suspended")).toBe(true);
    // Two deadlines pass: each resumes the drain, which waits again.
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    expect(await until(async () => (await statusOf(run.requestId!)) === "suspended")).toBe(true);
    const during = await rowsNow();
    expect(during.find((row) => row.id === "fact-check")).toMatchObject({ status: "in_progress" });
    expect(during.find((row) => row.id === "publish")).toMatchObject({ status: "pending" });
    // It parked once, then again at each deadline it passed.
    expect(await parks(run.requestId!)).toBeGreaterThanOrEqual(3);

    open();
    expect(await until(async () => (await statusOf(run.requestId!)) === "completed")).toBe(true);
    const publish = (await rowsNow()).find((row) => row.id === "publish")!;
    expect(publish.output).toContain("Fact-check in");
  }, 20_000);

  it("keeps waiting on the row it handed over when the chain has grown past five: that wait already exists", async () => {
    holdTheStep();
    const { act, statusOf, until, rowsNow, parks } = await boot({ defaultMs: 1_000, minMs: 1_000 });
    const run = await act("run");
    expect(await until(async () => (await statusOf(run.requestId!)) === "suspended")).toBe(true);
    // From the second park on, the chain reads six deep.
    forced.depth = 6;
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    // The drain waited again at each deadline, and went no further.
    expect(await until(async () => (await statusOf(run.requestId!)) === "suspended")).toBe(true);
    expect(await parks(run.requestId!)).toBeGreaterThanOrEqual(3);
    expect((await rowsNow()).find((row) => row.id === "publish")).toMatchObject({ status: "pending" });

    open();
    // The row ends, the drain hears it, the next row runs, and the request ends.
    expect(await until(async () => (await statusOf(run.requestId!)) === "completed")).toBe(true);
    const publish = (await rowsNow()).find((row) => row.id === "publish")!;
    expect(publish).toMatchObject({ status: "completed" });
    expect(publish.output).toContain("Fact-check in");
  }, 20_000);
});
