/**
 * Unit tests for the Summary aggregate builder (Slice 3, spec 06 §3.1).
 *
 * `buildReportSummary` is a pure function over already-validated stored memo +
 * spine state. These tests encode the real-money intent, not just behavior:
 *
 *   - the stance→axis mapping is the single source of truth for the conviction
 *     strip; a wrong mapping would mis-render convergence/divergence, which is a
 *     decision signal. Each participant kind reads its OWN stance field
 *     (analyst.rating / RM.stance / trader.direction / PM.finalRating).
 *   - missing memos collapse to null (hollow nodes, "—" metrics), NEVER to a
 *     fabricated 0/neutral — honesty over completeness (BP-020 at the UI layer).
 *   - analyst ordering follows Phase 1 publish order so the grid is stable.
 *   - factor scores trace to the spine; absent spine → null factor block.
 */
import { describe, expect, it } from "vitest";
import {
  buildReportSummary,
  stanceToAxis,
} from "../components/summary/aggregate";
import type { MemoState } from "../src/flows/analysis/resources";
import type { ValuationSpineState } from "../src/flows/analysis/valuation-spine-resource";
import type { AnyMemoShortName } from "../src/flows/analysis/registry";

/** Build a minimal published MemoState, overriding only the fields under test. */
function memo(overrides: Partial<MemoState>): MemoState {
  return {
    status: "published",
    agentName: "x",
    agentTeam: "analyst",
    ticker: "NVDA",
    date: "2026-05-06",
    phaseId: "p1",
    label: null,
    headline: null,
    rating: null,
    body: null,
    metrics: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    citations: null,
    dataQuality: null,
    stance: null,
    conviction: null,
    keyRisks: null,
    keyOpportunities: null,
    unresolvedDisagreements: null,
    citationIntegrity: null,
    direction: null,
    sizePct: null,
    stopPrice: null,
    targetPrice: null,
    holdingPeriod: null,
    invalidationCriteria: null,
    dependsOn: null,
    posture: null,
    raisedRisks: null,
    proposedAdjustments: null,
    dismissedRisks: null,
    criticalRisks: null,
    recommendedAdjustments: null,
    confidenceCalibration: null,
    calibrationRationale: null,
    scenarios: null,
    distribution: null,
    probabilitySum: null,
    horizon: null,
    evidenceBasis: null,
    decisionSummary: null,
    finalRating: null,
    decisionConfidence: null,
    acceptedAdjustments: null,
    keyDependencies: null,
    upstreamReferences: null,
    agreesWithTrader: null,
    primaryScenario: null,
    modelImpliedRating: null,
    ratingBand: null,
    ratingClamped: null,
    ratingOverrideReason: null,
    absoluteRating: null,
    relativeRating: null,
    alignment: null,
    alignmentConfidence: null,
    supportingEvidence: null,
    contradictingEvidence: null,
    blindSpots: null,
    proposedRevision: null,
    ...overrides,
  } as MemoState;
}

function mapOf(
  entries: Array<[AnyMemoShortName, MemoState | null]>,
): Map<AnyMemoShortName, MemoState | null> {
  return new Map(entries);
}

describe("stanceToAxis", () => {
  it("maps each participant-kind stance label to the shared -1..+1 axis", () => {
    // Analyst ratings.
    expect(stanceToAxis("constructive")).toBe(1);
    expect(stanceToAxis("neutral")).toBe(0);
    expect(stanceToAxis("cautious")).toBe(-1);
    // RM stance.
    expect(stanceToAxis("bullish")).toBe(1);
    expect(stanceToAxis("bearish")).toBe(-1);
    // Trader direction.
    expect(stanceToAxis("long")).toBe(1);
    expect(stanceToAxis("short")).toBe(-1);
    expect(stanceToAxis("flat")).toBe(0);
    // PM five-tier.
    expect(stanceToAxis("Buy")).toBe(1);
    expect(stanceToAxis("Overweight")).toBe(0.5);
    expect(stanceToAxis("Hold")).toBe(0);
    expect(stanceToAxis("Underweight")).toBe(-0.5);
    expect(stanceToAxis("Sell")).toBe(-1);
  });

  it("returns null (hollow node) for unknown / empty / absent labels — never a fabricated 0", () => {
    expect(stanceToAxis(null)).toBeNull();
    expect(stanceToAxis(undefined)).toBeNull();
    expect(stanceToAxis("")).toBeNull();
    expect(stanceToAxis("wat")).toBeNull();
  });
});

describe("buildReportSummary — analyst grid", () => {
  it("emits all nine analyst rows in Phase 1 publish order, even when memos are absent", () => {
    const summary = buildReportSummary(mapOf([]), null);
    expect(summary.analysts).toHaveLength(9);
    expect(summary.analysts.map((a) => a.shortName)).toEqual([
      "fundamentals",
      "sentiment",
      "news",
      "technical",
      "companyProfile",
      "market",
      "macro",
      "quant",
      "disclosure",
    ]);
    // Absent memo → null headline/stance/dq, empty metrics — no fabrication.
    const fn = summary.analysts[0];
    expect(fn.headline).toBeNull();
    expect(fn.stance).toBeNull();
    expect(fn.dataQuality).toBeNull();
    expect(fn.topMetrics).toEqual([]);
    expect(fn.status).toBeNull();
  });

  it("reads headline, stance (rating), dq, and the first two metrics from a published memo", () => {
    const summary = buildReportSummary(
      mapOf([
        [
          "fundamentals",
          memo({
            headline: "Margins inflecting on data-center mix.",
            rating: "constructive",
            dataQuality: "full",
            metrics: { pe: "32x", roe: "78%", fcf: "$64B" },
          }),
        ],
      ]),
      null,
    );
    const fn = summary.analysts[0];
    expect(fn.headline).toBe("Margins inflecting on data-center mix.");
    expect(fn.stance).toBe("constructive");
    expect(fn.dataQuality).toBe("full");
    // Only the first two metric entries land in the grid.
    expect(fn.topMetrics).toEqual([
      { key: "pe", value: "32x" },
      { key: "roe", value: "78%" },
    ]);
  });
});

describe("buildReportSummary — decision", () => {
  it("is null when the PM memo is absent or finalRating unpublished", () => {
    expect(buildReportSummary(mapOf([]), null).decision).toBeNull();
    expect(
      buildReportSummary(
        mapOf([["portfolioManager", memo({ finalRating: null })]]),
        null,
      ).decision,
    ).toBeNull();
  });

  it("reads finalRating, band, clamp, confidence, and primary scenario from the PM memo", () => {
    const summary = buildReportSummary(
      mapOf([
        [
          "portfolioManager",
          memo({
            finalRating: "Overweight",
            modelImpliedRating: "Buy",
            ratingBand: { floor: "Hold", ceiling: "Buy" },
            ratingClamped: false,
            decisionSummary: "Constructive, sized modestly.",
            decisionConfidence: 0.78,
            agreesWithTrader: true,
            primaryScenario: "Data-center beat",
            keyDependencies: ["AI cap-ex cycle length"],
          }),
        ],
      ]),
      null,
    );
    expect(summary.decision).not.toBeNull();
    expect(summary.decision?.finalRating).toBe("Overweight");
    expect(summary.decision?.modelImpliedRating).toBe("Buy");
    expect(summary.decision?.ratingBand).toEqual({ floor: "Hold", ceiling: "Buy" });
    expect(summary.decision?.decisionConfidence).toBe(0.78);
    expect(summary.decision?.primaryScenario).toBe("Data-center beat");
    expect(summary.keyDependencies).toEqual(["AI cap-ex cycle length"]);
  });

  it("collapses an empty-string primaryScenario to null (no fake scenario reference)", () => {
    const summary = buildReportSummary(
      mapOf([
        ["portfolioManager", memo({ finalRating: "Hold", primaryScenario: "" })],
      ]),
      null,
    );
    expect(summary.decision?.primaryScenario).toBeNull();
  });
});

describe("buildReportSummary — conviction strip", () => {
  it("orders nodes analysts → RM → trader → PM and reads each from its own field", () => {
    const summary = buildReportSummary(
      mapOf([
        ["fundamentals", memo({ rating: "constructive" })],
        ["researchManager", memo({ stance: "bearish" })],
        ["trader", memo({ direction: "flat" })],
        ["portfolioManager", memo({ finalRating: "Overweight" })],
      ]),
      null,
    );
    // 9 analysts + RM + trader + PM = 12 nodes.
    expect(summary.conviction).toHaveLength(12);
    const byAgent = Object.fromEntries(
      summary.conviction.map((n) => [n.agent, n]),
    );
    expect(byAgent.fundamentalsAnalyst.axis).toBe(1); // constructive
    expect(byAgent.researchManager.axis).toBe(-1); // bearish stance, NOT rating
    expect(byAgent.trader.axis).toBe(0); // flat direction
    expect(byAgent.portfolioManager.axis).toBe(0.5); // Overweight finalRating
    expect(byAgent.portfolioManager.isDecision).toBe(true);
    // Absent analysts are hollow nodes (null axis), never fabricated neutral.
    expect(byAgent.sentimentAnalyst.axis).toBeNull();
  });
});

describe("buildReportSummary — factor scores, risks, scenarios, alignment", () => {
  it("null factor block when the spine is absent; reads component scores when present", () => {
    expect(buildReportSummary(mapOf([]), null).factorScores).toBeNull();
    const spine = {
      setupScore: { value: 60, quality: 75, factor: 88, momentum: 40 },
    } as unknown as ValuationSpineState;
    const fs = buildReportSummary(mapOf([]), spine).factorScores;
    expect(fs).toEqual({ value: 60, quality: 75, factor: 88, momentum: 40 });
  });

  it("flags the primary scenario and reads critical risks + distribution", () => {
    const summary = buildReportSummary(
      mapOf([
        [
          "portfolioManager",
          memo({ finalRating: "Hold", primaryScenario: "Base case" }),
        ],
        [
          "scenarioForecast",
          memo({
            distribution: "balanced",
            scenarios: [
              {
                name: "Base case",
                probability: 0.55,
                trigger: "t",
                triggerSource: "phase1",
                expectedOutcome: "o",
                expectedReturnPct: 0,
                tradeBehavior: "b",
              },
              {
                name: "Bull case",
                probability: 0.25,
                trigger: "t",
                triggerSource: "phase1",
                expectedOutcome: "o",
                expectedReturnPct: 0,
                tradeBehavior: "b",
              },
            ],
          }),
        ],
        [
          "riskAssessment",
          memo({
            criticalRisks: [
              {
                description: "Customer concentration",
                raisedBy: "aggressive",
                severity: "high",
              },
            ],
          }),
        ],
        [
          "thesisAlignment",
          memo({ alignment: "partially-aligned", alignmentConfidence: 0.62 }),
        ],
      ]),
      null,
    );
    expect(summary.distribution).toBe("balanced");
    expect(summary.scenarios.map((s) => [s.name, s.isPrimary])).toEqual([
      ["Base case", true],
      ["Bull case", false],
    ]);
    expect(summary.criticalRisks).toEqual([
      {
        description: "Customer concentration",
        severity: "high",
        raisedBy: "aggressive",
      },
    ]);
    expect(summary.thesisAlignment).toEqual({
      alignment: "partially-aligned",
      confidence: 0.62,
    });
  });
});

describe("buildReportSummary — identity", () => {
  it("derives ticker/date from the first present memo", () => {
    const summary = buildReportSummary(
      mapOf([["fundamentals", memo({ ticker: "AAPL", date: "2026-05-06" })]]),
      null,
    );
    expect(summary.ticker).toBe("AAPL");
    expect(summary.date).toBe("2026-05-06");
  });
});

/**
 * Slice 6 portfolio-fit + lens-convergence mirrors. The aggregate reads these
 * STRAIGHT off the PM memo (no recompute) so the Summary blocks render only from
 * stored fields. The intent encoded here:
 *   - the before/after weights + Δ are passed through verbatim — the aggregate
 *     never recomputes a weight (every figure traces to a stored field).
 *   - both mirrors collapse to null when absent so the Summary OMITS the block
 *     cleanly (portfolio-blind / cost-gated-off run), never a stubbed position.
 */
const PORTFOLIO_FIT = {
  action: "add",
  targetWeightPct: 4.5,
  sizingRationale: "Scale modestly into proven exposure.",
  concentrationRisk: "Within single-name cap.",
  convictionBasis: "Robust across the lens pack.",
  suggestedAccount: "Taxable — Brokerage",
  currentWeightPct: 2.5,
  weightDeltaPct: 2.0,
  hasPortfolioContext: true,
  snapshotAsOf: "2026-05-06T14:30:00Z",
} satisfies NonNullable<MemoState["portfolioFit"]>;

const LENS_CONVERGENCE = {
  verdicts: [
    {
      lensId: "quality-value",
      label: "Quality-Value",
      attribution: "Buffett/Munger",
      glyph: "Qv",
      stance: "bullish",
      conviction: 0.7,
      verdict: "Durable franchise at a fair price.",
      keyDriver: "Returns on capital.",
      dataGap: "",
      missingData: [],
    },
    {
      lensId: "forensic-skeptic",
      label: "Forensic Skeptic",
      attribution: "Burry",
      glyph: "Fs",
      stance: "bearish",
      conviction: 0.6,
      verdict: "Cycle-top risk underpriced.",
      keyDriver: "Inventory build.",
      dataGap: "no segment detail",
      missingData: ["segment revenue"],
    },
  ],
  netLean: 0.05,
  agreementScore: 0.5,
  classification: "mixed",
  majorityStance: "bullish",
  dissenters: ["forensic-skeptic"],
} satisfies NonNullable<MemoState["lensConvergence"]>;

describe("buildReportSummary — portfolio fit (Slice 6)", () => {
  it("passes the PM memo's stored before/after weights + Δ through verbatim", () => {
    const summary = buildReportSummary(
      mapOf([
        [
          "portfolioManager",
          memo({ finalRating: "Overweight", portfolioFit: PORTFOLIO_FIT }),
        ],
      ]),
      null,
    );
    expect(summary.portfolioFit).not.toBeNull();
    // Read straight through — the aggregate recomputes no weight.
    expect(summary.portfolioFit?.currentWeightPct).toBe(2.5);
    expect(summary.portfolioFit?.targetWeightPct).toBe(4.5);
    expect(summary.portfolioFit?.weightDeltaPct).toBe(2.0);
    expect(summary.portfolioFit?.hasPortfolioContext).toBe(true);
    expect(summary.portfolioFit?.suggestedAccount).toBe("Taxable — Brokerage");
    expect(summary.portfolioFit?.snapshotAsOf).toBe("2026-05-06T14:30:00Z");
  });

  it("is null when the PM memo is absent (Summary omits the weight block)", () => {
    expect(buildReportSummary(mapOf([]), null).portfolioFit).toBeNull();
  });

  it("is null when the run was portfolio-blind (PM published, no portfolioFit)", () => {
    const summary = buildReportSummary(
      mapOf([["portfolioManager", memo({ finalRating: "Hold" })]]),
      null,
    );
    expect(summary.portfolioFit).toBeNull();
  });

  it("carries hasPortfolioContext:false through (block gates on it at render, not here)", () => {
    const summary = buildReportSummary(
      mapOf([
        [
          "portfolioManager",
          memo({
            finalRating: "Hold",
            portfolioFit: {
              ...PORTFOLIO_FIT,
              hasPortfolioContext: false,
              currentWeightPct: 0,
              weightDeltaPct: 4.5,
              suggestedAccount: "",
              snapshotAsOf: null,
            },
          }),
        ],
      ]),
      null,
    );
    // The aggregate still surfaces it (not null); the no-current-weight gate is
    // applied at the render layer (`report-summary.tsx`), not by dropping data.
    expect(summary.portfolioFit).not.toBeNull();
    expect(summary.portfolioFit?.hasPortfolioContext).toBe(false);
  });
});

describe("buildReportSummary — lens convergence (Slice 6)", () => {
  it("passes the PM memo's deterministic convergence mirror through verbatim", () => {
    const summary = buildReportSummary(
      mapOf([
        [
          "portfolioManager",
          memo({ finalRating: "Hold", lensConvergence: LENS_CONVERGENCE }),
        ],
      ]),
      null,
    );
    expect(summary.lensConvergence).not.toBeNull();
    expect(summary.lensConvergence?.classification).toBe("mixed");
    expect(summary.lensConvergence?.majorityStance).toBe("bullish");
    expect(summary.lensConvergence?.netLean).toBe(0.05);
    expect(summary.lensConvergence?.verdicts).toHaveLength(2);
    expect(summary.lensConvergence?.dissenters).toEqual(["forensic-skeptic"]);
  });

  it("is null when the lens pack was skipped (fast preset / no PM memo)", () => {
    // No PM memo at all.
    expect(buildReportSummary(mapOf([]), null).lensConvergence).toBeNull();
    // PM published but cost-gated off → no lensConvergence mirror.
    const summary = buildReportSummary(
      mapOf([["portfolioManager", memo({ finalRating: "Buy" })]]),
      null,
    );
    expect(summary.lensConvergence).toBeNull();
  });
});
