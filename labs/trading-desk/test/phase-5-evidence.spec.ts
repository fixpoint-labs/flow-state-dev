/**
 * Tests the FIX-781 always-on evidence-sufficiency gate in the PM commit.
 *
 * Drives `commitPortfolioManagerMemo` via `testBlock`, mandate-blind
 * (`riskMandate: null`, `portfolioMandate: null`) so the evidence gate is
 * isolated, and varies the evidence resources (spine / reward-to-risk /
 * financials) + the scoped current weight, which the gate derives from the frozen
 * `state.portfolio` snapshot (seeded here via `portfolioForScoped`). Reads the
 * published PM memo back and asserts the gate:
 *   - emits `insufficient-evidence` on thin/absent spine, thin/absent
 *     reward-to-risk, or an unavailable primary financial input (fail-closed),
 *   - downgrades `initiate`/`add` → `hold` and no-adds the size (min with the
 *     scoped weight; 0 → portfolio-blind hold at 0%),
 *   - skips the numeric clamp when the current weight is unknown (Option B — the
 *     policy-gate precedent), the action still enforcing the no-add,
 *   - passes a sufficiently-evidenced run through unchanged.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitPortfolioManagerMemo } from "../flows/analysis/agents/portfolio-manager/writer";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema, type SessionState } from "../flows/analysis/state";
import { valuationSpineResource, type ValuationSpineState } from "../flows/analysis/valuation-spine-resource";
import { decisionSnapshotResource } from "../flows/analysis/decision-snapshot-resource";
import { lensConvergenceResource } from "../flows/analysis/agents/lenses/lens-convergence-resource";
import { rewardToRiskResource, type RewardToRiskState } from "../flows/analysis/reward-to-risk-resource";
import { financialsDataResource, type FinancialsDataState } from "../flows/analysis/financials-data-resource";
import { PHASE_5_MEMO_KEYS } from "../flows/analysis/registry";
import {
  SUFFICIENT_SPINE,
  SUFFICIENT_REWARD_TO_RISK,
  availableFinancials,
} from "./_helpers/sufficient-evidence";
import { latestMemoDelta } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-evidence-test",
  actions: { commitPm: { block: commitPortfolioManagerMemo } },
  session: { stateSchema: sessionStateSchema },
  resources: {
    memos: memosCollection,
    valuationSpine: valuationSpineResource,
    decisionSnapshot: decisionSnapshotResource,
    lensConvergence: lensConvergenceResource,
    rewardToRisk: rewardToRiskResource,
    financialsData: financialsDataResource,
  },
})({ id: "test" });

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

function decision(action: "initiate" | "add" | "trim" | "exit" | "hold", targetWeightPct: number) {
  return {
    label: "PortfolioDecision",
    headline: "Final decision.",
    rating: "Buy" as const,
    metrics: { rating: "Buy", ticker: "NVDA", window: "6 months", size: "x", stop: "$1", target: "$2" },
    body: [{ h: "Executive summary", p: "x", items: null }],
    finalRating: "Buy" as const,
    decisionSummary: "Test.",
    decisionConfidence: 0.7,
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
      action,
      targetWeightPct,
      sizingRationale: "x",
      concentrationRisk: "",
      suggestedAccount: "",
      convictionBasis: "",
    },
    mandateFit: { rewardToRiskRead: "", sizeStance: "", mandateOverrideReason: "" },
    policyFit: { allocationRead: "read", constraintRead: "read" },
    citations: null,
  };
}

type PmDelta = {
  portfolioFit: { targetWeightPct: number; action: string };
  evidenceDecision: null | {
    verdict: "sufficient" | "insufficient-evidence";
    sizeClamped: boolean;
    actionDowngraded: boolean;
    currentWeightKnown: boolean;
    criticalDataThin: boolean;
  };
};

const thinSpine: ValuationSpineState = { ...SUFFICIENT_SPINE, evidenceBasis: "thin" };
const thinRewardToRisk: RewardToRiskState = { ...SUFFICIENT_REWARD_TO_RISK, evidenceBasis: "thin" };

/**
 * Build a frozen scoped portfolio snapshot whose analyzed-ticker (NVDA) weight
 * derives (via the writer's `householdTickerWeight`) to `scoped` — the same
 * three-value contract the evidence gate's no-add reference reads:
 *   - `0` → portfolio-blind (not held), so the scoped weight derives to 0
 *   - a positive number → one priced NVDA holding at that weight
 *   - `null` → one held-but-unpriced NVDA holding (weightPct null → skip clamp)
 * The gate reads the weight from this snapshot (not a session field), so seeding
 * the portfolio is how a test controls the scoped current weight.
 */
function portfolioForScoped(scoped: number | null): SessionState["portfolio"] {
  if (scoped === 0) return null; // portfolio-blind → householdTickerWeight → 0
  return {
    totalNav: 100000,
    snapshotAsOf: null,
    pricedHoldings: scoped == null ? 0 : 1,
    totalHoldings: 1,
    health: null,
    accounts: [{ id: "acc1", label: "Roth IRA", type: "Roth", cash: 5000 }],
    holdings: [
      {
        ticker: "NVDA",
        account: "acc1",
        weightPct: scoped,
        marketValue: scoped == null ? null : 2000,
        costBasis: 1000,
        sector: null,
      },
    ],
  };
}

async function commit(opts: {
  action?: "initiate" | "add" | "trim" | "exit" | "hold";
  targetWeightPct: number;
  scopedTickerWeightPct: number | null;
  spine?: ValuationSpineState | null;
  rewardToRisk?: RewardToRiskState | null;
  financials?: FinancialsDataState;
}): Promise<PmDelta> {
  const result = await testBlock(commitPortfolioManagerMemo, {
    input: decision(opts.action ?? "add", opts.targetWeightPct),
    flow: fixtureFlow,
    session: {
      state: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
        activePhase: "phase-5" as const,
        maxDebateRounds: 1,
        runComplete: false,
        // Mandate-blind so the evidence gate is isolated.
        riskMandate: null,
        portfolioMandate: null,
        householdTickerWeightPct: null,
        // The gate reads the scoped current weight from the frozen portfolio
        // snapshot (not a session field), so drive it via the snapshot.
        portfolio: portfolioForScoped(opts.scopedTickerWeightPct),
      },
      resources: {
        "memos/p5/portfolio-manager": seededPmMemo(),
        "memos/p3/trader": { direction: "flat", dependsOn: null },
        valuationSpine: opts.spine === undefined ? SUFFICIENT_SPINE : opts.spine,
        rewardToRisk: opts.rewardToRisk === undefined ? SUFFICIENT_REWARD_TO_RISK : opts.rewardToRisk,
        financialsData: opts.financials ?? availableFinancials(),
      },
    },
  });
  expect(result.error).toBeNull();
  return latestMemoDelta(result.items, PHASE_5_MEMO_KEYS.portfolioManager.memoKey)! as PmDelta;
}

describe("Phase 5 evidence-sufficiency gate", () => {
  it("passes a sufficiently-evidenced run through unchanged", async () => {
    const d = await commit({ action: "add", targetWeightPct: 4, scopedTickerWeightPct: 2 });
    expect(d.evidenceDecision?.verdict).toBe("sufficient");
    expect(d.portfolioFit.action).toBe("add");
    expect(d.portfolioFit.targetWeightPct).toBe(4);
    expect(d.evidenceDecision?.actionDowngraded).toBe(false);
  });

  it("thin spine → insufficient, add downgraded to hold, capped to current", async () => {
    const d = await commit({ action: "add", targetWeightPct: 4, scopedTickerWeightPct: 2, spine: thinSpine });
    expect(d.evidenceDecision?.verdict).toBe("insufficient-evidence");
    expect(d.portfolioFit.action).toBe("hold");
    expect(d.portfolioFit.targetWeightPct).toBe(2); // min(4, 2)
    expect(d.evidenceDecision?.sizeClamped).toBe(true);
  });

  it("thin reward-to-risk → insufficient", async () => {
    const d = await commit({ action: "add", targetWeightPct: 4, scopedTickerWeightPct: 2, rewardToRisk: thinRewardToRisk });
    expect(d.evidenceDecision?.verdict).toBe("insufficient-evidence");
    expect(d.portfolioFit.action).toBe("hold");
  });

  it("absent spine (SPCX) → fail-closed insufficient", async () => {
    const d = await commit({ action: "add", targetWeightPct: 4, scopedTickerWeightPct: 2, spine: null });
    expect(d.evidenceDecision?.verdict).toBe("insufficient-evidence");
  });

  it("criticalDataThin: sufficient spine + rr but an unavailable statement → insufficient", async () => {
    const fin = availableFinancials();
    fin.incomeStatement = { ...fin.incomeStatement!, source: "unavailable" };
    const d = await commit({ action: "add", targetWeightPct: 4, scopedTickerWeightPct: 2, financials: fin });
    expect(d.evidenceDecision?.criticalDataThin).toBe(true);
    expect(d.evidenceDecision?.verdict).toBe("insufficient-evidence");
  });

  it("portfolio-blind initiate 1.5% → hold at 0% (scoped weight 0)", async () => {
    const d = await commit({ action: "initiate", targetWeightPct: 1.5, scopedTickerWeightPct: 0, spine: thinSpine });
    expect(d.portfolioFit.action).toBe("hold");
    expect(d.portfolioFit.targetWeightPct).toBe(0);
  });

  it("unknown current weight (held-unpriced) → skip clamp, action hold, size preserved", async () => {
    const d = await commit({ action: "add", targetWeightPct: 4, scopedTickerWeightPct: null, spine: thinSpine });
    expect(d.portfolioFit.action).toBe("hold");
    expect(d.portfolioFit.targetWeightPct).toBe(4); // clamp skipped, not withheld/fabricated
    expect(d.evidenceDecision?.currentWeightKnown).toBe(false);
    expect(d.evidenceDecision?.sizeClamped).toBe(false);
  });

  it("a reducing action (exit) is preserved under insufficient evidence", async () => {
    const d = await commit({ action: "exit", targetWeightPct: 0, scopedTickerWeightPct: 3, spine: thinSpine });
    expect(d.portfolioFit.action).toBe("exit");
    expect(d.portfolioFit.targetWeightPct).toBe(0);
  });
});
