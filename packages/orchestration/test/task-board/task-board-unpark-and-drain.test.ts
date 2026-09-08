/**
 * `board.unparkAndDrain` — the one-call return trip for a parked task (FIX-1244).
 *
 * A worker parks a task to ask a person something, and on an `onReview: "exit"`
 * board the request that asked has already ended. Handing the answer back used
 * to take two calls the caller had to sequence themselves — re-queue, then
 * drain — and the re-queue half accepted any task at all. This step is the
 * answer path: the fenced `unpark` write, then the board's own drain, in the
 * caller's request, and only when the write was accepted.
 *
 * Every refusal is asserted with the drain's absence as well as the decline:
 * a suite that only checks the outcome would pass against a step that drained
 * on every decline, which is exactly the rule the spec cut.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  fifoDispatcher,
  getOrCreateTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskInit,
  type TaskWorker,
  type TaskWorkerInput,
} from "../../src/tasks";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
  type TaskBoardConfig,
  type TaskBoardOnReview,
} from "../../src/task-board";

let seq = 0;

/** Final status per task id, folded from the `task-change` items a run emitted. */
function lastTaskState(items: readonly unknown[]): Map<string, string> {
  const finalStatus = new Map<string, string>();
  for (const item of items as Array<{
    type?: string;
    component?: string;
    data?: { task?: { id: string; status: string } };
  }>) {
    if (item.type === "component" && item.component === "task-change" && item.data?.task) {
      finalStatus.set(item.data.task.id, item.data.task.status);
    }
  }
  return finalStatus;
}

/**
 * `fifo`, counting claim attempts. A drain with one worker attempts at least
 * one claim before it can exit, so a zero here is the direct measurement of
 * "no drain ran" — the board-meta items cannot be counted for it, since they
 * are keyed by collection and each replaces the last.
 */
function countingDispatcher(attempts: { total: number }): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx): Promise<Task | null> {
      attempts.total += 1;
      return fifoDispatcher.claim(collection, workerId, ctx);
    },
  };
}

/**
 * A durable board whose worker parks on its first attempt and does the work
 * once an answer arrives as `feedback`. The worker reaches the ledger through
 * the resource the drain declares on its own subtree, since `board.capability`
 * does not exist yet when the worker is defined.
 */
function buildBoard(opts: { onReview?: TaskBoardOnReview; initialTasks?: TaskInit[] } = {}) {
  seq += 1;
  const name = `unpark-and-drain-${seq}`;
  const ledgerId = `${name}-ledger`;
  const ran: string[] = [];
  const attempts = { total: 0 };

  const boardTasks = (ctx: BlockContext): Promise<TaskCollectionRef> =>
    getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: ledgerId,
      collection: ctx.resources[ledgerId] as ResourceCollectionRef<JsonObject>,
    });

  const worker = handler({
    name: `${name}-worker`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      const tasks = await boardTasks(ctx);
      if (input.feedback === undefined) {
        await tasks.awaitReview(input.taskId, "does this look right?");
        return { ok: `${input.taskId}:parked` };
      }
      ran.push(`${input.taskId}:${input.feedback}`);
      return { ok: input.taskId };
    },
  }) as TaskWorker;

  const board = taskBoard({
    name,
    collection: defineTaskCollection({
      id: ledgerId,
      scope: "session",
      stateSchema: z.object({ topic: z.string() }),
    }),
    concurrency: 1,
    dispatcher: countingDispatcher(attempts),
    workers: worker,
    initialTasks: opts.initialTasks ?? [{ id: "ask", goal: "ask", input: { topic: "a" } }],
    onReview: opts.onReview ?? "exit",
    idlePollMs: 2,
    maxIterations: 20,
  });

  return { name, board, ran, attempts };
}

/** A sibling block that puts the board's rows where a test needs them before the step runs. */
function prep(
  board: ReturnType<typeof buildBoard>["board"],
  name: string,
  run: (tasks: TaskCollectionRef) => Promise<void>
) {
  return handler({
    name: `${name}-prep`,
    inputSchema: z.unknown(),
    outputSchema: z.null(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      await run(await ctx.cap[name].tasks());
      return null;
    },
  });
}

function root(name: string) {
  return sequencer({ name: `${name}-root`, inputSchema: z.unknown(), stateSchema: taskBoardStateSchema });
}

describe("board.unparkAndDrain — an accepted answer runs the work in the same request", () => {
  it("re-queues the parked task, drains, and returns the write outcome", async () => {
    const { name, board, ran } = buildBoard();
    const flow = root(name)
      // The launching drain: the worker parks `ask` and, on an exit board, returns.
      .step(board.drain)
      .step(() => ({ taskId: "ask", feedback: "approved, carry on" }), board.unparkAndDrain);

    const result = await testBlock(flow, { input: undefined });

    expect(result.error).toBeNull();
    // The step's value is the write's outcome — a tap into the drain, so the
    // drain's own result never replaces it.
    expect(result.output).toEqual({ outcome: "recorded" });
    // Task-specific evidence, not the board's report: this row ran with the
    // answer and settled.
    expect(ran).toEqual(["ask:approved, carry on"]);
    expect(lastTaskState(result.items).get("ask")).toBe("completed");
  });

  it("accepts a hold board whose initial tasks carry stable ids", async () => {
    // The invocation check is about the seed, not the mode: a default `hold`
    // board with stable ids is safe to re-drain, so the step runs on it.
    const { name, board, ran } = buildBoard({ onReview: "hold" });
    const flow = root(name)
      .step(
        prep(board, name, async (tasks) => {
          await tasks.addTask({ id: "ask", goal: "ask", input: { topic: "a" } });
          await tasks.claim("reviewer");
          await tasks.awaitReview("ask", "does this look right?");
        })
      )
      .step(() => ({ taskId: "ask", feedback: "yes" }), board.unparkAndDrain);

    const result = await testBlock(flow, { input: undefined });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ outcome: "recorded" });
    expect(ran).toEqual(["ask:yes"]);
  });
});

describe("board.unparkAndDrain — every refusal drains nothing", () => {
  it("refuses a task a worker is running, and does not start a drain", async () => {
    const { name, board, ran, attempts } = buildBoard({ initialTasks: [] });
    const flow = root(name)
      .step(
        prep(board, name, async (tasks) => {
          await tasks.addTask({ id: "t", goal: "t", input: { topic: "a" } });
          await tasks.claim("worker-1");
        })
      )
      .step(() => ({ taskId: "t", feedback: "the answer" }), board.unparkAndDrain);

    const result = await testBlock(flow, { input: undefined });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ outcome: "declined", reason: "disallowed", status: "in_progress" });
    expect(attempts.total).toBe(0);
    expect(ran).toEqual([]);
  });

  it("refuses a second answer to the same question — the first stands, nothing drains", async () => {
    const { name, board, ran, attempts } = buildBoard({ initialTasks: [] });
    let feedbackAfter: string | undefined;
    const flow = root(name)
      .step(
        prep(board, name, async (tasks) => {
          await tasks.addTask({ id: "t", goal: "t", input: { topic: "a" } });
          await tasks.claim("worker-1");
          await tasks.awaitReview("t", "which option?");
          expect(await tasks.unpark("t", "option A")).toEqual({ outcome: "recorded" });
        })
      )
      .step(() => ({ taskId: "t", feedback: "option B" }), board.unparkAndDrain)
      .tap(
        prep(board, name, async (tasks) => {
          feedbackAfter = tasks.get("t")?.feedback;
        })
      );

    const result = await testBlock(flow, { input: undefined });

    expect(result.error).toBeNull();
    // Already queued reads as a decline naming `pending` — never `unchanged`.
    expect(result.output).toEqual({ outcome: "declined", reason: "disallowed", status: "pending" });
    expect(feedbackAfter).toBe("option A");
    expect(attempts.total).toBe(0);
    expect(ran).toEqual([]);
  });

  it("throws on a task id the ledger does not hold, rather than reporting a drained board", async () => {
    const { name, board, attempts } = buildBoard({ initialTasks: [] });
    const flow = root(name).step(() => ({ taskId: "nope", feedback: "?" }), board.unparkAndDrain);

    const result = await testBlock(flow, { input: undefined });

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toMatch(/task "nope" not found/);
    expect(attempts.total).toBe(0);
  });
});

describe("board.unparkAndDrain — refuses unsupported boards when the step runs, not when the board is built", () => {
  const worker = handler({
    name: "unpark-and-drain-noop-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: (input) => ({ ok: input.taskId }),
  }) as TaskWorker;

  const boards: Array<[string, TaskBoardConfig["collection"]]> = [
    ["request", undefined],
    ["sequencer", { backing: "sequencer", collectionId: "unpark-seq" }],
    [
      "factory",
      (ctx: BlockContext) =>
        getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "unpark-factory" }),
    ],
  ];

  it.each(boards)("a %s-backed board constructs, and the step throws naming the board", async (label, collection) => {
    seq += 1;
    const name = `unpark-unsupported-${label}-${seq}`;
    // Both halves in one case: construction succeeds ...
    const board = taskBoard({
      name,
      ...(collection !== undefined ? { collection } : {}),
      concurrency: 1,
      dispatcher: "fifo",
      workers: worker,
      idlePollMs: 2,
      maxIterations: 5,
    });
    expect(board.unparkAndDrain).toBeDefined();

    // ... and the call refuses.
    const flow = root(name).step(() => ({ taskId: "t", feedback: "?" }), board.unparkAndDrain);
    const result = await testBlock(flow, { input: undefined });

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain(`[task-board] "${name}"`);
    expect(result.error?.message).toMatch(/resource-backed/);
  });

  it("a hold board with an id-less initial task constructs, and the step throws naming the seed", async () => {
    // `assertParkExitSupported` never reaches its seed check on a `hold` board,
    // so nothing at construction refuses this one — yet a second drain would
    // add the id-less task again and run the answered work twice.
    const { name, board, ran, attempts } = buildBoard({
      onReview: "hold",
      initialTasks: [{ goal: "no-id", input: { topic: "x" } }],
    });
    expect(board.hasIdlessInitialTasks).toBe(true);

    const flow = root(name).step(() => ({ taskId: "t", feedback: "?" }), board.unparkAndDrain);
    const result = await testBlock(flow, { input: undefined });

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain(`[task-board] "${name}"`);
    expect(result.error?.message).toMatch(/initialTasks/);
    expect(attempts.total).toBe(0);
    expect(ran).toEqual([]);
  });
});
