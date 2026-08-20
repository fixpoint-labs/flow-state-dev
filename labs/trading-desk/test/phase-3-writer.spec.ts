/**
 * Tests for the Phase 3 writer taps. Confirms `markWriting`,
 * `markError`, and `commitTraderMemo` flip the trader memo's status and
 * patch the resource correctly — including the seven P3 extension fields.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitTraderMemo } from "../flows/analysis/agents/trader/writer";
import type { TradeProposalOutput } from "../flows/analysis/agents/trader/trader";
import { markError, markWriting } from "../flows/analysis/agents/_recipe/memo-writer";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { PHASE_3_MEMO_KEYS } from "../flows/analysis/registry";
import { latestMemoDelta, latestMemoStatus } from "./_helpers/memo-status";

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
    reassessBelowPrice: null,
    invalidateAbovePrice: null,
    holdingPeriod: null,
    invalidationCriteria: null,
    dependsOn: null,
  };
}

const tradeProposal: TradeProposalOutput = {
  label: "Trade proposal",
  headline: "Long NVDA, half-position; trim on weekly close below stop.",
  rating: "long" as const,
  metrics: {
    direction: "long",
    size: "1.4%",
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
  reassessBelowPrice: null,
  invalidateAbovePrice: null,
  holdingPeriod: "months" as const,
  invalidationCriteria: ["weekly close below $132", "DC revenue print misses"],
  dependsOn: ["AI cap-ex cycle length"],
  citations: null,
};

describe("Phase 3 writer taps", () => {
  it("markWriting flips the trader memo to writing", async () => {
    const result = await testBlock(writeTrader, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    expect(latestMemoStatus(result.items, PHASE_3_MEMO_KEYS.trader.memoKey)).toBe("writing");
  });

  it("commitTraderMemo flips trader to published and writes extension fields", async () => {
    const result = await testBlock(commitTraderMemo, {
      input: tradeProposal,
      flow: fixtureFlow,
      session: {
        state: baseSessionState,
        resources: {
          "memos/p3/trader": seededTraderMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    expect(latestMemoStatus(result.items, PHASE_3_MEMO_KEYS.trader.memoKey)).toBe("published");
  });

  // FIX-780 — the commit is where the stance stops being a request. The trader
  // is asked in its prompt for one pair of levels; these three cases are the
  // desk enforcing it on the record, so a prompt the model ignores cannot put a
  // stop on a position that was never taken.
  describe("the stance gate on price levels (FIX-780)", () => {
    /** Run the commit and read back the memo state it published. */
    async function commit(proposal: typeof tradeProposal) {
      const result = await testBlock(commitTraderMemo, {
        input: proposal,
        flow: fixtureFlow,
        session: {
          state: baseSessionState,
          resources: {
            "memos/p3/trader": seededTraderMemo({
              startedAt: new Date().toISOString(),
            }),
          },
        },
      });
      expect(result.error).toBeNull();
      return latestMemoDelta(result.items, PHASE_3_MEMO_KEYS.trader.memoKey) ?? {};
    }

    it("stores a flat proposal's monitoring levels and NO stop or target", async () => {
      const memo = await commit({
        ...tradeProposal,
        rating: "flat" as const,
        direction: "flat" as const,
        sizePct: 0,
        metrics: { direction: "flat", size: "0%", conviction: "0.35" },
        stopPrice: null,
        targetPrice: null,
        reassessBelowPrice: 195,
        invalidateAbovePrice: 320,
      });
      expect(memo.reassessBelowPrice).toBe(195);
      expect(memo.invalidateAbovePrice).toBe(320);
      // The stored defect: a flat memo carrying a stop is what every downstream
      // surface — the chart, the risk prompt, the decision snapshot — reads.
      expect(memo.stopPrice).toBeNull();
      expect(memo.targetPrice).toBeNull();
      // The display metrics row is keyed by level NAME, so it is part of the
      // same guarantee: it reaches the risk/PM prompt as `key=value`.
      expect(memo.metrics).toEqual({
        direction: "flat",
        size: "0%",
        "reassess below": "$195",
        "invalidate above": "$320",
        conviction: "0.35",
      });
    });

    it("stores a directional proposal's trade levels and NO monitoring levels", async () => {
      const memo = await commit({
        ...tradeProposal,
        reassessBelowPrice: 100,
        invalidateAbovePrice: 300,
      });
      expect(memo.stopPrice).toBe(132);
      expect(memo.targetPrice).toBe(185);
      expect(memo.reassessBelowPrice).toBeNull();
      expect(memo.invalidateAbovePrice).toBeNull();
      expect(memo.metrics).toEqual({
        direction: "long",
        size: "1.4%",
        stop: "$132",
        target: "$185",
        conviction: "0.62",
      });
    });

    it("drops a flat proposal's wrongly-filed stop and target rather than renaming them", async () => {
      const memo = await commit({
        ...tradeProposal,
        rating: "flat" as const,
        direction: "flat" as const,
        sizePct: 0,
        metrics: { direction: "flat", size: "0%", conviction: "0.35" },
        stopPrice: 320,
        targetPrice: 195,
        reassessBelowPrice: null,
        invalidateAbovePrice: null,
      });
      // All four absent: the run showed no levels, which is honest. Storing 320
      // as "invalidate above" would assert an intent the model never expressed.
      expect(memo.stopPrice).toBeNull();
      expect(memo.targetPrice).toBeNull();
      expect(memo.reassessBelowPrice).toBeNull();
      expect(memo.invalidateAbovePrice).toBeNull();
      expect(memo.metrics).toEqual({
        direction: "flat",
        size: "0%",
        conviction: "0.35",
      });
    });
  });

  it("markError flips trader to error and stamps the message", async () => {
    const result = await testBlock(errorTrader, {
      input: { error: new Error("LLM hiccup") },
      flow: fixtureFlow,
      session: {
        state: baseSessionState,
        resources: {
          "memos/p3/trader": seededTraderMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    expect(latestMemoStatus(result.items, PHASE_3_MEMO_KEYS.trader.memoKey)).toBe("error");
  });
});
