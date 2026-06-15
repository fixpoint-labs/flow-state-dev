/**
 * Phase 6 gating end-to-end.
 *
 * Phase 6 only runs when the caller supplies a usable `userThesis` at seed
 * time. This spec drives the full `analyze` action with every generator
 * mocked and asserts:
 *   - `userThesis: null` → the validator never runs and no p6 memo is created;
 *   - a usable thesis → the validator runs once and the p6 memo publishes;
 *   - a sub-threshold thesis (< 20 chars) → treated as no thesis (skipped),
 *     with a soft `userThesisWarning` surfaced on session state.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
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
        { h: "Material items", p: null, items: ["Watch item A"] },
      ],
      citations: null,
      dataQuality: "full" as const,
    },
  };
}

function structured(output: Record<string, unknown>) {
  return { structuredOutput: output };
}

const thesisBody = [
  { h: "Resolution of the debate", p: "Agree.", items: null },
  { h: "Synthesized thesis", p: "Lean long.", items: null },
  { h: "What is in scope", p: "Direction.", items: null },
  { h: "What is out of scope", p: "Sizing.", items: null },
];

const riskMetrics = {
  stance: "—",
  structuralChange: "—",
  scopeChange: "—",
  exitDiscipline: "—",
  stopMechanics: "—",
  followOn: "—",
};

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
      script: [analystThesis("Company Profile memo", "Identity resolved.")],
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
      script: [
        structured({
          label: "Bull thesis",
          headline: "Runway remains.",
          rating: "buy",
          metrics: { conviction: "0.7", horizon: "6mo", target: "$185", stop: "$132" },
          body: thesisBody,
        }),
      ],
    }),
    "consolidate-bear-memo": mockGenerator({
      name: "consolidate-bear-memo",
      script: [
        structured({
          label: "Bear thesis",
          headline: "Priced in.",
          rating: "underweight",
          metrics: { conviction: "0.6", horizon: "3mo", downside: "-22%", trigger: "Earnings" },
          body: thesisBody,
        }),
      ],
    }),
    "research-manager-generator": mockGenerator({
      name: "research-manager-generator",
      script: [
        structured({
          label: "Investment thesis",
          headline: "Constructive but disciplined.",
          rating: "constructive",
          metrics: { conviction: "0.55", horizon: "6mo", stance: "bullish", outOfScope: "Sizing" },
          body: thesisBody,
          stance: "bullish",
          convictionScore: 0.55,
          keyRisks: ["Cap-ex pull-forward"],
          keyOpportunities: ["DC acceleration"],
          unresolvedDisagreements: ["AI cap-ex cycle length"],
        }),
      ],
    }),
    "trader-generator": mockGenerator({
      name: "trader-generator",
      script: [
        structured({
          label: "Trade proposal",
          headline: "Long NVDA, half-position.",
          rating: "long",
          metrics: { direction: "long", size: "1.4%", stop: "$132", target: "$185", conviction: "0.62" },
          body: thesisBody,
          direction: "long",
          sizePct: 1.4,
          stopPrice: 132,
          targetPrice: 185,
          holdingPeriod: "months",
          invalidationCriteria: ["weekly close below $132"],
          dependsOn: ["AI cap-ex cycle length"],
        }),
      ],
    }),
    "aggressive-risk-generator": mockGenerator({
      name: "aggressive-risk-generator",
      script: [personaCritique("aggressive")],
    }),
    "conservative-risk-generator": mockGenerator({
      name: "conservative-risk-generator",
      script: [personaCritique("conservative")],
    }),
    "neutral-risk-generator": mockGenerator({
      name: "neutral-risk-generator",
      script: [
        structured({
          label: "neutral critique",
          headline: "Neutral filter.",
          rating: "neutral",
          metrics: { ...riskMetrics, stance: "neutral" },
          body: thesisBody,
          posture: "neutral",
          raisedRisks: [],
          proposedAdjustments: { sizing: "unchanged", holdingPeriod: "unchanged", invalidation: "tighter" },
          dismissedRisks: [
            { description: "Earnings drawdown", reason: "Exits before earnings.", dismissalCategory: "out-of-scope" },
          ],
        }),
      ],
    }),
    "risk-assessment-generator": mockGenerator({
      name: "risk-assessment-generator",
      script: [
        structured({
          label: "Risk assessment",
          headline: "Calibrated.",
          rating: "calibrated",
          metrics: { calibration: "calibrated", sizing: "unchanged", invalidation: "tighter", holdingPeriod: "unchanged" },
          body: thesisBody,
          criticalRisks: [{ description: "Stop placement", raisedBy: "conservative", severity: "medium" }],
          dismissedRisks: [
            { description: "Earnings drawdown", reason: "Exits before earnings.", dismissalCategory: "out-of-scope" },
          ],
          recommendedAdjustments: {
            sizing: { direction: "unchanged", rationale: "Matches conviction.", attributedTo: "neutral" },
            holdingPeriod: { direction: "unchanged", rationale: "Appropriate.", attributedTo: "neutral" },
            invalidation: { direction: "tighter", rationale: "Vol regime.", attributedTo: "conservative" },
          },
          confidenceCalibration: "calibrated",
          calibrationRationale: "Aligned.",
        }),
      ],
    }),
    "portfolio-manager-generator": mockGenerator({
      name: "portfolio-manager-generator",
      script: [
        structured({
          label: "PortfolioDecision",
          headline: "Hold NVDA.",
          rating: "Hold",
          metrics: { rating: "Hold", ticker: "NVDA", window: "6mo", size: "0%", stop: "$132", target: "$185" },
          body: thesisBody,
          finalRating: "Hold",
          decisionSummary: "Hold.",
          decisionConfidence: 0.55,
          acceptedAdjustments: {
            sizing: { applied: true, reasoning: "ok" },
            holdingPeriod: { applied: false, reasoning: "ok" },
            invalidation: { applied: true, reasoning: "ok" },
          },
          keyDependencies: ["AI cap-ex cycle length"],
          asymmetricEdge: "",
          nearTermCatalyst: "",
          invalidationTrigger: "",
          traderDependencyDispositions: [
            { index: 0, status: "carried", note: "Central to the call." },
          ],
          primaryScenario: "",
        }),
      ],
    }),
    // Approach preambles (Phases 3–5a).
    "trader-approach-generator": mockGenerator({ name: "trader-approach-generator", script: [{ text: "x" }] }),
    "aggressive-approach-generator": mockGenerator({ name: "aggressive-approach-generator", script: [{ text: "x" }] }),
    "conservative-approach-generator": mockGenerator({ name: "conservative-approach-generator", script: [{ text: "x" }] }),
    "neutral-approach-generator": mockGenerator({ name: "neutral-approach-generator", script: [{ text: "x" }] }),
    "risk-assessment-approach-generator": mockGenerator({ name: "risk-assessment-approach-generator", script: [{ text: "x" }] }),
    "scenario-forecaster-approach-generator": mockGenerator({ name: "scenario-forecaster-approach-generator", script: [{ text: "x" }] }),
    "scenario-forecaster-generator": mockGenerator({
      name: "scenario-forecaster-generator",
      script: [
        structured({
          label: "ScenarioForecast",
          headline: "Concentrated base.",
          rating: "concentrated",
          metrics: { horizon: "months", distribution: "concentrated", buckets: "3 scenarios", evidence: "sufficient" },
          body: [{ h: "Summary", p: "Base case dominant.", items: null }],
          scenarios: [
            { name: "Base", probability: 0.55, trigger: "t", triggerSource: "investmentThesis", expectedOutcome: "o", tradeBehavior: "b" },
            { name: "Up", probability: 0.25, trigger: "t", triggerSource: "tradeProposal", expectedOutcome: "o", tradeBehavior: "b" },
            { name: "Down", probability: 0.20, trigger: "t", triggerSource: "riskAssessment", expectedOutcome: "o", tradeBehavior: "b" },
          ],
          distribution: "concentrated",
          evidenceBasis: "sufficient",
        }),
      ],
    }),
    "portfolio-manager-approach-generator": mockGenerator({ name: "portfolio-manager-approach-generator", script: [{ text: "x" }] }),
  };
}

function personaCritique(posture: "aggressive" | "conservative") {
  return structured({
    label: `${posture} critique`,
    headline: `${posture} stance.`,
    rating: posture,
    metrics: { ...riskMetrics, stance: posture },
    body: thesisBody,
    posture,
    raisedRisks: [{ description: "Sample risk", severity: "medium" }],
    proposedAdjustments: { sizing: "unchanged", holdingPeriod: "unchanged", invalidation: "unchanged" },
  });
}

function validatorMock() {
  return mockGenerator({
    name: "thesis-validator-generator",
    script: [
      structured({
        label: "ThesisAlignment",
        headline: "Partially aligned.",
        rating: "partially-aligned",
        metrics: {
          alignment: "partially-aligned",
          confidence: "0.7",
          supporting: "2 items",
          contradicting: "1 item",
          blindSpots: "1 item",
        },
        body: [
          { h: "What the evidence supports", p: "Supported.", items: null },
          { h: "What the evidence contradicts", p: "Contradicted.", items: null },
          { h: "Blind spots — what the pipeline found that you did not mention", p: "Blind.", items: null },
          { h: "Proposed revision", p: "Revise.", items: null },
        ],
        alignment: "partially-aligned",
        alignmentConfidence: 0.7,
        supportingEvidence: [{ source: "Fundamentals Analyst", claim: "Margins durable." }],
        contradictingEvidence: [{ source: "Risk Assessment", claim: "Cycle risk." }],
        blindSpots: ["Did not mention competition."],
        proposedRevision: "Re-frame around margin durability.",
        citations: null,
      }),
    ],
  });
}

function validatorApproachMock() {
  return mockGenerator({
    name: "thesis-validator-approach-generator",
    script: [{ text: "I'll check the named deals first, then verify margins." }],
  });
}

const baseInput = {
  ticker,
  date,
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
};

type SessionStateShape = {
  userThesis?: string | null;
  userThesisWarning?: string | null;
};

describe("Phase 6 gating", () => {
  it("userThesis: null → Phase 6 never runs", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p6-skip-null";
    const validator = validatorMock();

    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: { ...baseInput, userThesis: null },
      generators: {
        ...makeUpstreamMocks(),
        "thesis-validator-approach-generator": validatorApproachMock(),
        "thesis-validator-generator": validator,
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(validator.calls).toHaveLength(0);

    const resourceState = await stores.resourceState.getAll("session", sessionId);
    expect(resourceState["memos/p6/thesis-alignment"]).toBeUndefined();
  });

  it("usable userThesis → Phase 6 runs and publishes the audit", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p6-run";
    const validator = validatorMock();

    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: {
        ...baseInput,
        userThesis: "NVDA data-center growth decelerates faster than consensus expects.",
      },
      generators: {
        ...makeUpstreamMocks(),
        "thesis-validator-approach-generator": validatorApproachMock(),
        "thesis-validator-generator": validator,
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(validator.calls).toHaveLength(1);

    const resourceState = await stores.resourceState.getAll("session", sessionId);
    const memo = resourceState["memos/p6/thesis-alignment"] as
      | { status?: string; alignment?: string | null }
      | undefined;
    expect(memo?.status).toBe("published");
    expect(memo?.alignment).toBe("partially-aligned");
  });

  it("sub-threshold thesis (< 20 chars) → skipped with a soft warning", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p6-too-short";
    const validator = validatorMock();

    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "test-user",
      sessionId,
      stores,
      input: { ...baseInput, userThesis: "too short" },
      generators: {
        ...makeUpstreamMocks(),
        "thesis-validator-approach-generator": validatorApproachMock(),
        "thesis-validator-generator": validator,
      },
      unmockedGeneratorPolicy: "error",
    });

    expect(result.status).toBe("completed");
    expect(validator.calls).toHaveLength(0);

    const session = await stores.session.get(sessionId);
    const state = (session?.state ?? {}) as SessionStateShape;
    expect(state.userThesis).toBeNull();
    expect(state.userThesisWarning).toBeTruthy();
  });
});
