/**
 * Commit-derived portfolio-fit fields (Slice 5).
 *
 * Drives the full `analyze` action with every generator mocked and the portfolio
 * seeded as user-scoped `accounts` + `portfolioQuotes` resources (seedSession
 * computes the snapshot server-side), then reads the committed PM memo's
 * `portfolioFit` from the in-memory store. Asserts the FOUR fields the writer
 * derives deterministically (NOT from the LLM):
 *   - `currentWeightPct` — summed from the snapshot's priced rows for the ticker.
 *   - `weightDeltaPct`   — targetWeightPct − currentWeightPct.
 *   - `suggestedAccount` — validated against the real account list; a
 *                          hallucinated/absent label resolves to "".
 *   - `hasPortfolioContext` — true when accounts are seeded, false without.
 *
 * Runs on `fast` so the phase-2b lens pack is cost-gated off (no convergence) —
 * the portfolio-fit derivation is independent of the lens pack.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import tradingDeskFlow from "../src/flows/trading-desk/flow";

const ticker = "NVDA";
const date = "2026-05-06";

function analystThesis(label: string, headline: string) {
  return {
    structuredOutput: {
      label,
      headline,
      rating: "constructive" as const,
      metrics: [
        { key: "k1", value: "v1" },
        { key: "k2", value: "v2" },
        { key: "k3", value: "v3" },
        { key: "k4", value: "v4" },
      ],
      body: [
        { h: "Top of book", p: "Headline numbers strong.", items: null },
        { h: "Trend", p: "Direction positive.", items: null },
        { h: "Composite reading", p: "Synthesis holds.", items: null },
        { h: "Material items", p: null, items: ["Watch A", "Watch B"] },
      ],
      citations: null,
      dataQuality: "full" as const,
    },
  };
}

function debateContribution(text: string) {
  return { text };
}

function bullStructuredOutput() {
  return {
    structuredOutput: {
      label: "Bull thesis",
      headline: "AI cap-ex cycle still has runway.",
      rating: "buy" as const,
      metrics: { conviction: "0.7", horizon: "6–12mo", target: "$185", stop: "$132" },
      body: [
        { h: "The setup", p: "Durable fundamentals.", items: null },
        { h: "Why the short framing misses", p: "Bear over-weights print risk.", items: null },
        { h: "What I want to see to scale", p: "Sequential DC acceleration.", items: null },
        { h: "Risks I am not dismissing", p: "Valuation rich.", items: null },
      ],
    },
  };
}

function bearStructuredOutput() {
  return {
    structuredOutput: {
      label: "Bear thesis",
      headline: "Cap-ex pull-in priced in.",
      rating: "underweight" as const,
      metrics: { conviction: "0.6", horizon: "3–6mo", downside: "-22%", trigger: "Next earnings" },
      body: [
        { h: "The setup", p: "Multiple expansion has run.", items: null },
        { h: "Why the long framing misses", p: "Demand pull-forward.", items: null },
        { h: "What I want to see to scale", p: "Customer commentary cautious.", items: null },
        { h: "Risks I am not dismissing", p: "Squeeze on surprise.", items: null },
      ],
    },
  };
}

function rmStructuredOutput() {
  return {
    structuredOutput: {
      label: "Investment thesis",
      headline: "Constructive but disciplined.",
      rating: "constructive" as const,
      metrics: { conviction: "0.55", horizon: "6mo", stance: "bullish", outOfScope: "Sizing" },
      body: [
        { h: "Resolution of the debate", p: "Agree on demand durability.", items: null },
        { h: "Synthesized thesis", p: "Lean long, smaller than max.", items: null },
        { h: "What is in scope", p: "Direction and conviction.", items: null },
        { h: "What is out of scope", p: "Position sizing.", items: null },
        { h: "Key risks (named)", p: "Cycle pull-forward.", items: null },
      ],
      stance: "bullish" as const,
      convictionScore: 0.55,
      keyRisks: ["Cap-ex pull-forward"],
      keyOpportunities: ["DC acceleration"],
      unresolvedDisagreements: ["AI cap-ex cycle length"],
    },
  };
}

function traderStructuredOutput() {
  return {
    structuredOutput: {
      label: "Trade proposal",
      headline: "Long NVDA, half-position.",
      rating: "long" as const,
      metrics: { direction: "long", size: "1.4%", stop: "$132", target: "$185", conviction: "0.62" },
      body: [
        { h: "Reading the thesis", p: "Constructive.", items: null },
        { h: "Proposal", p: "Long 1.4% NAV.", items: null },
        { h: "Why this size", p: "Mid conviction.", items: null },
        { h: "Exit discipline", p: "Stop $132.", items: null },
      ],
      direction: "long" as const,
      sizePct: 1.4,
      stopPrice: 132,
      targetPrice: 185,
      holdingPeriod: "months" as const,
      invalidationCriteria: ["weekly close below $132"],
      dependsOn: ["AI cap-ex cycle length"],
    },
  };
}

const baseRiskMetrics = {
  stance: "—",
  structuralChange: "—",
  scopeChange: "—",
  exitDiscipline: "—",
  stopMechanics: "—",
  followOn: "—",
};

function personaCritiqueOutput(posture: "aggressive" | "conservative") {
  return {
    structuredOutput: {
      label: `${posture} critique`,
      headline: `${posture} stance.`,
      rating: posture,
      metrics: { ...baseRiskMetrics, stance: posture },
      body: [
        { h: "The argument", p: "Argument.", items: null },
        { h: "What I would propose", p: "Adjustment.", items: null },
        { h: "What I am not arguing", p: "OOS.", items: null },
      ],
      posture,
      raisedRisks: [{ description: "Risk", severity: "medium" as const }],
      proposedAdjustments: {
        sizing: "unchanged" as const,
        holdingPeriod: "unchanged" as const,
        invalidation: "unchanged" as const,
      },
      dismissedRisks: [],
    },
  };
}

function neutralCritiqueOutput() {
  return {
    structuredOutput: {
      label: "neutral critique",
      headline: "Neutral filter.",
      rating: "neutral",
      metrics: { ...baseRiskMetrics, stance: "neutral" },
      body: [
        { h: "The argument", p: "Filter.", items: null },
        { h: "What I would propose", p: "No change.", items: null },
        { h: "What I am not arguing", p: "OOS.", items: null },
      ],
      posture: "neutral" as const,
      raisedRisks: [],
      proposedAdjustments: {
        sizing: "unchanged" as const,
        holdingPeriod: "unchanged" as const,
        invalidation: "tighter" as const,
      },
      dismissedRisks: [
        { description: "X", reason: "Y", dismissalCategory: "out-of-scope" as const },
      ],
    },
  };
}

function riskAssessmentStructuredOutput() {
  return {
    structuredOutput: {
      label: "Risk assessment",
      headline: "Calibrated.",
      rating: "calibrated",
      metrics: { calibration: "calibrated", sizing: "unchanged", invalidation: "tighter", holdingPeriod: "unchanged" },
      body: [
        { h: "Convergence", p: "Endorsed.", items: null },
        { h: "Disagreement", p: "Stop.", items: null },
        { h: "Load-bearing", p: "Discipline.", items: null },
        { h: "Noise", p: "Drawdown.", items: null },
        { h: "Calibration", p: "Calibrated.", items: null },
      ],
      criticalRisks: [
        { description: "Stop", raisedBy: "conservative" as const, severity: "medium" as const },
      ],
      dismissedRisks: [
        { description: "X", reason: "Y", dismissalCategory: "out-of-scope" as const },
      ],
      recommendedAdjustments: {
        sizing: { direction: "unchanged" as const, rationale: "OK.", attributedTo: "neutral" as const },
        holdingPeriod: { direction: "unchanged" as const, rationale: "OK.", attributedTo: "neutral" as const },
        invalidation: { direction: "tighter" as const, rationale: "Vol.", attributedTo: "conservative" as const },
      },
      confidenceCalibration: "calibrated" as const,
      calibrationRationale: "Aligned.",
    },
  };
}

function scenarioForecasterOutput() {
  return {
    structuredOutput: {
      label: "ScenarioForecast",
      headline: "Concentrated base.",
      rating: "concentrated",
      metrics: { horizon: "months", distribution: "concentrated", buckets: "3", evidence: "sufficient" },
      body: [{ h: "Summary", p: "Base dominant.", items: null }],
      scenarios: [
        { name: "Base", probability: 0.55, trigger: "t", triggerSource: "investmentThesis", expectedOutcome: "o", tradeBehavior: "b" },
        { name: "Up", probability: 0.25, trigger: "t", triggerSource: "tradeProposal", expectedOutcome: "o", tradeBehavior: "b" },
        { name: "Down", probability: 0.2, trigger: "t", triggerSource: "riskAssessment", expectedOutcome: "o", tradeBehavior: "b" },
      ],
      distribution: "concentrated",
      evidenceBasis: "sufficient",
    },
  };
}

/** PM output with a portfolio-fit verdict. `suggestedAccount` is the LABEL the
 *  LLM reasons toward — the writer validates it against the real account list. */
function pmOutput(suggestedAccountLabel: string, targetWeightPct: number) {
  return {
    structuredOutput: {
      label: "PortfolioDecision",
      headline: "Final decision: Overweight NVDA.",
      rating: "Overweight",
      metrics: { rating: "Overweight", ticker: "NVDA", window: "6 months", size: "3.0%", stop: "$132", target: "$185" },
      body: [
        { h: "Executive summary", p: "Summary.", items: null },
        { h: "Investment thesis", p: "Cited.", items: null },
        { h: "What supports this rating", p: "Reasons.", items: null },
        { h: "What argues against", p: "Counterpoints.", items: null },
        { h: "Critical near-term inflection", p: "Watch.", items: null },
        { h: "Pre-committed exit triggers", p: "Exit.", items: null },
        { h: "Why not the adjacent tier", p: "Adjacent.", items: null },
        { h: "Deferred follow-on", p: "Defer.", items: null },
        { h: "Citations", p: "Sources.", items: null },
      ],
      finalRating: "Overweight",
      decisionSummary: "Overweight NVDA.",
      decisionConfidence: 0.62,
      acceptedAdjustments: {
        sizing: { applied: true, reasoning: "OK." },
        holdingPeriod: { applied: false, reasoning: "Horizon." },
        invalidation: { applied: true, reasoning: "Stop." },
      },
      keyDependencies: ["AI cap-ex cycle length"],
      asymmetricEdge: "Street underprices DC attach rate.",
      nearTermCatalyst: "Q2 print in three weeks.",
      invalidationTrigger: "Attach rate flat two quarters.",
      traderDependencyDispositions: [{ index: 0, status: "carried" as const, note: "Central." }],
      primaryScenario: "Base",
      ratingOverrideReason: "",
      portfolioFit: {
        action: "add" as const,
        targetWeightPct,
        sizingRationale: "Add to the existing position; Roth has the cash.",
        concentrationRisk: "Megacap semis already concentrated.",
        suggestedAccount: suggestedAccountLabel,
        convictionBasis: "",
      },
    },
  };
}

function upstreamMocks() {
  return {
    "fundamentals-analyst-generator": mockGenerator({ name: "fundamentals-analyst-generator", script: [analystThesis("Fundamentals", "Growth durable.")] }),
    "sentiment-analyst-generator": mockGenerator({ name: "sentiment-analyst-generator", script: [analystThesis("Sentiment", "Constructive.")] }),
    "news-analyst-generator": mockGenerator({ name: "news-analyst-generator", script: [analystThesis("News", "Steady.")] }),
    "technical-analyst-generator": mockGenerator({ name: "technical-analyst-generator", script: [analystThesis("Technical", "Supportive.")] }),
    "company-profile-analyst-generator": mockGenerator({ name: "company-profile-analyst-generator", script: [analystThesis("Company Profile", "Resolved.")] }),
    "p2-research-debate-roster-bullResearcher": mockGenerator({ name: "p2-research-debate-roster-bullResearcher", script: [debateContribution("Bull r1.")] }),
    "p2-research-debate-roster-bearResearcher": mockGenerator({ name: "p2-research-debate-roster-bearResearcher", script: [debateContribution("Bear r1.")] }),
    "consolidate-bull-memo": mockGenerator({ name: "consolidate-bull-memo", script: [bullStructuredOutput()] }),
    "consolidate-bear-memo": mockGenerator({ name: "consolidate-bear-memo", script: [bearStructuredOutput()] }),
    "research-manager-generator": mockGenerator({ name: "research-manager-generator", script: [rmStructuredOutput()] }),
    "trader-generator": mockGenerator({ name: "trader-generator", script: [traderStructuredOutput()] }),
    "aggressive-risk-generator": mockGenerator({ name: "aggressive-risk-generator", script: [personaCritiqueOutput("aggressive")] }),
    "conservative-risk-generator": mockGenerator({ name: "conservative-risk-generator", script: [personaCritiqueOutput("conservative")] }),
    "neutral-risk-generator": mockGenerator({ name: "neutral-risk-generator", script: [neutralCritiqueOutput()] }),
    "risk-assessment-generator": mockGenerator({ name: "risk-assessment-generator", script: [riskAssessmentStructuredOutput()] }),
    "trader-approach-generator": mockGenerator({ name: "trader-approach-generator", script: [debateContribution("approach")] }),
    "aggressive-approach-generator": mockGenerator({ name: "aggressive-approach-generator", script: [debateContribution("approach")] }),
    "conservative-approach-generator": mockGenerator({ name: "conservative-approach-generator", script: [debateContribution("approach")] }),
    "neutral-approach-generator": mockGenerator({ name: "neutral-approach-generator", script: [debateContribution("approach")] }),
    "risk-assessment-approach-generator": mockGenerator({ name: "risk-assessment-approach-generator", script: [debateContribution("approach")] }),
    "scenario-forecaster-approach-generator": mockGenerator({ name: "scenario-forecaster-approach-generator", script: [debateContribution("approach")] }),
    "scenario-forecaster-generator": mockGenerator({ name: "scenario-forecaster-generator", script: [scenarioForecasterOutput()] }),
    "portfolio-manager-approach-generator": mockGenerator({ name: "portfolio-manager-approach-generator", script: [debateContribution("approach")] }),
  };
}

/**
 * User-scoped resource state that `seedSession` will use to compute the
 * portfolio snapshot server-side. Layout:
 *
 *   Roth IRA   — NVDA × 10 @ price 200 → mv 2000; cash 5000
 *   Taxable    — no holdings; cash 93000
 *   totalNav   = 2000 + 5000 + 93000 = 100000
 *   NVDA weight = 2000 / 100000 = 2% exactly
 *
 * Both accounts are in scope (selectedAccountIds: []) so the Taxable account
 * label ("Taxable Brokerage") appears in `portfolio.accounts` for label-
 * validation assertions. NVDA's weight is 2% so the PM writer echo-fields
 * are deterministic.
 */
const USER_ID = "test-user";

const rothAccountId = "acc-roth";
const taxableAccountId = "acc-tax";

const storedRothAccount = {
  accountId: rothAccountId,
  name: "Roth IRA",
  type: "Roth",
  currency: "USD",
  cashBalance: 5000,
  holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const storedTaxableAccount = {
  accountId: taxableAccountId,
  name: "Taxable Brokerage",
  type: "taxable",
  currency: "USD",
  cashBalance: 93000,
  holdings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Quotes giving NVDA price = 200 so that 10 shares → mv 2000 / nav 100000 = 2%. */
const storedQuotes = {
  dataSource: "fixture",
  fetchedAt: "2026-05-06T12:00:00.000Z",
  quotes: [{ ticker: "NVDA", price: 200, asOf: "2026-05-06" }],
};

/** User resources seeding for tests that need a portfolio. */
const userResourcesWithPortfolio = {
  [`accounts/${rothAccountId}`]: storedRothAccount,
  [`accounts/${taxableAccountId}`]: storedTaxableAccount,
  portfolioQuotes: storedQuotes,
};

type PmMemo = {
  status?: string;
  portfolioFit?: {
    action?: string;
    targetWeightPct?: number;
    currentWeightPct?: number;
    weightDeltaPct?: number;
    suggestedAccount?: string;
    hasPortfolioContext?: boolean;
  } | null;
};

async function runAndReadPmMemo(opts: {
  sessionId: string;
  hasPortfolio: boolean;
  suggestedAccountLabel: string;
  targetWeightPct: number;
}): Promise<PmMemo | undefined> {
  const stores = createInMemoryStores();
  const result = await testFlow({
    flow: tradingDeskFlow,
    action: "analyze",
    userId: USER_ID,
    sessionId: opts.sessionId,
    stores,
    input: {
      ticker,
      date,
      costPreset: "fast" as const,
      dataSource: "fixture" as const,
      // Portfolio snapshot is now computed server-side from user resources.
      // `selectedAccountIds: []` includes all accounts (both Roth + Taxable).
      selectedAccountIds: [],
    },
    // Seed user-scoped accounts + quotes so seedSession can compute the snapshot.
    seed: opts.hasPortfolio ? { user: { resources: userResourcesWithPortfolio } } : undefined,
    generators: {
      ...upstreamMocks(),
      "portfolio-manager-generator": mockGenerator({
        name: "portfolio-manager-generator",
        script: [pmOutput(opts.suggestedAccountLabel, opts.targetWeightPct)],
      }),
    },
    unmockedGeneratorPolicy: "error",
  });
  expect(result.status).toBe("completed");
  const resources = await stores.resourceState.getAll("session", opts.sessionId);
  return resources["memos/p5/portfolio-manager"] as PmMemo | undefined;
}

describe("portfolio-fit commit-derived fields", () => {
  it("derives currentWeightPct from the snapshot and weightDeltaPct from the target", async () => {
    const pm = await runAndReadPmMemo({
      sessionId: "pf-derive",
      hasPortfolio: true,
      suggestedAccountLabel: "Roth IRA",
      targetWeightPct: 3.5,
    });
    expect(pm?.status).toBe("published");
    // NVDA held at 2% (10 × 200 / 100000) → currentWeightPct = 2.
    expect(pm?.portfolioFit?.currentWeightPct).toBe(2);
    // delta = 3.5 − 2 = 1.5.
    expect(pm?.portfolioFit?.weightDeltaPct).toBeCloseTo(1.5);
    expect(pm?.portfolioFit?.hasPortfolioContext).toBe(true);
  });

  it("keeps a suggestedAccount that matches a real account label", async () => {
    const pm = await runAndReadPmMemo({
      sessionId: "pf-valid-account",
      hasPortfolio: true,
      suggestedAccountLabel: "Roth IRA",
      targetWeightPct: 3,
    });
    expect(pm?.portfolioFit?.suggestedAccount).toBe("Roth IRA");
  });

  it("rejects a hallucinated suggestedAccount label → empty string", async () => {
    const pm = await runAndReadPmMemo({
      sessionId: "pf-hallucinated-account",
      hasPortfolio: true,
      suggestedAccountLabel: "Schwab 529 College Fund", // not in the account list
      targetWeightPct: 3,
    });
    expect(pm?.portfolioFit?.suggestedAccount).toBe("");
  });

  it("with NO portfolio: hasPortfolioContext false, currentWeightPct 0, suggestedAccount dropped", async () => {
    const pm = await runAndReadPmMemo({
      sessionId: "pf-no-portfolio",
      hasPortfolio: false,
      suggestedAccountLabel: "Roth IRA", // no accounts → cannot validate → ""
      targetWeightPct: 3,
    });
    expect(pm?.status).toBe("published");
    expect(pm?.portfolioFit?.hasPortfolioContext).toBe(false);
    expect(pm?.portfolioFit?.currentWeightPct).toBe(0);
    expect(pm?.portfolioFit?.weightDeltaPct).toBeCloseTo(3);
    expect(pm?.portfolioFit?.suggestedAccount).toBe("");
  });
});
