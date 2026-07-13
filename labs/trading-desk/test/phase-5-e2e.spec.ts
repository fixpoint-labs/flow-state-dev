/**
 * Phase 5 end-to-end integration spec.
 *
 * Drives the full `analyze` action with every generator mocked. Asserts:
 *   - the Phase 5 portfolio-manager memo publishes with every extension
 *     field populated, `upstreamReferences` resolves to the canonical
 *     storage keys, and `agreesWithTrader` matches the mocked direction
 *     against the mocked trader memo;
 *   - `session.runComplete` flips to `true` on the happy path;
 *   - on a PM-generator failure the PM memo flips to `error`, the prior
 *     phases' memos still publish, and `runComplete` stays `false`.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";

// Collateral: this spec drives the analyze pipeline but does not test the
// portfolio. The repository (FIX-772) is mocked to an empty in-memory instance
// so `seedSession` runs portfolio-blind (no accounts → portfolio: null), the
// prior default. One repo for the file (beforeAll) — fast, never mutated.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import analysisFlow from "../src/flows/analysis/flow";
import { ALL_MEMO_KEYS } from "../src/flows/analysis/registry";
import { latestMemoStatus } from "./_helpers/memo-status";

beforeAll(async () => {
  repoState.repo = await makeTestRepository();
});

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
        { h: "Material items", p: null, items: ["Watch item A", "Watch item B"] },
      ],
      citations: null,
      dataQuality: "full" as const,
    },
  };
}

function bullStructuredOutput() {
  return {
    structuredOutput: {
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
      metrics: {
        conviction: "0.6",
        horizon: "3–6mo",
        downside: "-22%",
        trigger: "Next earnings",
      },
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
      metrics: {
        conviction: "0.55",
        horizon: "6mo",
        stance: "bullish",
        outOfScope: "Trade sizing",
      },
      body: [
        { h: "Resolution of the debate", p: "Agree on demand durability.", items: null },
        { h: "Synthesized thesis", p: "Lean long, smaller than max.", items: null },
        { h: "What is in scope", p: "Direction and conviction.", items: null },
        { h: "What is out of scope", p: "Position sizing.", items: null },
        { h: "Key risks (named)", p: "Cycle pull-forward.", items: null },
      ],
      stance: "bullish" as const,
      convictionScore: 0.55,
      keyRisks: ["Cap-ex pull-forward", "Margin compression"],
      keyOpportunities: ["DC acceleration", "New hyperscaler wins"],
      unresolvedDisagreements: [
        "AI cap-ex cycle length",
        "Pricing-power durability in 2027",
      ],
    },
  };
}

function traderStructuredOutput() {
  return {
    structuredOutput: {
      label: "Trade proposal",
      headline: "Long NVDA, half-position.",
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
        { h: "Why this size", p: "Mid conviction; below max long.", items: null },
        { h: "Exit discipline", p: "Stop on weekly close below $132.", items: null },
      ],
      direction: "long" as const,
      sizePct: 1.4,
      stopPrice: 132,
      targetPrice: 185,
      holdingPeriod: "months" as const,
      invalidationCriteria: [
        "weekly close below $132",
        "DC revenue print misses",
      ],
      dependsOn: ["AI cap-ex cycle length"],
      citations: null,
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
      headline: `${posture} stance summary.`,
      rating: posture,
      metrics: { ...baseRiskMetrics, stance: posture },
      body: [
        { h: "The argument", p: "Posture argument.", items: null },
        { h: "What I would propose", p: "Adjustment.", items: null },
        { h: "What I am not arguing", p: "Out of scope.", items: null },
      ],
      posture,
      raisedRisks: [{ description: "Sample risk", severity: "medium" as const }],
      proposedAdjustments: {
        sizing: "unchanged" as const,
        holdingPeriod: "unchanged" as const,
        invalidation: "unchanged" as const,
      },
      citations: null,
    },
  };
}

function neutralCritiqueOutput() {
  return {
    structuredOutput: {
      label: "neutral critique",
      headline: "Neutral filter applied.",
      rating: "neutral",
      metrics: { ...baseRiskMetrics, stance: "neutral" },
      body: [
        { h: "The argument", p: "Neutral filter.", items: null },
        { h: "What I would propose", p: "No structural change.", items: null },
        { h: "What I am not arguing", p: "OOS items.", items: null },
      ],
      posture: "neutral" as const,
      raisedRisks: [],
      proposedAdjustments: {
        sizing: "unchanged" as const,
        holdingPeriod: "unchanged" as const,
        invalidation: "tighter" as const,
      },
      dismissedRisks: [
        {
          description: "Earnings drawdown",
          reason: "Trade exits before earnings.",
          dismissalCategory: "out-of-scope" as const,
        },
      ],
      citations: null,
    },
  };
}

function riskAssessmentStructuredOutput() {
  return {
    structuredOutput: {
      label: "Risk assessment",
      headline: "Calibrated. Endorse sizing.",
      rating: "calibrated",
      metrics: {
        calibration: "calibrated",
        sizing: "unchanged",
        invalidation: "tighter",
        holdingPeriod: "unchanged",
      },
      body: [
        { h: "Convergence", p: "Endorsed.", items: null },
        { h: "Disagreement", p: "Stop tightness.", items: null },
        { h: "Load-bearing", p: "Stop discipline.", items: null },
        { h: "Noise", p: "Earnings drawdown.", items: null },
        { h: "Calibration", p: "Calibrated.", items: null },
      ],
      criticalRisks: [
        {
          description: "Stop placement",
          raisedBy: "conservative" as const,
          severity: "medium" as const,
        },
      ],
      dismissedRisks: [
        {
          description: "Earnings drawdown",
          reason: "Trade exits before earnings.",
          dismissalCategory: "out-of-scope" as const,
        },
      ],
      recommendedAdjustments: {
        sizing: {
          direction: "unchanged" as const,
          rationale: "Sizing matches conviction.",
          attributedTo: "neutral" as const,
        },
        holdingPeriod: {
          direction: "unchanged" as const,
          rationale: "Holding period is appropriate.",
          attributedTo: "neutral" as const,
        },
        invalidation: {
          direction: "tighter" as const,
          rationale: "Vol regime warrants a tighter stop.",
          attributedTo: "conservative" as const,
        },
      },
      confidenceCalibration: "calibrated" as const,
      calibrationRationale: "Conviction aligns with the evidence base.",
      citations: null,
    },
  };
}

function portfolioManagerStructuredOutput(
  finalRating: "Sell" | "Underweight" | "Hold" | "Overweight" | "Buy",
) {
  return {
    structuredOutput: {
      label: "PortfolioDecision",
      headline: `Final decision: ${finalRating} NVDA.`,
      rating: finalRating,
      metrics: {
        rating: finalRating,
        ticker: "NVDA",
        window: "6 months",
        size: "1.4%",
        stop: "$132",
        target: "$185",
      },
      body: [
        { h: "Executive summary", p: "Summary text.", items: null },
        { h: "Investment thesis", p: "Cited.", items: null },
        { h: "What supports this rating", p: "Reasons.", items: null },
        { h: "What argues against", p: "Counterpoints.", items: null },
        { h: "Critical near-term inflection", p: "Watch.", items: null },
        { h: "Pre-committed exit triggers", p: "Exit.", items: null },
        { h: "Why not the adjacent tier", p: "Adjacent reasoning.", items: null },
        { h: "Deferred follow-on", p: "Defer.", items: null },
        { h: "Citations", p: "References.", items: null },
      ],
      finalRating,
      decisionSummary: `${finalRating} NVDA at 1.4% of NAV.`,
      decisionConfidence: 0.62,
      acceptedAdjustments: {
        sizing: { applied: true, reasoning: "Risk team is right." },
        holdingPeriod: { applied: false, reasoning: "Prefer the trader's horizon." },
        invalidation: { applied: true, reasoning: "Stop tightening accepted." },
      },
      keyDependencies: ["AI cap-ex cycle length"],
      asymmetricEdge:
        finalRating === "Buy" || finalRating === "Overweight"
          ? "Street underprices the data-center attach rate."
          : "",
      nearTermCatalyst:
        finalRating === "Buy" || finalRating === "Overweight"
          ? "Q2 print lands in three weeks."
          : "",
      invalidationTrigger:
        finalRating === "Buy" || finalRating === "Overweight"
          ? "Attach rate flat or down two quarters running."
          : "",
      traderDependencyDispositions: [
        { index: 0, status: "carried" as const, note: "Central to the call." },
      ],
      primaryScenario:
        finalRating === "Buy" || finalRating === "Overweight"
          ? "Data-center beat, +12%"
          : "",
      ratingOverrideReason: "",
      portfolioFit: {
        action:
          finalRating === "Buy" || finalRating === "Overweight"
            ? ("initiate" as const)
            : ("hold" as const),
        targetWeightPct:
          finalRating === "Buy" || finalRating === "Overweight" ? 2.5 : 0,
        sizingRationale: "Sized without portfolio context (none supplied).",
        concentrationRisk: "",
        suggestedAccount: "",
        convictionBasis: "",
      },
      mandateFit: {
        rewardToRiskRead: "",
        sizeStance: "",
        mandateOverrideReason: "",
      },
      policyFit: { allocationRead: "", constraintRead: "" },
      citations: null,
    },
  };
}

function makeUpstreamMocks() {
  return {
    "fundamentals-analyst-generator": mockGenerator({
      name: "fundamentals-analyst-generator",
      script: [analystThesis("Fundamentals memo", "Top-line growth durable.")],
    }),
    "sentiment-analyst-generator": mockGenerator({
      name: "sentiment-analyst-generator",
      script: [analystThesis("Sentiment memo", "Sentiment constructive.")],
    }),
    "news-analyst-generator": mockGenerator({
      name: "news-analyst-generator",
      script: [analystThesis("News memo", "News flow steady.")],
    }),
    "technical-analyst-generator": mockGenerator({
      name: "technical-analyst-generator",
      script: [analystThesis("Technical memo", "Technicals supportive.")],
    }),
    "company-profile-analyst-generator": mockGenerator({
      name: "company-profile-analyst-generator",
      script: [analystThesis("Company Profile memo", "Identity resolved from provider data.")],
    }),
    "p2-research-debate-roster-bullResearcher": mockGenerator({
      name: "p2-research-debate-roster-bullResearcher",
      script: [{ text: "Bull round 1 contribution." }],
    }),
    "p2-research-debate-roster-bearResearcher": mockGenerator({
      name: "p2-research-debate-roster-bearResearcher",
      script: [{ text: "Bear round 1 contribution." }],
    }),
    "consolidate-bull-memo": mockGenerator({
      name: "consolidate-bull-memo",
      script: [bullStructuredOutput()],
    }),
    "consolidate-bear-memo": mockGenerator({
      name: "consolidate-bear-memo",
      script: [bearStructuredOutput()],
    }),
    "research-manager-generator": mockGenerator({
      name: "research-manager-generator",
      script: [rmStructuredOutput()],
    }),
    "trader-generator": mockGenerator({
      name: "trader-generator",
      script: [traderStructuredOutput()],
    }),
    "aggressive-risk-generator": mockGenerator({
      name: "aggressive-risk-generator",
      script: [personaCritiqueOutput("aggressive")],
    }),
    "conservative-risk-generator": mockGenerator({
      name: "conservative-risk-generator",
      script: [personaCritiqueOutput("conservative")],
    }),
    "neutral-risk-generator": mockGenerator({
      name: "neutral-risk-generator",
      script: [neutralCritiqueOutput()],
    }),
    "risk-assessment-generator": mockGenerator({
      name: "risk-assessment-generator",
      script: [riskAssessmentStructuredOutput()],
    }),
    "trader-approach-generator": mockGenerator({
      name: "trader-approach-generator",
      script: [{ text: "Trader approach preamble." }],
    }),
    "aggressive-approach-generator": mockGenerator({
      name: "aggressive-approach-generator",
      script: [{ text: "Aggressive approach preamble." }],
    }),
    "conservative-approach-generator": mockGenerator({
      name: "conservative-approach-generator",
      script: [{ text: "Conservative approach preamble." }],
    }),
    "neutral-approach-generator": mockGenerator({
      name: "neutral-approach-generator",
      script: [{ text: "Neutral approach preamble." }],
    }),
    "risk-assessment-approach-generator": mockGenerator({
      name: "risk-assessment-approach-generator",
      script: [{ text: "Risk-assessment approach preamble." }],
    }),
    "scenario-forecaster-approach-generator": mockGenerator({
      name: "scenario-forecaster-approach-generator",
      script: [{ text: "Scenario forecaster approach preamble." }],
    }),
    "scenario-forecaster-generator": mockGenerator({
      name: "scenario-forecaster-generator",
      script: [
        {
          structuredOutput: {
            label: "ScenarioForecast",
            headline: "Concentrated base.",
            rating: "concentrated",
            metrics: { horizon: "months", distribution: "concentrated", buckets: "3 scenarios", evidence: "sufficient" },
            body: [{ h: "Summary", p: "Base case dominant.", items: null }],
            scenarios: [
              { name: "Base", probability: 0.55, trigger: "t", triggerSource: "investmentThesis", expectedOutcome: "o", expectedReturnPct: 4, tradeBehavior: "b" },
              { name: "Up", probability: 0.25, trigger: "t", triggerSource: "tradeProposal", expectedOutcome: "o", expectedReturnPct: 12, tradeBehavior: "b" },
              { name: "Down", probability: 0.20, trigger: "t", triggerSource: "riskAssessment", expectedOutcome: "o", expectedReturnPct: -8, tradeBehavior: "b" },
            ],
            distribution: "concentrated",
            evidenceBasis: "sufficient",
            citations: null,
          },
        },
      ],
    }),
    "portfolio-manager-approach-generator": mockGenerator({
      name: "portfolio-manager-approach-generator",
      script: [{ text: "PM approach preamble." }],
    }),
  };
}

const analyzeInput = {
  ticker,
  date,
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
};

describe("Phase 5 end-to-end", () => {
  it("happy path — portfolioManager memo publishes with all extension fields populated; runComplete flips to true", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p5-e2e-happy";

    const pm = mockGenerator({
      name: "portfolio-manager-generator",
      script: [portfolioManagerStructuredOutput("Overweight")],
    });

    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: analyzeInput,
      generators: {
        ...makeUpstreamMocks(),
        "portfolio-manager-generator": pm,
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const session = await stores.session.get(sessionId);
    const sessionState = (session?.state ?? {}) as {
      runComplete?: boolean;
      activePhase?: string;
    };
    expect(sessionState.runComplete).toBe(true);
    expect(sessionState.activePhase).toBe("phase-5");

    const memoResources = await stores.resourceState.getAll("session", sessionId);
    const pmMemo = memoResources["memos/p5/portfolio-manager"] as
      | {
          status?: string;
          finalRating?: string | null;
          decisionSummary?: string | null;
          decisionConfidence?: number | null;
          acceptedAdjustments?: Record<string, unknown> | null;
          keyDependencies?: string[] | null;
          upstreamReferences?: {
            analystMemos: string[];
            thesis: string;
            tradeProposal: string;
            riskAssessment: string;
          } | null;
          agreesWithTrader?: boolean | null;
        }
      | undefined;
    expect(pmMemo?.status).toBe("published");
    expect(pmMemo?.finalRating).toBe("Overweight");
    expect(pmMemo?.decisionSummary).toBeTruthy();
    expect(pmMemo?.decisionConfidence).toBeCloseTo(0.62);
    expect(pmMemo?.acceptedAdjustments).not.toBeNull();
    expect(pmMemo?.keyDependencies?.length).toBeGreaterThan(0);

    // upstreamReferences computed at commit time from canonical key maps.
    expect(pmMemo?.upstreamReferences?.analystMemos).toEqual([
      "p1/fundamentals",
      "p1/sentiment",
      "p1/news",
      "p1/technical",
    ]);
    expect(pmMemo?.upstreamReferences?.thesis).toBe("p2/research-manager");
    expect(pmMemo?.upstreamReferences?.tradeProposal).toBe("p3/trader");
    expect(pmMemo?.upstreamReferences?.riskAssessment).toBe(
      "p4/risk-assessment",
    );

    // PortfolioDecision rating Overweight implies long; trader is long → agrees.
    expect(pmMemo?.agreesWithTrader).toBe(true);

    expect(pm.calls).toHaveLength(1);

    // Every agent in Phases 3–5 streams an approach preamble as a
    // `message` item with the agent's `agentName`. The preamble is the
    // mechanism that fills the transcript gap during structured-output
    // generation; verifying its presence here covers the wiring for all
    // six agents in one e2e run.
    for (const agentName of [
      "trader",
      "aggressiveRisk",
      "conservativeRisk",
      "neutralRisk",
      "riskAssessment",
      "portfolioManager",
    ] as const) {
      const messages = result.items.filter(
        (item) =>
          (item as { agentName?: string }).agentName === agentName &&
          (item as { type?: string }).type === "message",
      );
      expect(messages.length).toBeGreaterThan(0);
    }
  });

  it("portfolio-manager failure isolates: PM memo errors, runComplete stays false, prior memos still publish", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p5-e2e-pm-fails";

    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: analyzeInput,
      generators: {
        ...makeUpstreamMocks(),
        "portfolio-manager-generator": mockGenerator({
          name: "portfolio-manager-generator",
          script: [],
        }),
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.status).toBe("completed");

    const session = await stores.session.get(sessionId);
    const sessionState = (session?.state ?? {}) as {
      runComplete?: boolean;
    };
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.trader.memoKey)).toBe("published");
    expect(latestMemoStatus(result.items, ALL_MEMO_KEYS.riskAssessment.memoKey)).toBe("published");
    expect(sessionState.runComplete).toBe(false);

    const memoResources = await stores.resourceState.getAll("session", sessionId);
    const pmMemo = memoResources["memos/p5/portfolio-manager"] as
      | { status?: string; errorMessage?: string | null }
      | undefined;
    expect(pmMemo?.status).toBe("error");
    expect(pmMemo?.errorMessage).toBeTruthy();
  });
});
