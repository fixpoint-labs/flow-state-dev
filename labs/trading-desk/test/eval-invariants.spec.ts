/**
 * Tests for the deterministic invariant layer (`eval/invariants.ts`, FIX-790).
 *
 * Follows the `composite-math.spec.ts` model: a coherent stored-run bundle in,
 * a result object out, with per check-group cases — a passing fixture, a
 * violated fixture (one field mutated so a specific hard check fails), and a
 * skipped-substrate fixture (the group's inputs absent → `skipped`, never
 * `fail`). The passing bundle is built so every recompute check (reward-to-risk,
 * mandate gates, rating band) is genuinely CONSISTENT — it recomputes the stored
 * figures with the same libs the pipeline uses, so a green result proves
 * consistency, not a stubbed comparison.
 */
import { describe, expect, it } from "vitest";
import { portfolioMandateSchema } from "../domain/portfolio/schema/portfolio-mandate-schema";
import { ALL_MEMO_KEYS } from "../flows/analysis/registry";
import type { MemoState } from "../flows/analysis/resources";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";
import type { RunSummary } from "../flows/analysis/run-summary";
import { computeMandateGates, clampTargetWeight } from "../flows/analysis/lib/mandate-gates";
import { computeRewardToRisk } from "../flows/analysis/lib/reward-to-risk";
import { ratingBandFor } from "../flows/analysis/lib/rating-engine";
import { resolveMandate } from "../flows/analysis/lib/risk-mandate";
import type { ValuationSpineState } from "../flows/analysis/valuation-spine-resource";
import { checkRun } from "../eval/invariants";
import type { CheckResult } from "../eval/types";

const MANDATE = resolveMandate("balanced")!;
const SCENARIOS = [
  { name: "Bull", probability: 0.4, trigger: "x", triggerSource: "phase1" as const, expectedOutcome: "up", expectedReturnPct: 30, tradeBehavior: "hold" },
  { name: "Base", probability: 0.4, trigger: "x", triggerSource: "phase1" as const, expectedOutcome: "flat", expectedReturnPct: 5, tradeBehavior: "hold" },
  { name: "Bear", probability: 0.2, trigger: "x", triggerSource: "phase1" as const, expectedOutcome: "down", expectedReturnPct: -10, tradeBehavior: "trim" },
];
const RR = computeRewardToRisk({
  scenarios: SCENARIOS.map((s) => ({ probability: s.probability, expectedReturnPct: s.expectedReturnPct })),
  lossAversion: MANDATE.lossAversion,
});
const DECISION_CONFIDENCE = 0.72;
const GATES = computeMandateGates({ mandate: MANDATE, rr: RR, decisionConfidence: DECISION_CONFIDENCE, override: false });
const CLAMP = clampTargetWeight({ targetWeightPct: 1.4, mandate: MANDATE, gates: GATES, override: false });
const BAND = ratingBandFor("Overweight", false); // { floor: "Hold", ceiling: "Buy" }
const POLICY_MANDATE = portfolioMandateSchema.parse({
  objectives: { riskTolerance: "moderate" },
  constraints: { maxPositionWeightPct: 1 },
  rebalancing: {},
  timeHorizon: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const SPINE: ValuationSpineState = {
  ticker: "NVDA",
  asOf: "2026-05-06",
  expectedReturn: { shareholderYield: 0.01, sustainableGrowth: 0.14, expectedReturn: 0.15, hurdle: 0.09, excessReturn: 0.06, basis: "fcf", lowConfidence: false },
  fairValue: { justifiedPE: 30, fairValue: 150, marginOfSafety: 0.3, method: "justified-pe", available: true },
  dcf: null,
  triangulation: null,
  setupScore: { score: 70, value: 60, quality: 70, factor: 70, momentum: 70, evidenceBasis: "sufficient" },
  envelope: { absoluteRating: "Hold", relativeRating: "Overweight", implied: "Overweight", floor: BAND.floor, ceiling: BAND.ceiling, rationale: "x" },
  valuationMethod: "ev-multiples",
  evidenceBasis: "sufficient",
};

function basePublished(entry: (typeof ALL_MEMO_KEYS)[keyof typeof ALL_MEMO_KEYS]): MemoState {
  return {
    status: "published",
    agentName: entry.agentName,
    agentTeam: entry.agentTeam,
    ticker: "NVDA",
    date: "2026-05-06",
    phaseId: entry.phaseId,
    // Analyst memos carry a dataQuality; the citations check reads it.
    dataQuality: entry.phaseId === "p1" ? "full" : null,
  } as MemoState;
}

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    ticker: "NVDA",
    date: "2026-05-06",
    costPreset: "fast",
    dataSource: "fixture",
    mandateId: "balanced",
    sessionId: "run_test",
    status: "completed",
    stopReason: null,
    stopMessage: null,
    durationMs: null,
    exitCode: null,
    error: null,
    capturePath: null,
    ranAt: "2026-06-25T00:00:00.000Z",
    finalRating: "Overweight",
    decisionConfidence: DECISION_CONFIDENCE,
    targetWeightPct: CLAMP.targetWeightPct,
    direction: "long",
    sizePct: 4,
    stopPrice: 100,
    targetPrice: 150,
    holdingPeriod: "quarters",
    decidedAt: "2026-06-25T00:00:00.000Z",
    mandateVerdict: GATES.verdict,
    capacityVetoed: !GATES.capacityCleared,
    rewardToRiskLossAdjustedGlr: RR.lossAdjustedGlr,
    worstCaseReturnPct: RR.worstCaseReturnPct,
    hasStandingThesis: null,
    mandatePresent: false,
    policyVerdict: null,
    positionCapClamped: null,
    excluded: null,
    preGatePolicyTargetPct: null,
    evidenceVerdict: null,
    memos: [],
    memoErrors: 0,
    ...overrides,
  };
}

/** A coherent completed-run bundle (fast preset, no thesis) where every hard
 *  invariant passes. */
function healthyBundle(): RunArtifactsBundle {
  const memos = Object.values(ALL_MEMO_KEYS).map((entry) => {
    // The lens pack (p2b) and Phase-6 audit are absent on a fast, no-thesis run.
    if (entry.phaseId === "p2b" || entry.collectionKey === ALL_MEMO_KEYS.thesisAlignment.collectionKey) {
      return { key: entry.collectionKey, state: null };
    }
    const state = basePublished(entry);
    if (entry.collectionKey === ALL_MEMO_KEYS.scenarioForecast.collectionKey) {
      return { key: entry.collectionKey, state: { ...state, scenarios: SCENARIOS, probabilitySum: 1.0 } as MemoState };
    }
    if (entry.collectionKey === ALL_MEMO_KEYS.trader.collectionKey) {
      return {
        key: entry.collectionKey,
        state: { ...state, direction: "long", sizePct: 4, stopPrice: 100, targetPrice: 150, holdingPeriod: "quarters" } as MemoState,
      };
    }
    if (entry.collectionKey === ALL_MEMO_KEYS.portfolioManager.collectionKey) {
      return {
        key: entry.collectionKey,
        state: {
          ...state,
          finalRating: "Overweight",
          decisionConfidence: DECISION_CONFIDENCE,
          modelImpliedRating: "Overweight",
          ratingBand: { floor: BAND.floor, ceiling: BAND.ceiling },
          ratingClamped: false,
          ratingOverrideReason: null,
          portfolioFit: {
            action: "add",
            targetWeightPct: CLAMP.targetWeightPct,
            sizingRationale: "x",
            concentrationRisk: "x",
            convictionBasis: "x",
            suggestedAccount: "",
            currentWeightPct: 0.5,
            weightDeltaPct: CLAMP.targetWeightPct - 0.5,
            hasPortfolioContext: true,
            snapshotAsOf: null,
          },
          mandateDecision: {
            mandateId: MANDATE.id,
            mandateLabel: MANDATE.label,
            verdict: GATES.verdict,
            cleared: GATES.cleared,
            capacityVetoed: !GATES.capacityCleared,
            sizeClamped: CLAMP.sizeClamped,
            lossAdjustedGlr: RR.lossAdjustedGlr,
            expectedValuePct: RR.expectedValuePct,
            worstCaseReturnPct: RR.worstCaseReturnPct,
            noDownside: RR.noDownside,
            evidenceBasis: RR.evidenceBasis,
            rewardToRiskRead: "read",
            sizeStance: "stance",
            overrideReason: "",
          },
        } as MemoState,
      };
    }
    return { key: entry.collectionKey, state };
  });

  return {
    summary: summary(),
    valuationSpine: SPINE,
    rewardToRisk: { ...RR, lossAversion: MANDATE.lossAversion, mandateId: MANDATE.id },
    lensConvergence: null,
    decisionSnapshot: {
      ticker: "NVDA",
      asOfDate: "2026-05-06",
      finalRating: "Overweight",
      decisionConfidence: DECISION_CONFIDENCE,
      decisionSummary: "x",
      direction: "long",
      entryPrice: null,
      stopPrice: 100,
      targetPrice: 150,
      sizePct: 4,
      holdingPeriod: "quarters",
      mandateId: "balanced",
      mandateVerdict: GATES.verdict,
      rewardToRiskLossAdjustedGlr: RR.lossAdjustedGlr,
      worstCaseReturnPct: RR.worstCaseReturnPct,
      capacityVetoed: !GATES.capacityCleared,
      hasStandingThesis: null,
      mandatePresent: false,
      policyVerdict: null,
      positionCapClamped: null,
      excluded: null,
      preGatePolicyTargetPct: null,
      evidenceVerdict: null,
      decidedAt: "2026-06-25T00:00:00.000Z",
      outcomeRealizedPrice: null,
      outcomeAsOf: null,
      outcomeVerdict: null,
    },
    riskMandate: MANDATE,
    portfolioMandate: null,
    householdTickerWeightPct: null,
    citationIntegrity: null,
    hasUserThesis: false,
    p2Contributions: { entries: [{ round: 1, agentName: "bullResearcher", text: "Bull opens." }] },
    memos,
  };
}

function byId(checks: CheckResult[], id: string): CheckResult | undefined {
  return checks.find((r) => r.id === id);
}

describe("checkRun — healthy bundle", () => {
  it("passes every hard invariant on a coherent completed run", () => {
    const report = checkRun(healthyBundle());
    const hardFails = report.checks.filter((r) => r.severity === "hard" && r.status === "fail");
    expect(hardFails, JSON.stringify(hardFails, null, 2)).toHaveLength(0);
    expect(report.hard.failed).toBe(0);
    expect(report.hard.passed).toBeGreaterThan(5);
  });
});

describe("checkRun — rating-envelope", () => {
  it("fails when the final rating is outside the band with no override", () => {
    const b = healthyBundle();
    b.decisionSnapshot!.finalRating = "Sell"; // outside [Hold, Buy]
    const report = checkRun(b);
    expect(byId(report.checks, "rating-envelope/final-within-band")?.status).toBe("fail");
  });

  it("fails when a self-consistent stored implied rating and band drift from the inputs", () => {
    const b = healthyBundle();
    const buyBand = ratingBandFor("Buy", false);
    b.valuationSpine!.envelope = {
      ...b.valuationSpine!.envelope,
      absoluteRating: "Buy",
      relativeRating: "Overweight",
      implied: "Buy",
      ...buyBand,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "rating-envelope/band-recompute")?.status).toBe("fail");
  });

  it("skips the envelope checks when there is no decision snapshot", () => {
    const b = healthyBundle();
    b.decisionSnapshot = null;
    const report = checkRun(b);
    expect(byId(report.checks, "rating-envelope/final-within-band")?.status).toBe("skipped");
  });

  it("fails when a run with a spine drops its PM rating-band mirror (not skipped)", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    (b.memos.find((m) => m.key === pmKey)!.state as MemoState).ratingBand = null;
    const report = checkRun(b);
    expect(byId(report.checks, "rating-envelope/pm-band-present")?.status).toBe("fail");
    // The envelope checks still run off the spine fallback, not skipped.
    expect(byId(report.checks, "rating-envelope/final-within-band")?.status).toBe("pass");
  });

  it("uses the spine band when a drifted PM mirror would admit the final rating", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.ratingBand = { floor: "Sell", ceiling: "Buy" };
    pm.finalRating = "Sell";
    b.decisionSnapshot!.finalRating = "Sell";
    const report = checkRun(b);
    expect(byId(report.checks, "rating-envelope/final-within-band")?.status).toBe("fail");
  });
});

describe("checkRun — scenario", () => {
  it("fails when the stored probabilities do not sum to ~1", () => {
    const b = healthyBundle();
    const scenarioKey = ALL_MEMO_KEYS.scenarioForecast.collectionKey;
    const memo = b.memos.find((m) => m.key === scenarioKey)!;
    (memo.state as MemoState).scenarios = [
      { ...SCENARIOS[0], probability: 0.4 },
      { ...SCENARIOS[1], probability: 0.4 },
      { ...SCENARIOS[2], probability: 0.05 }, // sums to 0.85
    ];
    const report = checkRun(b);
    expect(byId(report.checks, "scenario/probability-sum")?.status).toBe("fail");
  });

  it("fails when a published scenario memo omits its raw probability sum", () => {
    const b = healthyBundle();
    const scenarioKey = ALL_MEMO_KEYS.scenarioForecast.collectionKey;
    const memo = b.memos.find((m) => m.key === scenarioKey)!;
    (memo.state as MemoState).probabilitySum = null;
    const report = checkRun(b);
    expect(byId(report.checks, "scenario/raw-sum")?.status).toBe("fail");
  });

  it("fails when a published scenario memo omits its scenario buckets", () => {
    const b = healthyBundle();
    const scenarioKey = ALL_MEMO_KEYS.scenarioForecast.collectionKey;
    const memo = b.memos.find((m) => m.key === scenarioKey)!;
    (memo.state as MemoState).scenarios = null;
    const report = checkRun(b);
    expect(byId(report.checks, "scenario/count")?.status).toBe("fail");
  });

  it("skips scenario checks when there is no forecaster memo", () => {
    const b = healthyBundle();
    const scenarioKey = ALL_MEMO_KEYS.scenarioForecast.collectionKey;
    b.memos = b.memos.map((m) => (m.key === scenarioKey ? { ...m, state: null } : m));
    const report = checkRun(b);
    expect(byId(report.checks, "scenario/count")?.status).toBe("skipped");
  });
});

describe("checkRun — reward-risk", () => {
  it("fails when the stored figure drifts from the recomputation", () => {
    const b = healthyBundle();
    b.rewardToRisk!.lossAdjustedGlr = (RR.lossAdjustedGlr ?? 0) + 5; // drift
    const report = checkRun(b);
    expect(byId(report.checks, "reward-risk/recompute")?.status).toBe("fail");
  });

  it("skips the snapshot-mirror check on a mandate-blind run", () => {
    const b = healthyBundle();
    b.decisionSnapshot!.mandateVerdict = null; // mandate-blind
    b.decisionSnapshot!.rewardToRiskLossAdjustedGlr = null;
    b.decisionSnapshot!.worstCaseReturnPct = null;
    const report = checkRun(b);
    expect(byId(report.checks, "reward-risk/snapshot-mirror")?.status).toBe("skipped");
  });

  it("fails populated snapshot reward mirrors on a mandate-blind run", () => {
    const b = healthyBundle();
    b.decisionSnapshot!.mandateVerdict = null;
    b.decisionSnapshot!.rewardToRiskLossAdjustedGlr = 2;
    b.decisionSnapshot!.worstCaseReturnPct = null;
    const report = checkRun(b);
    expect(byId(report.checks, "reward-risk/snapshot-mirror")?.status).toBe("fail");
  });
});

describe("checkRun — mandate", () => {
  it("fails when the committed size exceeds the applicable cap", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    // Force an uncleared, no-override run whose size ignores the uncleared cap.
    pm.mandateDecision = { ...pm.mandateDecision!, cleared: false, overrideReason: "" };
    pm.decisionConfidence = 0.1; // drop below the confidence floor so gates recompute uncleared
    pm.portfolioFit = { ...pm.portfolioFit!, targetWeightPct: MANDATE.unclearedCapPct + 5 };
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/size-cap")?.status).toBe("fail");
  });

  it("skips the mandate group on a mandate-blind run", () => {
    const b = healthyBundle();
    b.riskMandate = null;
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.mandateDecision = null;
    b.decisionSnapshot!.mandateId = null;
    b.decisionSnapshot!.mandateVerdict = null;
    b.decisionSnapshot!.rewardToRiskLossAdjustedGlr = null;
    b.decisionSnapshot!.worstCaseReturnPct = null;
    b.decisionSnapshot!.capacityVetoed = null;
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/blind-mirrors")?.status).toBe("pass");
    expect(byId(report.checks, "mandate/verdict")?.status).toBe("skipped");
  });

  it("fails populated mandate mirrors on a mandate-blind run", () => {
    const b = healthyBundle();
    b.riskMandate = null;
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/blind-mirrors")?.status).toBe("fail");
  });

  it("fails when a mandate-aware run drops its mandate mirror (not skipped)", () => {
    const b = healthyBundle();
    // mandate + reward-to-risk present, but the snapshot mirror is gone.
    b.decisionSnapshot!.mandateVerdict = null;
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/mirror-present")?.status).toBe("fail");
  });

  it("fails when the snapshot capacity-veto mirror disagrees with recomputation", () => {
    const b = healthyBundle();
    b.decisionSnapshot!.capacityVetoed = !b.decisionSnapshot!.capacityVetoed;
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/capacity")?.status).toBe("fail");
  });

  it("fails when the memo cleared mirror disagrees with the recomputed soft gates", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.mandateDecision = {
      ...pm.mandateDecision!,
      cleared: !pm.mandateDecision!.cleared,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/soft-gates")?.status).toBe("fail");
  });

  it("fails when PM mandate figure mirrors drift from the reward-to-risk resource", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.mandateDecision = {
      ...pm.mandateDecision!,
      expectedValuePct: (RR.expectedValuePct ?? 0) + 1,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/reward-mirrors")?.status).toBe("fail");
  });

  it("checks a soft-gate clamp against the applicable pre-policy cap", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.decisionConfidence = 0.1;
    b.decisionSnapshot!.decisionConfidence = 0.1;
    pm.mandateDecision = {
      ...pm.mandateDecision!,
      verdict: "fails",
      cleared: false,
      capacityVetoed: false,
      sizeClamped: true,
    };
    b.decisionSnapshot!.mandateVerdict = "fails";
    b.decisionSnapshot!.capacityVetoed = false;
    pm.portfolioFit = { ...pm.portfolioFit!, targetWeightPct: 1 };
    pm.policyDecision = {
      mandatePresent: true,
      policyVerdict: "capped",
      positionCapClamped: true,
      excluded: false,
      householdWeightKnown: true,
      preGatePolicyTargetPct: MANDATE.unclearedCapPct,
      allocationRead: "within allocation",
      constraintRead: "capped after the risk-mandate gate",
    };
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/clamp-on-cap")?.status).toBe("pass");
  });

  it("rejects the tighter capacity cap when only the soft gate applies", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.decisionConfidence = 0.1;
    b.decisionSnapshot!.decisionConfidence = 0.1;
    pm.mandateDecision = {
      ...pm.mandateDecision!,
      verdict: "fails",
      cleared: false,
      capacityVetoed: false,
      sizeClamped: true,
    };
    b.decisionSnapshot!.mandateVerdict = "fails";
    b.decisionSnapshot!.capacityVetoed = false;
    pm.policyDecision = {
      mandatePresent: true,
      policyVerdict: "within-policy",
      positionCapClamped: false,
      excluded: false,
      householdWeightKnown: true,
      preGatePolicyTargetPct: MANDATE.capacityVetoCapPct,
      allocationRead: "within allocation",
      constraintRead: "within constraints",
    };
    const report = checkRun(b);
    expect(byId(report.checks, "mandate/clamp-on-cap")?.status).toBe("fail");
  });
});

describe("checkRun — decision-consistency", () => {
  it("accepts a false snapshot mandate marker when the PM policy mirror is absent", () => {
    const report = checkRun(healthyBundle());
    expect(byId(report.checks, "decision-consistency/snapshot-pm")?.status).toBe("pass");
  });

  it("fails when the snapshot and PM memo final ratings disagree", () => {
    const b = healthyBundle();
    b.decisionSnapshot!.finalRating = "Buy"; // memo still Overweight, still within band
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/snapshot-pm")?.status).toBe("fail");
  });

  it("fails when a decision snapshot exists but the PM memo errored", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.status = "error";
    pm.errorMessage = "synthetic PM failure";
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/snapshot-pm")?.status).toBe("fail");
  });

  it("fails when a snapshot policy mirror disagrees with the PM memo", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.policyDecision = {
      mandatePresent: true,
      policyVerdict: "within-policy",
      positionCapClamped: false,
      excluded: false,
      householdWeightKnown: true,
      preGatePolicyTargetPct: 1.4,
      allocationRead: "within allocation",
      constraintRead: "within constraints",
    };
    b.decisionSnapshot!.mandatePresent = true;
    b.decisionSnapshot!.policyVerdict = "within-policy";
    b.decisionSnapshot!.positionCapClamped = false;
    b.decisionSnapshot!.excluded = true;
    b.decisionSnapshot!.preGatePolicyTargetPct = 1.4;
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/snapshot-pm")?.status).toBe("fail");
  });

  it("fails when the snapshot and PM mandate IDs disagree", () => {
    const b = healthyBundle();
    b.decisionSnapshot!.mandateId = "different-mandate";
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/snapshot-pm")?.status).toBe("fail");
  });

  it("fails when the snapshot identity drifts from the run identity", () => {
    // A decision for one name mislabeled as another: the decision-field mirrors
    // still agree, but the snapshot's own ticker/asOfDate no longer match the run
    // the scoreboard labels it by.
    const b = healthyBundle();
    b.decisionSnapshot!.ticker = "AAPL"; // run is NVDA
    expect(byId(checkRun(b).checks, "decision-consistency/snapshot-pm")?.status).toBe("fail");

    const b2 = healthyBundle();
    b2.decisionSnapshot!.asOfDate = "2020-01-01"; // run is 2026-05-06
    expect(byId(checkRun(b2).checks, "decision-consistency/snapshot-pm")?.status).toBe("fail");
  });

  it("passes a durable policy gate that matches recomputation", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    b.portfolioMandate = POLICY_MANDATE;
    b.householdTickerWeightPct = 0;
    pm.policyDecision = {
      mandatePresent: true,
      policyVerdict: "capped",
      positionCapClamped: true,
      excluded: false,
      householdWeightKnown: true,
      preGatePolicyTargetPct: CLAMP.targetWeightPct,
      allocationRead: "within allocation",
      constraintRead: "capped",
    };
    pm.portfolioFit = {
      ...pm.portfolioFit!,
      targetWeightPct: 1,
      weightDeltaPct: 1 - pm.portfolioFit!.currentWeightPct,
    };
    b.summary.targetWeightPct = 1;
    b.decisionSnapshot!.mandatePresent = true;
    b.decisionSnapshot!.policyVerdict = "capped";
    b.decisionSnapshot!.positionCapClamped = true;
    b.decisionSnapshot!.excluded = false;
    b.decisionSnapshot!.preGatePolicyTargetPct = CLAMP.targetWeightPct;
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/snapshot-pm")?.status).toBe("pass");
    expect(byId(report.checks, "decision-consistency/policy-recompute")?.status).toBe("pass");
  });

  it("recomputes the durable policy gate when memo and snapshot mirrors drift together", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    b.portfolioMandate = POLICY_MANDATE;
    b.householdTickerWeightPct = 0;
    pm.policyDecision = {
      mandatePresent: true,
      policyVerdict: "within-policy",
      positionCapClamped: false,
      excluded: false,
      householdWeightKnown: true,
      preGatePolicyTargetPct: CLAMP.targetWeightPct,
      allocationRead: "within allocation",
      constraintRead: "within constraints",
    };
    pm.portfolioFit = {
      ...pm.portfolioFit!,
      targetWeightPct: CLAMP.targetWeightPct,
      weightDeltaPct: CLAMP.targetWeightPct - pm.portfolioFit!.currentWeightPct,
    };
    b.summary.targetWeightPct = CLAMP.targetWeightPct;
    b.decisionSnapshot!.mandatePresent = true;
    b.decisionSnapshot!.policyVerdict = "within-policy";
    b.decisionSnapshot!.positionCapClamped = false;
    b.decisionSnapshot!.excluded = false;
    b.decisionSnapshot!.preGatePolicyTargetPct = CLAMP.targetWeightPct;
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/snapshot-pm")?.status).toBe("pass");
    expect(byId(report.checks, "decision-consistency/policy-recompute")?.status).toBe("fail");
  });

  it("fails when the weight delta does not equal target − current", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.portfolioFit = { ...pm.portfolioFit!, weightDeltaPct: 99 };
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/weight-delta")?.status).toBe("fail");
  });

  it("fails when a completed run's published PM memo omits portfolio fit", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.portfolioFit = null;
    const report = checkRun(b);
    expect(byId(report.checks, "decision-consistency/weight-delta")?.status).toBe("fail");
  });
});

describe("checkRun — valuation", () => {
  it("fails when method none retains populated fair-value fields", () => {
    const b = healthyBundle();
    b.valuationSpine!.fairValue = {
      justifiedPE: 30,
      fairValue: 150,
      marginOfSafety: 0.3,
      method: "none",
      available: false,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/fair-value-abstention")?.status).toBe("fail");
  });

  it("fails when an available fair value omits required numeric fields", () => {
    const b = healthyBundle();
    b.valuationSpine!.fairValue = {
      justifiedPE: 30,
      fairValue: null,
      marginOfSafety: null,
      method: "justified-pe",
      available: true,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/fair-value-abstention")?.status).toBe("fail");
  });

  it("fails when an unavailable equity-multiples leg retains valuation numbers", () => {
    const b = healthyBundle();
    b.valuationSpine!.fairValue = {
      justifiedPE: 12,
      fairValue: 100,
      marginOfSafety: 0.2,
      method: "equity-multiples",
      available: false,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/fair-value-abstention")?.status).toBe("fail");
  });

  it("allows an unavailable justified-PE leg to retain only its computed multiple", () => {
    const b = healthyBundle();
    b.valuationSpine!.fairValue = {
      justifiedPE: 12,
      fairValue: null,
      marginOfSafety: null,
      method: "justified-pe",
      available: false,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/fair-value-abstention")?.status).toBe("pass");
  });

  it("flags a terminal-value-dominated DCF as a soft signal", () => {
    const b = healthyBundle();
    b.valuationSpine!.dcf = {
      intrinsicValue: 100,
      marginOfSafety: -0.1,
      discountRate: 0.09,
      stage1Growth: 0.1,
      terminalValueShare: 0.9,
      impliedGrowth: 0.2,
      expectationsGap: 0.1,
      reliability: "tv-dominated",
      reverseDcfStatus: "solved",
      unavailableReason: null,
      method: "dcf",
      available: true,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/tv-dominated")?.status).toBe("flag");
    expect(byId(report.checks, "valuation/tv-share-reliability")?.status).toBe("pass");
  });

  it("fails when a DCF abstains without a reason", () => {
    const b = healthyBundle();
    b.valuationSpine!.dcf = {
      intrinsicValue: null,
      marginOfSafety: null,
      discountRate: null,
      stage1Growth: null,
      terminalValueShare: null,
      impliedGrowth: null,
      expectationsGap: null,
      reliability: null,
      reverseDcfStatus: "unavailable",
      unavailableReason: null, // dishonest: available false without a reason
      method: "none",
      available: false,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/dcf-abstention")?.status).toBe("fail");
  });

  it("fails when an unavailable DCF retains available-only fields", () => {
    const b = healthyBundle();
    b.valuationSpine!.dcf = {
      intrinsicValue: 100,
      marginOfSafety: 0.2,
      discountRate: 0.09,
      stage1Growth: 0.1,
      terminalValueShare: 0.7,
      impliedGrowth: 0.12,
      expectationsGap: 0.02,
      reliability: "ok",
      reverseDcfStatus: "solved",
      unavailableReason: "non-positive-fcf",
      method: "dcf",
      available: false,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/dcf-abstention")?.status).toBe("fail");
  });

  it("fails when an available DCF has a contradictory shape", () => {
    const b = healthyBundle();
    b.valuationSpine!.dcf = {
      intrinsicValue: null,
      marginOfSafety: 0.2,
      discountRate: 0.09,
      stage1Growth: 0.1,
      terminalValueShare: 0.7,
      impliedGrowth: null,
      expectationsGap: null,
      reliability: "ok",
      reverseDcfStatus: "unavailable",
      unavailableReason: "non-positive-fcf",
      method: "none",
      available: true,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/dcf-abstention")?.status).toBe("fail");
  });

  it("fails when triangulation names a valuation leg that was unavailable", () => {
    const b = healthyBundle();
    b.valuationSpine!.dcf = {
      intrinsicValue: null,
      marginOfSafety: null,
      discountRate: null,
      stage1Growth: null,
      terminalValueShare: null,
      impliedGrowth: null,
      expectationsGap: null,
      reliability: null,
      reverseDcfStatus: "unavailable",
      unavailableReason: "non-positive-fcf",
      method: "none",
      available: false,
    };
    b.valuationSpine!.triangulation = {
      marginOfSafety: 0.3,
      methodsUsed: ["dcf"],
      divergence: "single-method",
      spread: null,
    };
    const report = checkRun(b);
    expect(byId(report.checks, "valuation/triangulation")?.status).toBe("fail");
  });
});

describe("checkRun — citations & null-honesty", () => {
  it("fails when a published analyst memo has a null dataQuality", () => {
    const b = healthyBundle();
    const fund = b.memos.find((m) => m.key === "p1/fundamentals")!.state as MemoState;
    fund.dataQuality = null;
    const report = checkRun(b);
    expect(byId(report.checks, "citations/analyst-data-quality")?.status).toBe("fail");
  });

  it("fails when a memo metric carries a dishonest string", () => {
    const b = healthyBundle();
    const pmKey = ALL_MEMO_KEYS.portfolioManager.collectionKey;
    const pm = b.memos.find((m) => m.key === pmKey)!.state as MemoState;
    pm.metrics = { pe: "NaN" };
    const report = checkRun(b);
    expect(byId(report.checks, "null-honesty/metrics-strings")?.status).toBe("fail");
  });

  it("flags invalid Phase-2 citation tags as a soft signal", () => {
    const b = healthyBundle();
    b.citationIntegrity = {
      tagsChecked: 3,
      tagsValid: 2,
      invalidTags: [{ contribution: "bull", tag: "[memo:x]", attemptedQuote: "q" }],
    };
    const report = checkRun(b);
    expect(byId(report.checks, "citations/phase2-integrity")?.status).toBe("flag");
  });
});

describe("checkRun — memo completeness", () => {
  it("fails when an expected memo is still pending on a completed run", () => {
    const b = healthyBundle();
    const traderKey = ALL_MEMO_KEYS.trader.collectionKey;
    const trader = b.memos.find((m) => m.key === traderKey)!.state as MemoState;
    trader.status = "pending";
    const report = checkRun(b);
    expect(byId(report.checks, "memo-completeness/expected-published")?.status).toBe("fail");
  });

  it("does not fail on absent p2b memos for a fast run (they are not expected)", () => {
    const report = checkRun(healthyBundle());
    expect(byId(report.checks, "memo-completeness/expected-published")?.status).toBe("pass");
  });
});
