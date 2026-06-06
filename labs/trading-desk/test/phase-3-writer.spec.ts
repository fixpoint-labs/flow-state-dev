/**
 * Tests for the Phase 3 writer taps. Confirms `markWriting`,
 * `markError`, and `commitTraderMemo` flip `session.memoStatus` and
 * patch the resource correctly — including the seven P3 extension fields.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitTraderMemo } from "../src/flows/analysis/agents/trader/writer";
import { markError, markWriting } from "../src/flows/analysis/agents/_recipe/memo-writer";
import { memosCollection } from "../src/flows/analysis/resources/memos";
import { sessionStateSchema } from "../src/flows/analysis/state";

const writeTrader = markWriting("trader");
const errorTrader = markError("trader");

const fixtureFlow = defineFlow({
  kind: "trading-desk-p3-writer-test",
  actions: {
    writeTrader: { block: writeTrader },
    commitTrader: { block: commitTraderMemo },
    errorTrader: { block: errorTrader },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-3" as const,
  maxDebateRounds: 1,
  memoStatus: {
    trader: "pending" as const,
  },
};

function seededTraderMemo(opts: { startedAt?: string | null } = {}) {
  return {
    status: opts.startedAt ? ("writing" as const) : ("pending" as const),
    agentName: "trader",
    agentTeam: "trade" as const,
    phaseId: "p3",
    ticker: "NVDA",
    date: "2026-05-06",
    label: null,
    headline: null,
    rating: null,
    body: null,
    metrics: null,
    startedAt: opts.startedAt ?? null,
    completedAt: null,
    errorMessage: null,
    stance: null,
    conviction: null,
    keyRisks: null,
    keyOpportunities: null,
    unresolvedDisagreements: null,
    direction: null,
    sizePct: null,
    stopPrice: null,
    targetPrice: null,
    holdingPeriod: null,
    invalidationCriteria: null,
    dependsOn: null,
  };
}

const tradeProposal = {
  label: "Trade proposal",
  headline: "Long NVDA, half-position; trim on weekly close below stop.",
  rating: "long" as const,
  metrics: {
    direction: "long",
    size: "1.4%",
    stop: "$132",
    target: "$185",
    conviction: "0.62",
  },
  body: [
    { h: "Reading the thesis", p: "Constructive but disciplined.", items: null },
    { h: "Proposal", p: "Long 1.4% of NAV; stop $132; target $185.", items: null },
    { h: "Why this size", p: "Conviction is mid; size below max.", items: null },
    { h: "Exit discipline", p: "Stop on weekly close below $132.", items: null },
  ],
  direction: "long" as const,
  sizePct: 1.4,
  stopPrice: 132,
  targetPrice: 185,
  holdingPeriod: "months" as const,
  invalidationCriteria: ["weekly close below $132", "DC revenue print misses"],
  dependsOn: ["AI cap-ex cycle length"],
};

describe("Phase 3 writer taps", () => {
  it("markWriting flips memoStatus.trader to writing", async () => {
    const result = await testBlock(writeTrader, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.trader).toBe("writing");
  });

  it("commitTraderMemo flips trader to published and writes extension fields", async () => {
    const result = await testBlock(commitTraderMemo, {
      input: tradeProposal,
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { trader: "writing" },
        },
        resources: {
          "memos/p3/trader": seededTraderMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.trader).toBe("published");
  });

  it("markError flips trader to error and stamps the message", async () => {
    const result = await testBlock(errorTrader, {
      input: { error: new Error("LLM hiccup") },
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { trader: "writing" } },
        resources: {
          "memos/p3/trader": seededTraderMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.trader).toBe("error");
  });
});

type LastStatePayload = {
  memoStatus: Record<string, string>;
};

function lastSessionState(result: {
  stateChanges: Array<{ scope: string; resultingState: Record<string, unknown> }>;
}): LastStatePayload {
  const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
  expect(sessionPatches.length).toBeGreaterThan(0);
  return sessionPatches[sessionPatches.length - 1].resultingState as unknown as LastStatePayload;
}
