/**
 * Attached durable background-work recovery (investigation for FIX-815 follow-up).
 *
 * FIX-815's spec waved off "attached durable background work" (in-process
 * `.work()` / `.forEachBackground()` that survives a crash WITH a `durable: true`
 * parent) as "already served by FIX-811". FIX-811's own non-goals push durable
 * background work back to FIX-815. FIX-865 flags the open question directly:
 * "does a mid-drain background pool actually continue faithfully today, or get
 * re-run / dropped on continue? This needs to be pinned down."
 *
 * These tests pin it down against the current (post-FIX-811, post-FIX-839)
 * machinery. They use the in-memory store — the best case for trace persistence
 * (FIX-839's drop only affected SQLite/Postgres), so a failure here is a real,
 * adapter-independent gap. The crash is simulated exactly as the FIX-811 crash
 * tests do: suspend a durable sequencer (which drains background work first),
 * flip the record to `interrupted`, then `continueRequest` with no resumeContext.
 *
 * The contract under test: a background block that COMPLETED before the crash
 * must be replayed (its recorded output injected), NOT re-executed, on recovery.
 *
 * Each test asserts BOTH halves of that contract, because they fail independently:
 *   - not re-executed: a run counter stays at its pre-crash value; and
 *   - output injected (not dropped): the gate reads the drained background result
 *     via `ctx.getBlockOutput` and stashes it in its suspension `data`, so the
 *     re-suspension on recovery proves the replayed output is still observable to
 *     a later sibling. A drop-but-don't-re-run regression keeps the counter at 1
 *     yet loses the value, so the counter alone would go green falsely.
 *
 * NOTE: the two suites described above (the original investigation) simulate the
 * crash by flipping a `suspended` record to `interrupted`. The three suites added
 * below for FIX-866 use the **reachable** recovery paths instead (a gate-
 * `suspended` request is never swept to `interrupted`, so the flip models a state
 * production never produces) — see each suite's own docblock: mid-drain fan-out
 * and cross-store recovery drive `/resume` with a `resumeContext`.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { handleContinueRequest } from "../src/routes/recovery-routes";
import type { InboundTransportHost } from "../src/transports/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { buildItemLookup, resolveBlockValue } from "@flow-state-dev/core/items";
import { parseBlockInstanceId } from "@flow-state-dev/core/items/internal";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

function registryFor(flow: FlowInstance) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

type Deferred<T = void> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Yield the microtask/macrotask queue a few times so coalesced item/trace
 *  flushes (the `persistItems` microtask, block_trace `in_progress→completed`
 *  mutation) land before we snapshot request state. */
async function flush(ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("attached durable background-work recovery", () => {
  it("replays a completed `.work()` background block instead of re-running it on crash recovery", async () => {
    let bgRuns = 0;
    const bg = handler({
      name: "reindex",
      inputSchema: z.any(),
      outputSchema: z.object({ done: z.boolean() }),
      execute: async () => {
        bgRuns += 1;
        return { done: true };
      }
    });
    // The gate reads the drained `.work()` result via getBlockOutput and stashes
    // it in the suspension data, so we can assert the value survives recovery.
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_i, ctx) =>
        ctx.suspend!({
          reason: "human_approval",
          message: "Approve?",
          data: { observed: ctx.getBlockOutput!(bg) }
        })
    });

    const flow = defineFlow({
      kind: "bgwork-crash-work",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .work(bg)
            .waitForWork()
            .step(gate),
          inputSchema: z.any()
        }
      }
    })({ id: "bgwork-crash-work" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    // Background work completed (drained by waitForWork) before the gate suspended,
    // and the gate observed its result.
    expect(bgRuns).toBe(1);
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    const [firstSusp] = await provider.listSuspended({ status: "pending" });
    expect((firstSusp.data as { observed?: unknown }).observed).toEqual({ done: true });

    // Simulate a crash mid-flight: the stale sweeper marks the record interrupted.
    const suspended = await stores.request.get(requestId);
    await stores.request.set(
      requestId,
      { ...suspended!, status: "interrupted", interruptedAt: Date.now() },
      "any"
    );

    // Continue under the same id — crash recovery (no resumeContext). The gate
    // re-runs (re-suspends, no resolution); the background block is replayed.
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    // (a) Not re-executed: a double-fire would push bgRuns to 2.
    expect(bgRuns).toBe(1);
    // (b) Output injected, not dropped: the re-run gate still observed the
    // replayed background result via getBlockOutput. A drop-but-don't-re-run
    // regression keeps bgRuns at 1 but loses this value.
    const pending = await provider.listSuspended({ status: "pending" });
    const reSusp = pending.find((s) => s.suspensionId !== firstSusp.suspensionId);
    expect(reSusp).toBeDefined();
    expect((reSusp!.data as { observed?: unknown }).observed).toEqual({ done: true });
  });

  it("replays completed `.forEachBackground()` iterations instead of re-running them on crash recovery", async () => {
    const elemRuns: Record<string, number> = {};
    const elem = handler({
      name: "reindexOne",
      inputSchema: z.string(),
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (item: string) => {
        elemRuns[item] = (elemRuns[item] ?? 0) + 1;
        return { done: true };
      }
    });
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_i, ctx) =>
        ctx.suspend!({
          reason: "human_approval",
          message: "Approve?",
          // All iterations share the element block name, so getBlockOutput
          // resolves to the most recent completed one — non-undefined proves
          // the fan-out results weren't dropped wholesale on replay.
          data: { observed: ctx.getBlockOutput!(elem) }
        })
    });

    const flow = defineFlow({
      kind: "bgwork-crash-foreach",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .forEachBackground((v: { items: string[] }) => v.items, elem)
            .waitForWork()
            .step(gate),
          inputSchema: z.object({ items: z.array(z.string()) })
        }
      }
    })({ id: "bgwork-crash-foreach" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: { items: ["a", "b", "c"] },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect(elemRuns).toEqual({ a: 1, b: 1, c: 1 });
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    const [firstSusp] = await provider.listSuspended({ status: "pending" });
    expect((firstSusp.data as { observed?: unknown }).observed).toEqual({ done: true });

    const suspended = await stores.request.get(requestId);
    await stores.request.set(
      requestId,
      { ...suspended!, status: "interrupted", interruptedAt: Date.now() },
      "any"
    );

    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    // (a) Every completed fan-out iteration was injected, not re-run.
    expect(elemRuns).toEqual({ a: 1, b: 1, c: 1 });
    // (b) The replayed iteration outputs are still observable on recovery.
    const pending = await provider.listSuspended({ status: "pending" });
    const reSusp = pending.find((s) => s.suspensionId !== firstSusp.suspensionId);
    expect(reSusp).toBeDefined();
    expect((reSusp!.data as { observed?: unknown }).observed).toEqual({ done: true });
  });
});

/**
 * The two tests above drain via `.waitForWork()` before the gate, so every
 * iteration is COMPLETE at crash time — they never exercise a fan-out caught
 * genuinely mid-drain. This suite removes the barrier: `.forEachBackground` is
 * dispatched fire-and-forget and the gate suspends while some iterations are
 * still in flight. That pins **Contract A** (FIX-866 §4.2): completed-and-
 * retained iterations are injected on recovery (handler stays at 1 execution);
 * in-flight iterations have no `completed` trace and re-run from scratch
 * (handler climbs to 2) — at-least-once, not exactly-once.
 *
 * Recovery uses the **reachable** `/resume` path (§4.3 primary), NOT the
 * unreachable suspended→`interrupted` flip the two tests above use: a
 * gate-`suspended` request is never swept to `interrupted`
 * (`detectInterruptedRequests` guards on `in_progress`), so that flip models a
 * state production never produces. We pre-resolve the gate suspension and
 * `continueRequest` WITH a `resumeContext`, exactly as the resume route does;
 * the replay re-runs the sequencer from the top and re-dispatches the fan-out.
 *
 * `FSDEV_TRACE_OBSERVABILITY` is forced on: `block_trace` capture (the
 * ReplayLog's only source) is gated on it, so without this the completed
 * iterations would retain no trace and re-run — proving nothing about replay.
 */
describe("attached durable background-work recovery — mid-drain fan-out", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("injects the iterations that completed pre-crash and re-runs the ones caught in flight", async () => {
    // Per-item invocation counter. Incremented at handler ENTRY (before any
    // await), so an iteration that merely STARTED already reads 1 — the
    // contract's distinction is completed-and-injected (stays 1) vs
    // in-flight-and-re-run (climbs to 2), not started-vs-not-started.
    const elemRuns: Record<string, number> = {};

    // First-run gates: a,b are released by the test (they complete and write
    // `completed` traces pre-crash); c,d are NEVER released, so their first-run
    // promises stay parked and cannot advance a counter or emit a completed
    // trace AFTER the simulated crash. This is the harness half of §4.3: the
    // suspend path neither drains nor aborts the work pool, so a live first-run
    // promise that later resolved would contaminate the post-crash assertions.
    // Second-run gates release c,d on the continued run so the terminal drain
    // can settle the re-dispatched work.
    const firstRun: Record<string, Deferred> = {
      a: deferred(),
      b: deferred(),
      c: deferred(),
      d: deferred()
    };
    const secondRun: Record<string, Deferred> = { c: deferred(), d: deferred() };

    const elem = handler({
      name: "reindexOne",
      inputSchema: z.string(),
      outputSchema: z.object({ done: z.boolean(), item: z.string() }),
      execute: async (item: string) => {
        const n = (elemRuns[item] = (elemRuns[item] ?? 0) + 1);
        const barrier = n === 1 ? firstRun[item] : secondRun[item];
        if (barrier !== undefined) await barrier.promise;
        return { done: true, item };
      }
    });

    // No `.waitForWork()` before the gate — the fan-out is genuinely mid-drain
    // when the gate suspends. The gate parks on `readyToSuspend` so the TEST
    // controls the exact crash instant (after a,b's traces flush, while c,d are
    // still parked), removing the flush race a self-timing gate would carry.
    const readyToSuspend = deferred();
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        await readyToSuspend.promise;
        return ctx.suspend!({ reason: "human_approval", message: "Approve?" });
      }
    });

    const flow = defineFlow({
      kind: "bgwork-crash-foreach-middrain",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .forEachBackground((v: { items: string[] }) => v.items, elem)
            .step(gate),
          inputSchema: z.object({ items: z.array(z.string()) })
        }
      }
    })({ id: "bgwork-crash-foreach-middrain" });

    const { stores, provider } = createDurableStores();

    // Kick off the run but DON'T await it: the gate is parked, so the run stays
    // alive while we choreograph which iterations finish before the crash.
    const runPromise = runAction({
      flow,
      actionName: "run",
      input: { items: ["a", "b", "c", "d"] },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    // Let the fan-out dispatch and all four handlers enter, then complete only
    // a (index 0) and b (index 1); let their `completed` traces flush.
    await flush();
    firstRun.a.resolve();
    firstRun.b.resolve();
    await flush();
    // Snapshot the crash: the gate suspends with c,d still in flight.
    readyToSuspend.resolve();
    const initial = await runPromise;
    const requestId = initial.requestId!;

    // All four handlers were ENTERED on the first run (fan-out concurrency ≥ 4).
    expect(elemRuns).toEqual({ a: 1, b: 1, c: 1, d: 1 });
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    // Pre-crash the log carries `completed` iter traces for a,b only; c,d were
    // parked before returning, so their traces are not `completed`.
    const iterCompletedIndices = (items: readonly { type: string }[]): number[] =>
      (items as BlockTraceItem[])
        .filter((i) => i.type === "block_trace" && i.status === "completed")
        .map((t) => parseBlockInstanceId(t.blockInstanceId)?.path ?? "")
        .map((p) => /\/forEachBackground\[\d+\]\/iter\[(\d+)\]$/.exec(p)?.[1])
        .filter((m): m is string => m !== undefined && m !== null)
        .map((m) => Number(m));
    const preItems = (await stores.request.get(requestId))?.items ?? [];
    expect(new Set(iterCompletedIndices(preItems))).toEqual(new Set([0, 1]));

    // Recover via the REACHABLE /resume path: pre-resolve the gate suspension
    // and continue WITH a resumeContext (the shape the resume route drives).
    const [susp] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...susp, status: "approved", resolvedAt: Date.now() });

    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      resumeContext: {
        suspensionId: susp.suspensionId,
        action: "approve",
        data: undefined,
        resumedBy: "reviewer"
      },
      runtimeConfig: { durabilityProvider: provider }
    });
    // Release the RE-DISPATCHED c,d so the resolved-gate → terminal drain can
    // settle them. Resolving before `await finished` is safe whether the
    // handlers have reached their await yet or not. Because this shape reaches
    // terminal (single gate resolved), the terminal drain settles the re-run
    // work before `finished` resolves — so asserting after `finished` is sound
    // (the §4.3 second-run hazard only applies to a re-suspending shape).
    secondRun.c.resolve();
    secondRun.d.resolve();
    await finished;
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    // (a) Completed-before-crash iterations were INJECTED, not re-run (a,b stay
    // at 1). In-flight iterations RE-RAN from scratch on the continued run (c,d
    // climb to 2) — at-least-once, not exactly-once.
    expect(elemRuns).toEqual({ a: 1, b: 1, c: 2, d: 2 });

    // (b) The SPECIFIC completed iteration's recorded output survived recovery,
    // verified per-index via the block_trace logical path — NOT
    // `ctx.getBlockOutput(elem)`, which resolves by block NAME to the most-
    // recent completed sibling and so cannot attribute output to iteration 0
    // (a re-run in-flight iteration could satisfy that check while an earlier
    // completed iteration silently lost its output).
    const finalItems = (await stores.request.get(requestId))?.items ?? [];
    const lookup = buildItemLookup(finalItems as never);
    const iterOutput = (index: number): unknown => {
      const trace = (finalItems as BlockTraceItem[])
        .filter((i) => i.type === "block_trace" && i.status === "completed")
        .find((t) => {
          const path = parseBlockInstanceId(t.blockInstanceId)?.path ?? "";
          return new RegExp(`/forEachBackground\\[\\d+\\]/iter\\[${index}\\]$`).test(path);
        });
      return trace === undefined ? undefined : resolveBlockValue(trace.output as never, lookup);
    };
    // Injected iterations: their pre-crash output is preserved in the log.
    expect(iterOutput(0)).toEqual({ done: true, item: "a" });
    expect(iterOutput(1)).toEqual({ done: true, item: "b" });
    // Re-run iterations: their continued-run output was recorded.
    expect(iterOutput(2)).toEqual({ done: true, item: "c" });
    expect(iterOutput(3)).toEqual({ done: true, item: "d" });
  });
});

/**
 * **Contract B** (FIX-866 §4.2): a failed background task under a COMPLETED
 * parent is *drop-and-log* — it emits a `failed` `block_trace`, is never
 * retried, and does NOT drive the request's terminal status (the foreground
 * result does). Correctness-critical background work opts into
 * `.waitForWork({ failOnError: true })`, which surfaces the failure into the
 * parent (parent → `failed`) — but *drain-then-throw*, not fail-fast: the
 * scope's queued work all settles before the first failure re-throws. A
 * `failed` request is not continuable on the same id; that guard lives in the
 * `/continue` HTTP route, not the bare `continueRequest` helper.
 *
 * `FSDEV_TRACE_OBSERVABILITY` is forced on (as the mid-drain suite does) so the
 * `failed` `block_trace` is retained — trace capture is gated on it.
 */
describe("attached durable background-work recovery — failed background task under a completed parent (Contract B)", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("drops-and-logs a failed `.work()` under a completed parent — request completes, one `failed` trace, no retry", async () => {
    // The failing background handler throws. It must be isolated: its failure
    // is logged and traced, but the foreground result (not the background
    // outcome) drives the request's terminal status.
    let failingRuns = 0;
    const failing = handler({
      name: "reindex",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        failingRuns += 1;
        throw new Error("background reindex boom");
      }
    });
    // A trivial foreground step so the parent reaches `completed` on its own.
    const done = handler({
      name: "done",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true })
    });

    const flow = defineFlow({
      kind: "bgwork-fail-drop-and-log",
      actions: {
        run: {
          // No `.waitForWork()` — the failed task is fire-and-forget and is
          // only awaited by the terminal drain, which isolates its failure.
          block: sequencer({ name: "seq", durable: true }).work(failing).step(done),
          inputSchema: z.any()
        }
      }
    })({ id: "bgwork-fail-drop-and-log" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    await flush();

    // The failed background task does NOT drive request status: the foreground
    // finished, so the request is terminal-`completed`.
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    // Exactly one `failed` `block_trace` for the failing work block, at its
    // logical path `…/work[<step>]`. The enum is
    // `in_progress | completed | failed | planned` — there is no `errored`.
    const items = (await stores.request.get(requestId))?.items ?? [];
    const failedWorkTraces = (items as BlockTraceItem[]).filter(
      (i) =>
        i.type === "block_trace" &&
        i.status === "failed" &&
        /\/work\[\d+\]$/.test(parseBlockInstanceId(i.blockInstanceId)?.path ?? "")
    );
    expect(failedWorkTraces).toHaveLength(1);
    expect(failedWorkTraces[0]!.status).toBe("failed");

    // Not retried: a completed request has no `interrupted` record to continue,
    // so nothing re-runs the failing handler.
    expect(failingRuns).toBe(1);
  });

  it("`.waitForWork({ failOnError: true })` drains-then-throws into the parent (→ failed), and the failed request is not continuable at the route", async () => {
    // Two tasks in one scope: `failing` throws immediately; `slow` blocks on a
    // test-controlled deferred. drain-then-throw means `drainScope` awaits ALL
    // matching entries (Promise.all) before re-throwing the first failure, so
    // the parent must not fail until `slow` has settled. A resolve-order marker
    // encodes that timing — a fail-fast regression would flip it.
    const order: string[] = [];
    let failRuns = 0;
    let slowRuns = 0;
    const slowGate = deferred();

    const failing = handler({
      name: "failing",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        failRuns += 1;
        order.push("fail");
        throw new Error("background boom");
      }
    });
    const slow = handler({
      name: "slow",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => {
        slowRuns += 1;
        await slowGate.promise;
        order.push("slow");
        return { ok: true };
      }
    });

    const flow = defineFlow({
      kind: "bgwork-failonerror-drain-then-throw",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .work(failing)
            .work(slow)
            .waitForWork({ failOnError: true }),
          inputSchema: z.any()
        }
      }
    })({ id: "bgwork-failonerror-drain-then-throw" });

    const { stores, provider } = createDurableStores();

    // Don't await: `waitForWork` parks on `slow` inside `drainScope`.
    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "sess-b2",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    // Track settlement so we can prove the parent does NOT fail while `slow` is
    // still parked. This is the assertion with real teeth: under drain-then-throw
    // `runPromise` stays pending until the whole scope drains; under a fail-fast
    // regression `failing`'s throw would settle it here, before `slow` finishes.
    let runSettled = false;
    void runPromise.then(
      () => {
        runSettled = true;
      },
      () => {
        runSettled = true;
      }
    );

    // Let both tasks dispatch and `failing` throw; `slow` is still parked.
    await flush();
    expect(failRuns).toBe(1); // failing already threw
    expect(slowRuns).toBe(1); // slow entered and is parked on its gate

    // drain-then-throw teeth: give any fail-fast settling a real macrotask tick
    // to land, then assert the run has NOT settled while `slow` is still parked.
    // (The `order` marker below cannot distinguish drain-then-throw from fail-
    // fast on its own — the two orderings coincide under microtask scheduling —
    // so this is the load-bearing check.)
    await new Promise((r) => setTimeout(r, 10));
    expect(runSettled).toBe(false);

    // Release the slow task; only now can `drainScope`'s Promise.all resolve and
    // the first failure re-throw into the parent.
    slowGate.resolve();
    const initial = await runPromise;
    order.push("parent-failed");
    const requestId = initial.requestId!;

    // Parent failure is surfaced (not isolated) once the scope's work drains.
    expect((await stores.request.get(requestId))?.status).toBe("failed");
    // Corroborates the ordering: `slow` ran to completion before the parent failed.
    expect(order).toEqual(["fail", "slow", "parent-failed"]);

    // Non-continuability lives at the ROUTE layer: the `/continue` handler's
    // `interrupted`-only status guard rejects a `failed` record before it ever
    // reaches the host. (The bare `continueRequest` helper has no status check,
    // so asserting there would be vacuous — this drives the route handler.)
    let hostCalled = false;
    const host = {
      continueRequest: async () => {
        hostCalled = true;
        throw new Error("host.continueRequest must not be reached for a failed record");
      }
    } as unknown as InboundTransportHost;

    const response = await handleContinueRequest(
      new Request("http://localhost/continue", { method: "POST" }),
      {
        kind: "continue_request",
        flowKind: "bgwork-failonerror-drain-then-throw",
        sessionId: "sess-b2",
        requestId
      },
      {
        registry: registryFor(flow),
        stores,
        runtimeConfig: { durabilityProvider: provider },
        host
      }
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("failed");
    expect(body.error).toContain("interrupted");
    expect(hostCalled).toBe(false);
  });
});
