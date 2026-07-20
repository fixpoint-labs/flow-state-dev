/**
 * Integration test for the `runArtifacts` read action, driven through `testFlow`
 * against an in-memory store.
 *
 * Intent encoded: the action reads the desk's OWN durable records for the
 * current session — the decision snapshot, the valuation spine, the
 * reward-to-risk figure, lens convergence, the memos collection, and the
 * session-state fields — and returns the full `RunArtifactsBundle` as its
 * output, with zero model spend. We seed those records as a prior `analyze` run
 * would have written them and assert the bundle reflects them. This is the
 * read seam the eval suite (FIX-790) depends on.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { portfolioMandateSchema } from "../domain/portfolio/schema/portfolio-mandate-schema";
import analysisFlow from "../flows/analysis/flow";
import type { DecisionSnapshotState } from "../flows/analysis/decision-snapshot-resource";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";

const snapshot: DecisionSnapshotState = {
  ticker: "NVDA",
  asOfDate: "2026-05-06",
  finalRating: "Buy",
  decisionConfidence: 0.8,
  decisionSummary: "Strong setup.",
  direction: "long",
  entryPrice: null,
  stopPrice: 120,
  targetPrice: 180,
  sizePct: 4,
  holdingPeriod: "quarters",
  mandateId: "balanced",
  mandateVerdict: "clears",
  rewardToRiskLossAdjustedGlr: 2.4,
  worstCaseReturnPct: -10,
  capacityVetoed: false,
  hasStandingThesis: null,
  mandatePresent: null,
  policyVerdict: null,
  positionCapClamped: null,
  excluded: null,
  preGatePolicyTargetPct: null,
  evidenceVerdict: null,
  decidedAt: "2026-06-25T00:00:00.000Z",
  outcomeRealizedPrice: null,
  outcomeAsOf: null,
  outcomeVerdict: null,
};

const portfolioMandate = portfolioMandateSchema.parse({
  objectives: { riskTolerance: "moderate" },
  constraints: { maxPositionWeightPct: 5 },
  rebalancing: {},
  timeHorizon: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("runArtifacts action", () => {
  it("projects the full scored-artifact bundle from stored resources", async () => {
    const stores = createInMemoryStores();
    const sessionId = "run_nvda_artifacts";

    const result = await testFlow({
      flow: analysisFlow,
      action: "runArtifacts",
      userId: "cli-user",
      sessionId,
      stores,
      input: {},
      seed: {
        session: {
          state: {
            ticker: "NVDA",
            date: "2026-05-06",
            costPreset: "full",
            dataSource: "fixture",
            runComplete: true,
            userThesis: "AI capex is durable.",
            portfolioMandate,
            householdTickerWeightPct: 2.5,
          },
          resources: {
            // Single resources — keyed by their `ref`.
            tradingDeskDecisionSnapshot: snapshot,
            valuationSpine: {
              ticker: "NVDA",
              asOf: "2026-05-06",
              expectedReturn: {
                shareholderYield: 0.01,
                sustainableGrowth: 0.14,
                expectedReturn: 0.15,
                hurdle: 0.09,
                excessReturn: 0.06,
                basis: "fcf",
                lowConfidence: false,
              },
              fairValue: {
                justifiedPE: 30,
                fairValue: 150,
                marginOfSafety: 0.1,
                method: "justified-pe",
                available: true,
              },
              dcf: null,
              triangulation: null,
              setupScore: {
                score: 0.6,
                value: 0.5,
                quality: 0.7,
                factor: 0.6,
                momentum: 0.6,
                evidenceBasis: "sufficient",
              },
              envelope: {
                absoluteRating: "Buy",
                relativeRating: "Overweight",
                implied: "Overweight",
                floor: "Hold",
                ceiling: "Buy",
                rationale: "x",
              },
              valuationMethod: "ev-multiples",
              evidenceBasis: "sufficient",
            },
            rewardToRisk: {
              expectedValuePct: 8,
              expectedGainPct: 20,
              expectedLossPct: -10,
              glr: 2,
              lossAdjustedGlr: 2.4,
              worstCaseReturnPct: -10,
              noDownside: false,
              evidenceBasis: "sufficient",
              lossAversion: 1.5,
              mandateId: "balanced",
            },
            // Collection items — keyed by their full storage key.
            "memos/p5/portfolio-manager": {
              status: "published",
              agentName: "portfolioManager",
              agentTeam: "pm",
              ticker: "NVDA",
              date: "2026-05-06",
              phaseId: "p5",
            },
          },
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const bundle = result.output as RunArtifactsBundle;
    // Summary reused verbatim.
    expect(bundle.summary.status).toBe("completed");
    expect(bundle.summary.sessionId).toBe(sessionId);
    expect(bundle.summary.finalRating).toBe("Buy");
    // Resources projected off their stored state.
    expect(bundle.decisionSnapshot?.finalRating).toBe("Buy");
    expect(bundle.valuationSpine?.ticker).toBe("NVDA");
    expect(bundle.rewardToRisk?.lossAdjustedGlr).toBe(2.4);
    expect(bundle.portfolioMandate?.constraints.maxPositionWeightPct).toBe(5);
    expect(bundle.householdTickerWeightPct).toBe(2.5);
    // Unwritten resources normalize to null (never a partial `{}`).
    expect(bundle.lensConvergence).toBeNull();
    expect(bundle.p2Contributions).toBeNull();
    // Session-state-sourced fields.
    expect(bundle.hasUserThesis).toBe(true);
    // Every registered memo is present; the one seeded is published, the rest
    // have a null body (never created).
    expect(bundle.memos).toHaveLength(24);
    const pm = bundle.memos.find((m) => m.key === "p5/portfolio-manager");
    expect(pm?.state?.status).toBe("published");
    const trader = bundle.memos.find((m) => m.key === "p3/trader");
    expect(trader?.state).toBeNull();
  });

  it("projects a stopped run with null resources and null memo bodies", async () => {
    const stores = createInMemoryStores();
    const sessionId = "run_zzz_stopped_artifacts";

    const result = await testFlow({
      flow: analysisFlow,
      action: "runArtifacts",
      userId: "cli-user",
      sessionId,
      stores,
      input: {},
      seed: {
        session: {
          state: {
            ticker: "ZZZ",
            date: "2026-05-06",
            costPreset: "fast",
            dataSource: "fixture",
            runComplete: true,
            stoppedReason: "unresolvable-ticker",
            stoppedMessage: "Could not resolve ticker ZZZ in fixture mode.",
          },
        },
      },
    });

    expect(result.error).toBeUndefined();
    const bundle = result.output as RunArtifactsBundle;
    expect(bundle.summary.status).toBe("stopped");
    expect(bundle.decisionSnapshot).toBeNull();
    expect(bundle.valuationSpine).toBeNull();
    expect(bundle.rewardToRisk).toBeNull();
    expect(bundle.hasUserThesis).toBe(false);
    expect(bundle.memos.every((m) => m.state === null)).toBe(true);
  });
});
