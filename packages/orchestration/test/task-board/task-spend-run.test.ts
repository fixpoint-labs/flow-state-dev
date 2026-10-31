/**
 * A task's run writes what it spends onto its row as it works, and settles it
 * when its request ends (FIX-2288).
 *
 * Why it matters: a task card's count must rise while the run works, not only
 * when it ends; it must end at exactly what the request handed on (a harness's
 * final report replaces its running total, never adds to it); and a request
 * that is cancelled mid-run must keep what it spent and stop reading as live.
 *
 * The gate runs as a real action root under `runAction`, so the request's
 * spend ledger and its request-end seam are the engine's own.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { REQUEST_END_SEAM, REQUEST_SPEND_SEAM, reportHarnessSpend, type ActionCore, type BlockContext, type RequestSpend } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { createTaskGate, SPEND_TICK_MS, taskWorkerInputSchema } from "../../src/task-board";
import { admitClaimedTask } from "../../src/task-board/task-request";
import { createResourceBackedTaskCollection, taskSpendView, ticketForClaim, type Task, type TaskSpendView } from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A latch the test opens. */
function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

async function setup() {
  const store = createFakeResourceCollection();
  const ledger = () => createResourceBackedTaskCollection({ collectionId: "spend-ledger", collection: store, now: () => Date.now() });
  const parent = await ledger();
  await parent.createTask({ id: "t1", goal: "do it", assignee: "coder", input: {} });
  const claimed = (await parent.claim("drain", { leaseDurationMs: 60_000 }))!;

  const steps = [latch(), latch(), latch()];
  const reached = [latch(), latch(), latch()];
  let abort: AbortController | undefined;
  const worker = sequencer({ name: "spend-worker", inputSchema: taskWorkerInputSchema }).step(
    handler({
      name: "spend-harness",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const report = (inputTokens: number | null, outputTokens: number | null) =>
          reportHarnessSpend(ctx, { runId: "run-1", harness: "claude-code", model: "claude-sonnet-4-5", inputTokens, outputTokens, costUsd: null, billing: "subscription" });
        report(null, null);
        reached[0]!.open();
        await steps[0]!.opened;
        report(100, 20);
        reached[1]!.open();
        await steps[1]!.opened;
        if (ctx.signal.aborted) throw new Error("cancelled");
        report(200, 40);
        reached[2]!.open();
        await steps[2]!.opened;
        // The whole query's count at the end: it replaces the running 200 + 40.
        report(1000, 200);
        return "the answer";
      },
    })
  );
  const gate = createTaskGate({ name: "spend-board", boardId: "spend-board", onError: "skip", collection: ledger });
  const flow = defineFlow({
    kind: "spend-gate",
    actions: { implement: gate({ block: worker } as unknown as ActionCore, "implement") },
  } as never)({ id: "spend-gate" });

  const run = () => {
    abort = new AbortController();
    return runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "implement",
      input: {
        boardId: "spend-board",
        assignee: "coder",
        taskId: "t1",
        attempt: claimed.attempts,
        createdAt: claimed.createdAt,
        incarnationId: claimed.incarnationId,
        payload: { taskId: "t1", goal: "do it", attempts: claimed.attempts, input: {} },
      },
      userId: "u1",
      sessionId: "s_task",
      stores: createInMemoryStores(),
      runtimeConfig: {},
      signal: abort.signal,
    } as never);
  };
  const view = async (): Promise<TaskSpendView | null> => taskSpendView(((await ledger()).get("t1") ?? {}) as Task);
  /** Wait past the next tick for the row to read `want`. */
  const viewAfterTick = async () => {
    await sleep(SPEND_TICK_MS + 600);
    return view();
  };
  return { run, steps, reached, view, viewAfterTick, abort: () => abort?.abort() };
}

describe("a task's run writes its spend onto the row", () => {
  it("names the harness and model with no tokens, rises mid-run, and ends at the final report, not live", async () => {
    const t = await setup();
    const running = t.run();

    await t.reached[0]!.opened;
    expect(await t.viewAfterTick()).toEqual({ harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: null, outputTokens: null, costUsd: null, unreported: true, live: true });
    t.steps[0]!.open();
    await t.reached[1]!.opened;
    expect(await t.viewAfterTick()).toMatchObject({ inputTokens: 100, outputTokens: 20, live: true });
    t.steps[1]!.open();
    await t.reached[2]!.opened;
    expect(await t.viewAfterTick()).toMatchObject({ inputTokens: 200, outputTokens: 40, live: true });
    t.steps[2]!.open();
    const result = await running;

    expect(result.error).toBeUndefined();
    expect(await t.view()).toEqual({ harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: 1000, outputTokens: 200, costUsd: null, unreported: false, live: false });
  }, 20_000);

  it("keeps what a cancelled run spent, and stops reading it as live", async () => {
    const t = await setup();
    const running = t.run();

    t.steps[0]!.open();
    await t.reached[1]!.opened;
    expect(await t.viewAfterTick()).toMatchObject({ inputTokens: 100, outputTokens: 20, live: true });
    t.abort();
    t.steps[1]!.open();
    await running;
    await sleep(200);

    expect(await t.view()).toMatchObject({ inputTokens: 100, outputTokens: 20, live: false });
  }, 20_000);

  it("writes a continuation's recovered spend as it is admitted, before its first tick", async () => {
    // A continuation that dies before ticking must still leave what it recovered on the row: the run before it is
    // counted less that, and without it would be counted less the next continuation's recovery, which is larger.
    const ledger = await createResourceBackedTaskCollection({ collectionId: "admit-ledger", collection: createFakeResourceCollection(), now: () => Date.now() });
    await ledger.createTask({ id: "t1", goal: "do it", assignee: "coder", input: {} });
    const row = (await ledger.claim("drain", { leaseDurationMs: 60_000 }))!;
    const recovered: RequestSpend = { byModel: { "openai/gpt-6-luna": { prompt: 4, completion: 4, total: 8, cacheReadTokens: 0, cacheCreationTokens: 0 } }, harnessRuns: [] };
    const abort = new AbortController();
    const ctx = {
      request: { identity: { id: "q1" } },
      signal: abort.signal,
      [REQUEST_END_SEAM]: { add: () => {} },
      [REQUEST_SPEND_SEAM]: { reportHarnessRun: () => {}, pending: () => recovered },
    } as unknown as BlockContext;
    try {
      await admitClaimedTask(ctx, { ref: ledger, row, ticket: ticketForClaim(ledger.collectionId, row), answerCounts: false, own: true });
      expect(taskSpendView(ledger.get("t1")!)).toMatchObject({ model: "openai/gpt-6-luna", inputTokens: 4, outputTokens: 4, live: true });
      expect(ledger.get("t1")!.spend!.requests[0]).toMatchObject({ requestId: "q1", recovered: [{ source: "openai/gpt-6-luna", inputTokens: 4 }] });
    } finally {
      abort.abort();
    }
  });
});
