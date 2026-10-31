/**
 * A task's spend (FIX-2288): the write its run makes onto its row, and the
 * fold a reader shows.
 *
 * Why it matters: a task card shows which model and harness ran it and how
 * many tokens it spent, rising mid-run. So the write must land on a row that
 * has already settled (a failed attempt's tokens arrive after it failed),
 * never on a recreated row, and never announce itself as a lifecycle change;
 * and the fold must count every request, never show 0 for "not reported yet",
 * and say whether a request is still running.
 */
import { describe, expect, it } from "vitest";
import type { RequestSpend } from "@flow-state-dev/core/types";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  requestSpendView,
  spendAfterWrite,
  taskSpendView,
  ticketForClaim,
  type TaskChangeEvent,
  type TaskClaimTicket,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createCapturedChanges, createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const NONE: RequestSpend = { byModel: {}, harnessRuns: [] };
const harnessRun = (inputTokens: number | null, outputTokens: number | null, model = "claude-sonnet-4-5"): RequestSpend => ({
  byModel: {},
  harnessRuns: [{ runId: "r", harness: "claude-code", model, inputTokens, outputTokens, costUsd: null, billing: "subscription" }],
});
const modelCalls = (prompt: number, completion: number, model = "openai/gpt-6-luna"): RequestSpend => ({
  byModel: { [model]: { prompt, completion, total: prompt + completion, cacheReadTokens: 0, cacheCreationTokens: 0 } },
  harnessRuns: [],
});

describe("taskSpendView", () => {
  it("is null for a task that never ran in a request of its own", () => {
    expect(taskSpendView({})).toBeNull();
    expect(taskSpendView({ spend: null })).toBeNull();
  });

  it("names a harness run's model before any tokens, and reads its tokens as null, not 0, while unreported", () => {
    const view = taskSpendView({ spend: { requests: [{ requestId: "q1", settled: [], live: [{ source: "codex", kind: "harness", billing: null, inputTokens: 0, outputTokens: 0, costUsd: null, runs: 1, unreported: 1 }], harness: "codex", harnessModel: "gpt-5", model: null, writer: null, admittedAt: null, recovered: null }] } });
    expect(view).toEqual({ harness: "codex", model: "gpt-5", inputTokens: null, outputTokens: null, costUsd: null, unreported: true, live: true });
  });

  // A person picks a harness by what it cost, so a cost is only what a vendor billed (FIX-2398 D3):
  // charges add across requests, and a subscription run, which bills none, never reads as $0.
  it("sums the charges vendors reported, and reads null rather than 0 when only subscription runs ran", () => {
    const source = (costUsd: number | null, billing: "api-key" | "subscription") => ({ source: "claude-code", kind: "harness" as const, billing, inputTokens: 100, outputTokens: 10, costUsd, runs: 1, unreported: 0 });
    const entry = (requestId: string, settled: ReturnType<typeof source>[]) => ({ requestId, settled, live: null, harness: "claude-code", harnessModel: "claude-sonnet-4-5", model: null, writer: null, admittedAt: null, recovered: null });
    const subscriptionOnly = taskSpendView({ status: "completed", spend: { requests: [entry("q1", [source(null, "subscription")])] } });
    expect(subscriptionOnly?.costUsd).toBeNull();
    expect(subscriptionOnly?.inputTokens).toBe(100);
    const mixed = taskSpendView({ status: "completed", spend: { requests: [entry("q1", [source(null, "subscription")]), entry("q2", [source(0.25, "api-key")]), entry("q3", [source(0.5, "api-key")])] } });
    expect(mixed?.costUsd).toBeCloseTo(0.75);
    expect(mixed?.inputTokens).toBe(300);
  });

  // A harness session's turn has a request and no row; it must read exactly as
  // a task that ran the same request reads, or the one spend line disagrees.
  it("reads one request's spend as the row of a task that ran it and settled", () => {
    const spend: RequestSpend = {
      byModel: {},
      harnessRuns: [
        { runId: "a", harness: "codex", model: "gpt-5-codex", inputTokens: 40, outputTokens: 4, costUsd: 0.01, billing: "api-key" },
        { runId: "b", harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: 100, outputTokens: 10, costUsd: null, billing: "subscription" },
      ],
    };
    const row = spendAfterWrite({ spend: null }, { requestId: "q1", part: "settle", spend });
    expect(requestSpendView(spend, "q1")).toEqual(taskSpendView({ status: "completed", spend: row }));
    expect(requestSpendView(spend, "q1")).toMatchObject({ harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: 140, costUsd: 0.01 });
    expect(requestSpendView(NONE, "q1")).toBeNull();
  });
});

interface Backing {
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
}

async function stateBacking(): Promise<Backing> {
  const captured = createCapturedChanges();
  return {
    collection: createStateBackedTaskCollection({
      collectionId: "tasks",
      state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      onChange: captured.onChange,
      now: () => 1_000,
    }),
    events: captured.events,
  };
}

async function resourceBacking(): Promise<Backing> {
  const captured = createCapturedChanges();
  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: captured.onChange,
      now: () => 1_000,
    }),
    events: captured.events,
  };
}

describe.each([
  ["state-backed", stateBacking],
  ["resource-backed", resourceBacking],
])("recordSpend (%s)", (_name, makeBacking) => {
  async function claimed(): Promise<Backing & { claim: TaskClaimTicket }> {
    const backing = await makeBacking();
    await backing.collection.createTask({ id: "t", goal: "t", maxAttempts: 2 });
    const task = (await backing.collection.claim("w", { leaseDurationMs: 10_000 }))!;
    return { ...backing, claim: ticketForClaim(backing.collection.collectionId, task) };
  }
  const view = (c: TaskCollectionRef) => taskSpendView(c.get("t")!);

  it("rises with each live write, settles at the ending, and publishes no task-change", async () => {
    const { collection, claim, events } = await claimed();
    const before = events.length;

    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: harnessRun(null, null) }, { claim });
    expect(view(collection)).toEqual({ harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: null, outputTokens: null, costUsd: null, unreported: true, live: true });

    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: harnessRun(100, 20) }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 100, outputTokens: 20, unreported: false, live: true });

    // The ending hands on the run's final report: it replaces the live part, never adds to it.
    expect(await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: harnessRun(1000, 200) }, { claim })).toEqual({ outcome: "recorded" });
    expect(view(collection)).toMatchObject({ inputTokens: 1000, outputTokens: 200, live: false });
    expect(events.length).toBe(before);
  });

  it("is unchanged when a live write says what the row already holds", async () => {
    const { collection, claim } = await claimed();
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(4, 4) }, { claim });
    expect(await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(4, 4) }, { claim })).toEqual({ outcome: "unchanged" });
  });

  it("counts every request: a failed attempt's tokens land on the settled row, and the retry's add to them", async () => {
    const { collection, claim } = await claimed();
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: harnessRun(200, 50) }, { claim });
    await collection.fail("t", "check failed", { ifAllowed: true, claim });
    // The first attempt's ending arrives after its failure was written: still taken.
    expect(await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: harnessRun(250, 50) }, { claim })).toEqual({ outcome: "recorded" });
    const second = (await collection.claim("w", { leaseDurationMs: 10_000 }))!;
    const claim2 = ticketForClaim(collection.collectionId, second);
    await collection.recordSpend!("t", { requestId: "q2", part: "settle", spend: harnessRun(1000, 200) }, { claim: claim2 });
    await collection.complete("t", "done", { ifAllowed: true, claim: claim2 });
    // And on a completed row, a late ending of the first request still lands.
    await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: modelCalls(4, 4) }, { claim });

    expect(view(collection)).toEqual({ harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: 1254, outputTokens: 254, costUsd: null, unreported: false, live: false });
  });

  it("keeps a dead request's live tokens but stops reading live once a retry finishes the task", async () => {
    // A worker that died after a live write never runs its ending, so its live part is never cleared.
    const { collection, claim } = await claimed();
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: harnessRun(200, 50) }, { claim });
    await collection.fail("t", "worker died", { ifAllowed: true, claim });
    const second = (await collection.claim("w", { leaseDurationMs: 10_000 }))!;
    const claim2 = ticketForClaim(collection.collectionId, second);
    await collection.recordSpend!("t", { requestId: "q2", part: "settle", spend: harnessRun(1000, 200) }, { claim: claim2 });
    await collection.complete("t", "done", { ifAllowed: true, claim: claim2 });

    expect(view(collection)).toMatchObject({ inputTokens: 1200, outputTokens: 250, live: false });
  });

  it("counts a dead run's harness run once whether or not its block finished, when its request is continued", async () => {
    // A finished block's harness runs are in the log, so the continuation recovers and reports them; an unfinished one's are only on the row.
    const { collection, claim } = await claimed();
    const first = { writer: "first", admittedAt: 1 };
    const logged = harnessRun(100, 10);
    const second = { writer: "second", admittedAt: 2, recovered: logged };
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: { byModel: {}, harnessRuns: [...logged.harnessRuns, { ...harnessRun(300, 60).harnessRuns[0]!, runId: "unfinished" }] }, ...first }, { claim });
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: logged, ...second }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 400, outputTokens: 70, live: true });
  });

  it("keeps a dead run's harness tokens when its request is continued in a new process", async () => {
    // A harness run whose block never finished isn't in the log, so the continuation doesn't recover it: the row is its only record.
    const { collection, claim } = await claimed();
    const first = { writer: "first", admittedAt: 1 };
    const second = { writer: "second", admittedAt: 2, recovered: modelCalls(4, 4) };
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: { byModel: modelCalls(4, 4).byModel, harnessRuns: harnessRun(300, 60).harnessRuns }, ...first }, { claim });
    // The continuation reports the recovered model calls itself: they count once.
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(4, 4), ...second }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 304, outputTokens: 64, live: true });
    await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: modelCalls(6, 6), ...second }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 306, outputTokens: 66, live: false });
  });

  it("keeps a dead run's model calls that its log never recorded, once, when its request is continued", async () => {
    // A generator that died mid-block had its finished steps on the row, but the log records a block's calls only when it
    // finishes: the continuation recovers the 4 a finished block logged, not the 6 the unfinished one spent, and calls again.
    const { collection, claim } = await claimed();
    const first = { writer: "first", admittedAt: 1 };
    const second = { writer: "second", admittedAt: 2, recovered: modelCalls(4, 4) };
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(10, 10), ...first }, { claim });
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(9, 9), ...second }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 15, outputTokens: 15, live: true });
    // A continuation recorded before admissions kept what they recovered drops the dead run's model calls, as before.
    const { recovered: _, ...legacy } = second;
    await collection.recordSpend!("t", { requestId: "q2", part: "live", spend: modelCalls(10, 10), ...first }, { claim });
    await collection.recordSpend!("t", { requestId: "q2", part: "live", spend: modelCalls(9, 9), ...legacy }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 15 + 9, outputTokens: 15 + 9 });
  });

  it("counts a continuation that died before its first tick by its admission write, not against the next one's recovery", async () => {
    // A spends 10 (4 logged); B recovers 4, logs 5 more and dies before ticking; C recovers those 9 and settles them.
    // Measured against C's recovery, A's 6 unlogged would shrink to 1: B's admission write keeps its own baseline.
    const { collection, claim } = await claimed();
    const first = { writer: "first", admittedAt: 1 };
    const second = { writer: "second", admittedAt: 2, recovered: modelCalls(4, 4) };
    const third = { writer: "third", admittedAt: 3, recovered: modelCalls(9, 9) };
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(10, 10), ...first }, { claim });
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(4, 4), ...second }, { claim });
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(9, 9), ...third }, { claim });
    await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: modelCalls(9, 9), ...third }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 15, outputTokens: 15, live: false });
  });

  it("keeps each admission's part when the interrupted one's ending lands after its continuation wrote", async () => {
    // The engine can publish the interruption before the old run's ending runs: a late ending is not a dead run.
    const { collection, claim } = await claimed();
    const first = { writer: "first", admittedAt: 1 };
    const second = { writer: "second", admittedAt: 2 };
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: harnessRun(100, 0), ...first }, { claim });
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: harnessRun(200, 0), ...second }, { claim });
    await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: harnessRun(100, 0), ...first }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 300, live: true });
    await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: harnessRun(200, 0), ...second }, { claim });
    expect(view(collection)).toMatchObject({ inputTokens: 300, live: false });
  });

  it("names the model reported last across requests, not the request admitted last", async () => {
    // The task's request suspends on model A, a notice's turn runs B, then the request resumes on C: the card shows C.
    const { collection, claim } = await claimed();
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(1, 1, "model-a") }, { claim });
    await collection.recordSpend!("t", { requestId: "q2", part: "settle", spend: modelCalls(1, 1, "model-b") }, { claim });
    expect(view(collection)).toMatchObject({ model: "model-b" });
    await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: modelCalls(2, 2, "model-c") }, { claim });
    expect(view(collection)).toMatchObject({ model: "model-c", inputTokens: 3 });
  });

  it("declines not-my-task for a ticket naming another incarnation of the row, writing nothing", async () => {
    const { collection, claim } = await claimed();
    // Same id and createdAt but a fresh nonce: a row deleted and recreated within one millisecond.
    expect(claim.incarnationId).toBeDefined();
    for (const other of [{ ...claim, createdAt: claim.createdAt - 1 }, { ...claim, collectionId: "other" }, { ...claim, incarnationId: "another-incarnation" }]) {
      expect(await collection.recordSpend!("t", { requestId: "q1", part: "live", spend: harnessRun(1, 1) }, { claim: other })).toMatchObject({
        outcome: "declined",
        reason: "not-my-task",
      });
    }
    expect(collection.get("t")!.spend).toBeUndefined();
  });

  it("writes no entry for a request that ended having spent nothing", async () => {
    const { collection, claim } = await claimed();
    expect(await collection.recordSpend!("t", { requestId: "q1", part: "settle", spend: NONE }, { claim })).toEqual({ outcome: "unchanged" });
    expect(view(collection)).toBeNull();
  });
});
