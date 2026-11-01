/**
 * What a harness session's turn spent, and the windows its runs heard about
 * (FIX-2398), against a stub harness that reports as every harness does.
 *
 * Why it matters: a person working a session picks a harness by what it
 * costs, so each turn's record carries the tokens and charge the vendor
 * reported, however the turn ended, and a subscription window a run heard
 * about is readable afterwards. Read off the session state a page reads,
 * never off the harness's own report.
 *
 * Red states produced before these were trusted:
 *   - drop the `turn-spend` step (and the failure write's spend): every `spend` here is null.
 *   - drop `onUsage` from the feeds: the usage query lists no window.
 *   - write the spend from the flow's `onFinished` instead: the request's
 *     terminal status is published before the spend lands.
 *   - keep a record's first end (skip a record that already ended), or count
 *     only the ledger's runs: a continued turn reads 10 tokens, not 20.
 *   - read model calls from the request's pending slice: a turn continued
 *     after a disconnect loses the calls its first run made.
 */
import { DEFAULT_ORG_ID, generator, handler, sequencer } from "@flow-state-dev/core";
import { reportHarnessSpend, type HarnessBlock, type HarnessCallbackContext } from "@flow-state-dev/core/types";
import { continueRequest, createCheckpointDurabilityProvider, createFlowRegistry, createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { harnessSessionFlow, type HarnessSessionFeeds, type HarnessSessionState } from "../src";

type Stores = ReturnType<typeof createInMemoryStores>;

/** What the stub harness does in its run. */
interface Script {
  /** Reported as the run's spend, as a harness reports from its `finally`. Unset: it reports none. */
  spend?: { inputTokens: number; outputTokens: number; costUsd: number | null; billing: "api-key" | "subscription" };
  /** The run then throws, as a harness that failed does. */
  fail?: boolean;
  /** A window heard during the run. */
  window?: boolean;
  /** An earlier run of this request already ended the turn with this run, as a turn continued after an interruption finds it. */
  earlier?: { runId?: string; inputTokens: number; outputTokens: number; costUsd: number | null };
  /** The run reports with no id, as a harness that settles each report does. */
  anonymous?: boolean;
  /** The run writes its report twice, as a harness reports its running total. */
  reportTwice?: boolean;
}

const stubAgent = (script: Script) => (feeds: HarnessSessionFeeds) =>
  handler({
    name: "stub-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async (_input, ctx) => {
      const harnessCtx = ctx as unknown as HarnessCallbackContext;
      await feeds.resume(harnessCtx);
      const earlier = script.earlier;
      if (earlier !== undefined) {
        const requestId = harnessCtx.request.identity.id;
        await harnessCtx.session.atomicState((state) => {
          const s = state as HarnessSessionState;
          const turn = s.turns?.[requestId];
          const run = { harness: "stub", model: "stub-model", ...earlier, billing: "api-key" as const };
          return { ...s, turns: { ...s.turns, [requestId]: { ...turn!, endedAt: 1, spentRuns: [run] } } };
        });
      }
      if (script.window === true) {
        await feeds.onUsage(
          { harness: "stub", window: { id: "five_hour", label: "5h", minutes: 300, usedPercent: 42, level: "ok", resetsAt: null }, observedAt: Date.now(), runStartedAt: Date.now() - 10, accountId: "acct" },
          harnessCtx,
        );
      }
      try {
        if (script.fail === true) throw new Error("the run broke");
        return { outcome: "completed" };
      } finally {
        if (script.spend !== undefined) {
          if (script.reportTwice === true) reportHarnessSpend(ctx, { runId: "run-1", harness: "stub", model: "stub-model", ...script.spend, inputTokens: 1, outputTokens: 1 });
          reportHarnessSpend(ctx, { ...(script.anonymous === true ? {} : { runId: "run-1" }), harness: "stub", model: "stub-model", ...script.spend });
        }
      }
    },
  }) as unknown as HarnessBlock;

const workspace = { provision: async () => "/nowhere", locate: () => "/nowhere", branch: () => null };

function flowOf(script: Script) {
  return harnessSessionFlow({ kind: "stub-session", workspace, agent: stubAgent(script) });
}

async function born(stores: Stores, sessionId: string) {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    { id: sessionId, flowKind: "stub-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
    "any" as never,
  );
}

async function run(stores: Stores, sessionId: string, script: Script, actionName = "turn", input: unknown = { prompt: "hello" }) {
  if ((await stores.session.get(sessionId)) === undefined) await born(stores, sessionId);
  return runAction({ flow: flowOf(script), actionName, input, userId: "u", orgId: DEFAULT_ORG_ID, sessionId, stores, runtimeConfig: {} } as never);
}

/** The only turn's record, as a page reads it from session state. */
async function onlyTurn(stores: Stores, sessionId: string) {
  const state = (await stores.session.get(sessionId))?.state as HarnessSessionState;
  const turns = Object.values(state.turns ?? {});
  expect(turns).toHaveLength(1);
  return turns[0]!;
}

describe("a harness session turn's spend", () => {
  it("is on the turn's record when it ends: the model, the tokens and the vendor's charge, and when it ended", async () => {
    const stores = createInMemoryStores();
    await run(stores, "s-paid", { spend: { inputTokens: 1200, outputTokens: 300, costUsd: 0.04, billing: "api-key" } });
    const turn = await onlyTurn(stores, "s-paid");
    expect(turn.spend).toMatchObject({ harness: "stub", model: "stub-model", inputTokens: 1200, outputTokens: 300, costUsd: 0.04, unreported: false, live: false });
    expect(turn.endedAt).not.toBeNull();
    expect(turn.endedAt!).toBeGreaterThanOrEqual(turn.at!);
  });

  it("reads no dollar figure for a subscription run, never $0", async () => {
    const stores = createInMemoryStores();
    await run(stores, "s-sub", { spend: { inputTokens: 50, outputTokens: 5, costUsd: null, billing: "subscription" } });
    const turn = await onlyTurn(stores, "s-sub");
    expect(turn.spend?.inputTokens).toBe(50);
    expect(turn.spend?.costUsd).toBeNull();
  });

  it("is recorded for a turn that failed too, since its tokens were spent all the same", async () => {
    const stores = createInMemoryStores();
    await run(stores, "s-failed", { fail: true, spend: { inputTokens: 700, outputTokens: 70, costUsd: 0.01, billing: "api-key" } }).catch(() => undefined);
    const turn = await onlyTurn(stores, "s-failed");
    expect(turn.error).toBe("the run broke");
    expect(turn.spend).toMatchObject({ inputTokens: 700, outputTokens: 70, costUsd: 0.01 });
  });

  it("is null for a turn whose harness reported nothing, with its end still recorded", async () => {
    const stores = createInMemoryStores();
    await run(stores, "s-none", {});
    const turn = await onlyTurn(stores, "s-none");
    expect(turn.spend).toBeNull();
    expect(turn.endedAt).not.toBeNull();
  });
  // A turn continued after an interruption runs again under the same request,
  // whose ledger then holds only the new run: the turn still counts both.
  it("counts the runs of an earlier run of its request too, once each", async () => {
    const stores = createInMemoryStores();
    await run(stores, "s-continued", {
      earlier: { runId: "run-0", inputTokens: 10, outputTokens: 1, costUsd: 0.1 },
      reportTwice: true,
      spend: { inputTokens: 10, outputTokens: 1, costUsd: 0.1, billing: "api-key" },
    });
    const turn = await onlyTurn(stores, "s-continued");
    expect(turn.spend).toMatchObject({ inputTokens: 20, outputTokens: 2 });
    expect(turn.spend?.costUsd).toBeCloseTo(0.2);
    expect(turn.endedAt).toBeGreaterThan(1);
  });

  it("keeps an earlier run with no id even when its totals match this one's", async () => {
    const stores = createInMemoryStores();
    await run(stores, "s-anonymous", {
      earlier: { inputTokens: 10, outputTokens: 1, costUsd: 0.1 },
      anonymous: true,
      spend: { inputTokens: 10, outputTokens: 1, costUsd: 0.1, billing: "api-key" },
    });
    const turn = await onlyTurn(stores, "s-anonymous");
    expect(turn.spend).toMatchObject({ inputTokens: 20, outputTokens: 2 });
  });

  // A disconnect ends the request's first run, which hands its spend on; the
  // continuation replays the finished model call without making it again, so
  // the turn's spend is the request's whole count, not what is left to hand on.
  it("keeps the model calls a turn made before a disconnect when the turn is continued", async () => {
    const stores = createInMemoryStores();
    await born(stores, "s-disconnect");
    let waited = false;
    const waitOnce = handler({
      name: "wait-once",
      inputSchema: z.any(),
      execute: async (value, ctx) => {
        if (waited) return value;
        waited = true;
        await new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
        return value;
      },
    });
    const agent = () =>
      sequencer({ name: "stub-harness", durable: true, inputSchema: z.object({ prompt: z.string() }) })
        .step(generator({ name: "ask", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" }))
        .step(waitOnce)
        .step(handler({ name: "done", inputSchema: z.any(), execute: () => ({ outcome: "completed" }) })) as unknown as HarnessBlock;
    const flow = harnessSessionFlow({ kind: "stub-session", workspace, agent });
    const modelResolver = Object.assign(
      () => ({ modelId: "openai/gpt-6-luna", generate: async () => ({ text: "ok", usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }) }),
      { resolveId: (id: string) => id },
    );
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const runtimeConfig = { durabilityProvider: provider, modelResolver };
    const disconnect = new AbortController();

    const first = runAction({ flow, actionName: "turn", input: { prompt: "hello" }, userId: "u", orgId: DEFAULT_ORG_ID, sessionId: "s-disconnect", requestId: "r-disconnect", signal: disconnect.signal, stores, runtimeConfig } as never);
    while (!waited) await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect.abort();
    await (first as Promise<unknown>).catch(() => undefined);
    expect((await stores.request.get("r-disconnect"))?.status).toBe("interrupted");
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({ requestId: "r-disconnect", stores, flowRegistry: registry, runtimeConfig } as never);
    await finished;

    expect((await stores.request.get("r-disconnect"))?.status).toBe("completed");
    const turn = await onlyTurn(stores, "s-disconnect");
    expect(turn.spend).toMatchObject({ model: "openai/gpt-6-luna", inputTokens: 10, outputTokens: 2 });
  });

  // A page refreshes the session when it sees the turn end, so the spend must
  // be stored by the time the request publishes its terminal status.
  it("is stored before the request publishes that it completed", async () => {
    const stores = createInMemoryStores();
    await born(stores, "s-order");
    const seen: Array<Promise<unknown>> = [];
    const persist = stores.request.persistEvents.bind(stores.request);
    stores.request.persistEvents = (requestId, events) => {
      if (events.some((event) => (event as { type?: string }).type === "request.completed")) {
        seen.push(stores.session.get("s-order").then((session) => Object.values((session?.state as HarnessSessionState).turns ?? {})[0]?.spend ?? null));
      }
      return persist(requestId, events);
    };
    await run(stores, "s-order", { spend: { inputTokens: 10, outputTokens: 2, costUsd: 0.001, billing: "api-key" } });
    expect(seen).toHaveLength(1);
    expect(await seen[0]).toMatchObject({ inputTokens: 10, outputTokens: 2 });
  });
});

describe("a window a turn's run heard about", () => {
  it("is readable afterwards through the session flow's usage query", async () => {
    const stores = createInMemoryStores();
    await run(stores, "s-window", { window: true });
    const result = (await run(stores, "s-window", {}, "harnessUsage", {})) as { result?: unknown; output?: unknown };
    const answer = JSON.stringify(result);
    expect(answer).toContain("five_hour");
    expect(answer).toContain("42");
  });
});
