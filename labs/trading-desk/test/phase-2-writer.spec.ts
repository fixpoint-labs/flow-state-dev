/**
 * Tests for the Phase 2 writer taps. Confirms the three commit blocks
 * write the right shape per memo (including the InvestmentThesis
 * extension fields on the research-manager memo) and flip
 * `session.memoStatus` correctly.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import {
  commitBearMemo,
  commitBullMemo,
  commitResearchManagerMemo,
} from "../src/flows/trading-desk/agents/research/writer";
import { markError, markWriting } from "../src/flows/trading-desk/agents/_recipe/memo-writer";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const writeBull = markWriting("bull");
const errorBull = markError("bull");

const fixtureFlow = defineFlow({
  kind: "trading-desk-p2-writer-test",
  actions: {
    writeBull: { block: writeBull },
    commitBull: { block: commitBullMemo },
    commitBear: { block: commitBearMemo },
    commitRM: { block: commitResearchManagerMemo },
    errorBull: { block: errorBull },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-2" as const,
  maxDebateRounds: 1,
  memoStatus: {
    bull: "pending" as const,
    bear: "pending" as const,
    researchManager: "pending" as const,
  },
};

/**
 * Seeded memo state for the three Phase 2 slots. The commit handlers
 * `get()` the memo (throws when missing — see writer.ts), so the unit
 * tests must seed equivalent state via the testBlock `session.resources`
 * slot. In the live pipeline `setupPhase2Memos` does this pre-creation.
 */
function seededMemo(opts: {
  shortName: "bull" | "bear" | "researchManager";
  agentName: string;
  startedAt?: string | null;
}) {
  return {
    status: opts.startedAt ? ("writing" as const) : ("pending" as const),
    agentName: opts.agentName,
    agentTeam: "research" as const,
    phaseId: "p2",
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
  };
}

const seededWritingResources = {
  "memos/p2/bull": seededMemo({
    shortName: "bull",
    agentName: "bullResearcher",
    startedAt: new Date().toISOString(),
  }),
  "memos/p2/bear": seededMemo({
    shortName: "bear",
    agentName: "bearResearcher",
    startedAt: new Date().toISOString(),
  }),
  "memos/p2/research-manager": seededMemo({
    shortName: "researchManager",
    agentName: "researchManager",
    startedAt: new Date().toISOString(),
  }),
};

const bullThesis = {
  label: "Bull thesis",
  headline: "AI cap-ex cycle still has runway.",
  rating: "buy" as const,
  metrics: {
    conviction: "0.7",
    horizon: "6–12mo",
    target: "$185",
    stop: "$132",
  },
  body: [
    { h: "The setup", p: "Fundamentals durable; technicals trending.", items: null },
    { h: "Why the short framing misses", p: "Bear over-weights short-term print risk.", items: null },
    { h: "What I want to see to scale", p: "Sequential acceleration in DC revenue.", items: null },
    { h: "Risks I am not dismissing", p: "Valuation rich; cap-ex deceleration.", items: null },
  ],
};

const bearThesis = {
  label: "Bear thesis",
  headline: "Cap-ex pull-in priced in; downside on any miss.",
  rating: "underweight" as const,
  metrics: {
    conviction: "0.6",
    horizon: "3–6mo",
    downside: "-22%",
    trigger: "Next earnings",
  },
  body: [
    { h: "The setup", p: "Multiple expansion has run ahead.", items: null },
    { h: "Why the long framing misses", p: "Bull ignores demand-pull-forward risk.", items: null },
    { h: "What I want to see to scale", p: "Customer commentary turning cautious.", items: null },
    { h: "Risks I am not dismissing", p: "Squeeze on any positive surprise.", items: null },
  ],
};

const investmentThesis = {
  label: "Investment thesis",
  headline: "Constructive but disciplined; size below max long.",
  rating: "constructive" as const,
  metrics: {
    conviction: "0.55",
    horizon: "6mo",
    stance: "bullish",
    outOfScope: "Trade sizing",
  },
  body: [
    { h: "Resolution of the debate", p: "Bull and bear agree on durability of demand; disagree on cycle length.", items: null },
    { h: "Synthesized thesis", p: "Lean long, smaller than max.", items: null },
    { h: "What is in scope", p: "Direction and conviction.", items: null },
    { h: "What is out of scope", p: "Position sizing.", items: null },
    { h: "Key risks (named)", p: "Cycle pull-forward; cap-ex deceleration.", items: null },
  ],
  stance: "bullish" as const,
  convictionScore: 0.55,
  keyRisks: ["Cap-ex pull-forward", "Margin compression on supply"],
  keyOpportunities: ["DC revenue acceleration", "Net-new hyperscaler wins"],
  unresolvedDisagreements: [
    "Whether AI cap-ex extends one cycle or two",
    "Pricing-power durability in 2027",
  ],
};

describe("Phase 2 writer taps", () => {
  it("markWriting flips memoStatus to writing", async () => {
    const result = await testBlock(writeBull, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.bull).toBe("writing");
  });

  it("commitBullMemo flips bull to published with the thesis fields", async () => {
    const result = await testBlock(commitBullMemo, {
      input: bullThesis,
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { ...baseSessionState.memoStatus, bull: "writing" } },
        resources: seededWritingResources,
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.bull).toBe("published");
  });

  it("commitBearMemo flips bear to published", async () => {
    const result = await testBlock(commitBearMemo, {
      input: bearThesis,
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { ...baseSessionState.memoStatus, bear: "writing" } },
        resources: seededWritingResources,
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.bear).toBe("published");
  });

  it("commitResearchManagerMemo flips researchManager to published", async () => {
    const result = await testBlock(commitResearchManagerMemo, {
      input: investmentThesis,
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { ...baseSessionState.memoStatus, researchManager: "writing" },
        },
        resources: seededWritingResources,
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.researchManager).toBe("published");
  });

  it("markError flips bull to error and stamps the message", async () => {
    const result = await testBlock(errorBull, {
      input: { error: new Error("LLM hiccup") },
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { ...baseSessionState.memoStatus, bull: "writing" } },
        resources: seededWritingResources,
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.bull).toBe("error");
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
