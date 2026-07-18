/**
 * Tests the FIX-761 durable-mandate policy gate in the PM commit.
 *
 * Drives `commitPortfolioManagerMemo` via `testBlock` with a frozen household
 * mandate (`state.portfolioMandate`) + household weight
 * (`state.householdTickerWeightPct`), FIX-752-blind (`riskMandate: null`) so the
 * policy gate is isolated. Reads the published PM memo back off the streamed
 * `resource_change`. Asserts the gate:
 *   - clamps `portfolioFit.targetWeightPct` to the max-position cap / exclusion,
 *   - derives `policyDecision` (verdict + flags + pre-gate target), never trusts
 *     the LLM,
 *   - never moves `finalRating` (the FIX-715/FIX-752 orthogonality),
 *   - is null (mandate-blind) when no mandate is frozen.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitPortfolioManagerMemo } from "../flows/analysis/agents/portfolio-manager/writer";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { valuationSpineResource } from "../flows/analysis/valuation-spine-resource";
import { decisionSnapshotResource } from "../flows/analysis/decision-snapshot-resource";
import { lensConvergenceResource } from "../flows/analysis/agents/lenses/lens-convergence-resource";
import { rewardToRiskResource } from "../flows/analysis/reward-to-risk-resource";
import { financialsDataResource } from "../flows/analysis/financials-data-resource";
import {
  SUFFICIENT_SPINE,
  SUFFICIENT_REWARD_TO_RISK,
  availableFinancials,
} from "./_helpers/sufficient-evidence";
import { PHASE_5_MEMO_KEYS } from "../flows/analysis/registry";
import {
  portfolioMandateSchema,
  type PortfolioMandate,
} from "../domain/portfolio/schema/portfolio-mandate-schema";
import { latestMemoDelta } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-policy-test",
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

function mandate(constraints: Record<string, unknown>): PortfolioMandate {
  return portfolioMandateSchema.parse({
    objectives: { riskTolerance: "moderate" },
    constraints,
    rebalancing: {},
    timeHorizon: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function baseState(opts: {
  portfolioMandate: PortfolioMandate | null;
  householdTickerWeightPct: number | null;
}) {
  return {
    ticker: "NVDA",
    date: "2026-05-06",
    costPreset: "fast" as const,
    dataSource: "fixture" as const,
    activePhase: "phase-5" as const,
    maxDebateRounds: 1,
    runComplete: false,
    // FIX-752-blind so the policy gate is isolated.
    riskMandate: null,
    portfolioMandate: opts.portfolioMandate,
    householdTickerWeightPct: opts.householdTickerWeightPct,
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

function decision(targetWeightPct: number, finalRating: "Hold" | "Buy" = "Buy") {
  return {
    label: "PortfolioDecision",
    headline: "Final decision.",
    rating: finalRating,
    metrics: { rating: finalRating, ticker: "NVDA", window: "6 months", size: "x", stop: "$1", target: "$2" },
    body: [{ h: "Executive summary", p: "x", items: null }],
    finalRating,
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
      action: "add" as const,
      targetWeightPct,
      sizingRationale: "x",
      concentrationRisk: "",
      suggestedAccount: "",
      convictionBasis: "",
    },
    mandateFit: { rewardToRiskRead: "", sizeStance: "", mandateOverrideReason: "" },
    policyFit: { allocationRead: "target read", constraintRead: "constraint read" },
    citations: null,
  };
}

type PmDelta = {
  finalRating: string;
  portfolioFit: { targetWeightPct: number; action: string };
  policyDecision: null | {
    mandatePresent: boolean;
    policyVerdict: "within-policy" | "capped" | "excluded" | "no-mandate";
    positionCapClamped: boolean;
    excluded: boolean;
    householdWeightKnown: boolean;
    preGatePolicyTargetPct: number;
    allocationRead: string;
    constraintRead: string;
  };
};

async function commit(opts: {
  portfolioMandate: PortfolioMandate | null;
  householdTickerWeightPct: number | null;
  targetWeightPct: number;
  finalRating?: "Hold" | "Buy";
}): Promise<PmDelta> {
  const result = await testBlock(commitPortfolioManagerMemo, {
    input: decision(opts.targetWeightPct, opts.finalRating),
    flow: fixtureFlow,
    session: {
      state: baseState({
        portfolioMandate: opts.portfolioMandate,
        householdTickerWeightPct: opts.householdTickerWeightPct,
      }),
      resources: {
        "memos/p5/portfolio-manager": seededPmMemo(),
        "memos/p3/trader": { direction: "flat", dependsOn: null },
        // Establish a SUFFICIENT evidence context so the always-on FIX-781 gate is
        // a pass-through and the policy gate stays isolated (else it fail-closes
        // and downgrades add→hold).
        valuationSpine: SUFFICIENT_SPINE,
        rewardToRisk: SUFFICIENT_REWARD_TO_RISK,
        financialsData: availableFinancials(),
      },
    },
  });
  expect(result.error).toBeNull();
  return latestMemoDelta(result.items, PHASE_5_MEMO_KEYS.portfolioManager.memoKey)! as PmDelta;
}

describe("Phase 5 durable-mandate policy gate", () => {
  it("clamps size to the max-position cap and records a 'capped' verdict", async () => {
    const d = await commit({
      portfolioMandate: mandate({ maxPositionWeightPct: 2 }),
      householdTickerWeightPct: 0, // not held → initiating
      targetWeightPct: 8,
    });
    expect(d.portfolioFit.targetWeightPct).toBe(2);
    expect(d.policyDecision?.policyVerdict).toBe("capped");
    expect(d.policyDecision?.positionCapClamped).toBe(true);
    expect(d.policyDecision?.preGatePolicyTargetPct).toBe(8);
    expect(d.policyDecision?.mandatePresent).toBe(true);
  });

  it("no-adds an excluded name, records 'excluded', and downgrades the action from add", async () => {
    const d = await commit({
      portfolioMandate: mandate({ exclusions: ["NVDA"] }),
      householdTickerWeightPct: 3, // held at 3%
      targetWeightPct: 8,
    });
    expect(d.portfolioFit.targetWeightPct).toBe(3); // no-add to current
    expect(d.policyDecision?.excluded).toBe(true);
    expect(d.policyDecision?.policyVerdict).toBe("excluded");
    // An excluded name can never be published as an add (the card must not render
    // a hard no-add as a green add).
    expect(d.portfolioFit.action).toBe("hold");
  });

  it("downgrades the action for an excluded name even when unpriced (clamp skipped)", async () => {
    const d = await commit({
      portfolioMandate: mandate({ exclusions: ["NVDA"] }),
      householdTickerWeightPct: null, // held but unpriced → no numeric clamp
      targetWeightPct: 8,
    });
    // The size is left unchanged (never fabricate an exit), but the ACTION still
    // must not assert an add for an excluded name.
    expect(d.portfolioFit.targetWeightPct).toBe(8);
    expect(d.policyDecision?.householdWeightKnown).toBe(false);
    expect(d.portfolioFit.action).toBe("hold");
  });

  it("keeps the add action for a merely capped (still-adding) name", async () => {
    const d = await commit({
      portfolioMandate: mandate({ maxPositionWeightPct: 5 }),
      householdTickerWeightPct: 2, // held at 2%, capped buy up to 5% is still an add
      targetWeightPct: 8,
    });
    expect(d.portfolioFit.targetWeightPct).toBe(5);
    expect(d.portfolioFit.action).toBe("add"); // a capped buy is a legitimate add
  });

  it("leaves size untouched under an advisory-only mandate (within-policy)", async () => {
    const d = await commit({
      portfolioMandate: mandate({ minCashPct: 10 }),
      householdTickerWeightPct: 1,
      targetWeightPct: 4,
    });
    expect(d.portfolioFit.targetWeightPct).toBe(4);
    expect(d.policyDecision?.positionCapClamped).toBe(false);
    expect(d.policyDecision?.policyVerdict).toBe("within-policy");
  });

  it("mirrors the PM's narrative and passes it through the memo", async () => {
    const d = await commit({
      portfolioMandate: mandate({ maxPositionWeightPct: 2 }),
      householdTickerWeightPct: 0,
      targetWeightPct: 8,
    });
    expect(d.policyDecision?.allocationRead).toBe("target read");
    expect(d.policyDecision?.constraintRead).toBe("constraint read");
  });

  it("skips the clamp on a held-but-unpriced name (householdWeightKnown false)", async () => {
    const d = await commit({
      portfolioMandate: mandate({ maxPositionWeightPct: 2, exclusions: ["NVDA"] }),
      householdTickerWeightPct: null, // held but unpriced
      targetWeightPct: 8,
    });
    expect(d.portfolioFit.targetWeightPct).toBe(8); // clamp skipped
    expect(d.policyDecision?.householdWeightKnown).toBe(false);
    expect(d.policyDecision?.excluded).toBe(true);
  });

  it("never moves finalRating (mandate touches size only)", async () => {
    const d = await commit({
      portfolioMandate: mandate({ maxPositionWeightPct: 2 }),
      householdTickerWeightPct: 0,
      targetWeightPct: 8,
      finalRating: "Buy",
    });
    expect(d.finalRating).toBe("Buy");
  });

  it("is mandate-blind (policyDecision null) when no mandate is frozen", async () => {
    const d = await commit({
      portfolioMandate: null,
      householdTickerWeightPct: 0,
      targetWeightPct: 8,
    });
    expect(d.policyDecision).toBeNull();
    expect(d.portfolioFit.targetWeightPct).toBe(8); // no clamp
  });
});
