/**
 * Tests the FIX-752 risk-mandate worth-it SIZE gate in the PM commit.
 *
 * Drives `commitPortfolioManagerMemo` via `testBlock` with a frozen mandate
 * (`state.riskMandate`) and a seeded reward-to-risk figure (`rewardToRisk`
 * resource), then reads the published PM memo back off the streamed
 * `resource_change` (the `latestMemoDelta` seam). Asserts the mandate:
 *   - clamps `portfolioFit.targetWeightPct` (soft cap, overridable; hard capacity
 *     veto, non-overridable) and never the rating,
 *   - derives the bright-line verdict + gate flags (never trusts the LLM),
 *   - is mandate-blind (no clamp, null mirror) when no mandate is frozen.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitPortfolioManagerMemo } from "../flows/analysis/agents/portfolio-manager/writer";
import { resolveMandate } from "../flows/analysis/lib/risk-mandate";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { valuationSpineResource } from "../flows/analysis/valuation-spine-resource";
import { decisionSnapshotResource } from "../flows/analysis/decision-snapshot-resource";
import { lensConvergenceResource } from "../flows/analysis/agents/lenses/lens-convergence-resource";
import { rewardToRiskResource } from "../flows/analysis/reward-to-risk-resource";
import { PHASE_5_MEMO_KEYS } from "../flows/analysis/registry";
import { latestMemoDelta } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-mandate-test",
  actions: { commitPm: { block: commitPortfolioManagerMemo } },
  session: { stateSchema: sessionStateSchema },
  resources: {
    memos: memosCollection,
    valuationSpine: valuationSpineResource,
    decisionSnapshot: decisionSnapshotResource,
    lensConvergence: lensConvergenceResource,
    rewardToRisk: rewardToRiskResource,
  },
})({ id: "test" });

function baseState(riskMandate: unknown) {
  return {
    ticker: "NVDA",
    date: "2026-05-06",
    costPreset: "fast" as const,
    dataSource: "fixture" as const,
    activePhase: "phase-5" as const,
    maxDebateRounds: 1,
    runComplete: false,
    riskMandate,
  };
}

function seededPmMemo() {
  return {
    status: "writing" as const,
    agentName: "portfolioManager",
    agentTeam: "pm" as const,
    phaseId: "p5",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: new Date().toISOString(),
  };
}

/** A reward-to-risk figure (rewardToRisk resource state). */
function figure(over: Record<string, unknown> = {}) {
  return {
    expectedValuePct: 5,
    expectedGainPct: 10,
    expectedLossPct: 4,
    glr: 2.5,
    lossAdjustedGlr: 1.5,
    worstCaseReturnPct: -10,
    noDownside: false,
    evidenceBasis: "sufficient",
    lossAversion: 2,
    mandateId: null,
    ...over,
  };
}

/** A minimal schema-valid PortfolioDecision with the gate-relevant knobs. */
function decision(opts: {
  finalRating?: "Sell" | "Underweight" | "Hold" | "Overweight" | "Buy";
  targetWeightPct: number;
  decisionConfidence: number;
  overrideReason?: string;
}) {
  const finalRating = opts.finalRating ?? "Hold";
  return {
    label: "PortfolioDecision",
    headline: "Final decision.",
    rating: finalRating,
    metrics: { rating: finalRating, ticker: "NVDA", window: "6 months", size: "x", stop: "$1", target: "$2" },
    body: [{ h: "Executive summary", p: "x", items: null }],
    finalRating,
    decisionSummary: "Test.",
    decisionConfidence: opts.decisionConfidence,
    acceptedAdjustments: {
      sizing: { applied: true, reasoning: "x" },
      holdingPeriod: { applied: true, reasoning: "x" },
      invalidation: { applied: true, reasoning: "x" },
    },
    keyDependencies: [],
    asymmetricEdge: "",
    nearTermCatalyst: "",
    invalidationTrigger: "",
    traderDependencyDispositions: [] as { index: number; status: "carried" | "dropped"; note: string }[],
    primaryScenario: "",
    ratingOverrideReason: "",
    portfolioFit: {
      action: "hold" as const,
      targetWeightPct: opts.targetWeightPct,
      sizingRationale: "x",
      concentrationRisk: "",
      suggestedAccount: "",
      convictionBasis: "",
    },
    mandateFit: {
      rewardToRiskRead: "read",
      sizeStance: "stance",
      mandateOverrideReason: opts.overrideReason ?? "",
    },
    policyFit: {
      allocationRead: "",
      constraintRead: "",
    },
    citations: null,
  };
}

async function commit(opts: {
  mandateId: string | null;
  fig?: Record<string, unknown>;
  decision: Parameters<typeof decision>[0];
  seedFigure?: boolean;
}) {
  const mandate = opts.mandateId == null ? null : resolveMandate(opts.mandateId);
  const resources: Record<string, unknown> = {
    "memos/p5/portfolio-manager": seededPmMemo(),
    "memos/p3/trader": { direction: "flat", dependsOn: null },
  };
  if (opts.seedFigure !== false) {
    resources.rewardToRisk = figure(opts.fig);
  }
  const result = await testBlock(commitPortfolioManagerMemo, {
    input: decision(opts.decision),
    flow: fixtureFlow,
    session: { state: baseState(mandate), resources },
  });
  expect(result.error).toBeNull();
  const delta = latestMemoDelta(result.items, PHASE_5_MEMO_KEYS.portfolioManager.memoKey)!;
  return delta as {
    finalRating: string;
    portfolioFit: { targetWeightPct: number };
    mandateDecision: null | {
      verdict: "clears" | "fails";
      cleared: boolean;
      capacityVetoed: boolean;
      sizeClamped: boolean;
    };
  };
}

describe("Phase 5 risk-mandate size gate", () => {
  it("leaves size untouched and verdict 'clears' when the figure clears the bar", async () => {
    const d = await commit({
      mandateId: "aggressive-growth",
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.6 },
    });
    expect(d.portfolioFit.targetWeightPct).toBe(2.5);
    expect(d.mandateDecision?.verdict).toBe("clears");
    expect(d.mandateDecision?.cleared).toBe(true);
    expect(d.mandateDecision?.sizeClamped).toBe(false);
  });

  it("soft-clamps size to the uncleared cap when the reward-to-risk floor fails", async () => {
    const d = await commit({
      mandateId: "conservative-income", // floor 2.0, unclearedCap 0.5
      fig: { lossAdjustedGlr: 1.5, expectedValuePct: 8, worstCaseReturnPct: -10 },
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.75 },
    });
    expect(d.portfolioFit.targetWeightPct).toBe(0.5);
    expect(d.mandateDecision?.verdict).toBe("fails");
    expect(d.mandateDecision?.cleared).toBe(false);
    expect(d.mandateDecision?.capacityVetoed).toBe(false);
    expect(d.mandateDecision?.sizeClamped).toBe(true);
  });

  it("lifts the soft cap with a stated override reason (verdict clears)", async () => {
    const d = await commit({
      mandateId: "conservative-income",
      fig: { lossAdjustedGlr: 1.5, expectedValuePct: 8, worstCaseReturnPct: -10 },
      decision: {
        targetWeightPct: 2.5,
        decisionConfidence: 0.75,
        overrideReason: "Catalyst the buckets underweight.",
      },
    });
    expect(d.portfolioFit.targetWeightPct).toBe(2.5);
    expect(d.mandateDecision?.verdict).toBe("clears");
    expect(d.mandateDecision?.sizeClamped).toBe(false);
  });

  it("hard-caps size on a capacity breach, even with an override (capacity vetoes appetite)", async () => {
    const d = await commit({
      mandateId: "conservative-income", // maxTolerableLoss 15, vetoCap 0
      fig: { lossAdjustedGlr: 3.0, expectedValuePct: 8, worstCaseReturnPct: -30 },
      decision: {
        targetWeightPct: 2.5,
        decisionConfidence: 0.75,
        overrideReason: "I really want this.",
      },
    });
    expect(d.portfolioFit.targetWeightPct).toBe(0);
    expect(d.mandateDecision?.verdict).toBe("fails");
    expect(d.mandateDecision?.capacityVetoed).toBe(true);
    expect(d.mandateDecision?.sizeClamped).toBe(true);
  });

  it("treats a no-downside distribution as clearing the reward-to-risk floor", async () => {
    const d = await commit({
      mandateId: "aggressive-growth",
      fig: { noDownside: true, glr: null, lossAdjustedGlr: null, expectedValuePct: 8, worstCaseReturnPct: 5 },
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.6 },
    });
    expect(d.mandateDecision?.cleared).toBe(true);
    expect(d.mandateDecision?.verdict).toBe("clears");
    expect(d.portfolioFit.targetWeightPct).toBe(2.5);
  });

  it("fails the bar when decision confidence is below the mandate floor", async () => {
    const d = await commit({
      mandateId: "conservative-income", // confidenceFloor 0.70
      fig: { lossAdjustedGlr: 3.0, expectedValuePct: 8, worstCaseReturnPct: -10 },
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.5 },
    });
    expect(d.mandateDecision?.cleared).toBe(false);
    expect(d.mandateDecision?.verdict).toBe("fails");
    expect(d.portfolioFit.targetWeightPct).toBe(0.5);
  });

  it("still applies the soft gate to a thin-evidence figure (clamps a weak figure down)", async () => {
    // A thin figure (the PM is told it's indicative only) is still gated
    // deterministically: clamping a weak figure DOWN is the cautious default, and
    // the PM retains the override to push back. Relaxing the soft cap on thin
    // would let thin figures size UP — the wrong default for a cautious book.
    const d = await commit({
      mandateId: "conservative-income",
      fig: {
        evidenceBasis: "thin",
        lossAdjustedGlr: 1.0,
        expectedValuePct: 8,
        worstCaseReturnPct: -10,
      },
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.75 },
    });
    expect(d.portfolioFit.targetWeightPct).toBe(0.5);
    expect(d.mandateDecision?.verdict).toBe("fails");
    expect(d.mandateDecision?.sizeClamped).toBe(true);
  });

  it("fails the hard capacity gate CLOSED when the worst case is unknown (null)", async () => {
    // A hard safety gate never silently passes an unknown worst case. (Today this
    // only arises from a future partial patch; the figure always carries a
    // worst case when the forecaster produced buckets.)
    const d = await commit({
      mandateId: "balanced", // capacityVetoCapPct 0.5
      fig: { worstCaseReturnPct: null, lossAdjustedGlr: 3.0, expectedValuePct: 8 },
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.75 },
    });
    expect(d.mandateDecision?.capacityVetoed).toBe(true);
    expect(d.portfolioFit.targetWeightPct).toBe(0.5);
  });

  it("never clamps the rating — a Buy stays a Buy even when the size is gated down", async () => {
    const d = await commit({
      mandateId: "conservative-income",
      fig: { lossAdjustedGlr: 1.0, expectedValuePct: 8, worstCaseReturnPct: -10 },
      decision: { finalRating: "Buy", targetWeightPct: 2.5, decisionConfidence: 0.75 },
    });
    expect(d.finalRating).toBe("Buy");
    expect(d.portfolioFit.targetWeightPct).toBe(0.5); // size gated, rating untouched
  });

  it("is mandate-blind (no clamp, null mirror) when no mandate is frozen", async () => {
    const d = await commit({
      mandateId: null,
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.4 },
    });
    expect(d.portfolioFit.targetWeightPct).toBe(2.5);
    expect(d.mandateDecision ?? null).toBeNull();
  });

  it("is mandate-blind when the reward-to-risk figure is unavailable", async () => {
    const d = await commit({
      mandateId: "conservative-income",
      seedFigure: false,
      decision: { targetWeightPct: 2.5, decisionConfidence: 0.4 },
    });
    expect(d.portfolioFit.targetWeightPct).toBe(2.5);
    expect(d.mandateDecision ?? null).toBeNull();
  });
});
