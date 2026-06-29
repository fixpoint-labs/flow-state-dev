/**
 * Cross-flow portfolio sharing guard (FIX-736 + FIX-772).
 *
 * Proves the core mechanism of the portfolio/report flow split: an account
 * written through the `portfolio` flow's `saveAccount` action is readable by
 * the analysis (report) flow's `seedSession` — because both flows go through
 * the SAME app-owned portfolio repository (FIX-772) for the same `{userId}`.
 *
 * HOW THE TEST PROVES IT:
 *   1. The repository is mocked to ONE shared in-memory PGlite instance (reset
 *      fresh per test) — both flow calls resolve `getRepository()` to it.
 *   2. `saveAccount` is run through the portfolio flow — writes an account row
 *      for `{userId}` into the repo.
 *   3. `analyze` is run through the report flow with the SAME mocked repo and
 *      NO `seed.user.resources` for accounts. `seedSession` reads accounts +
 *      holdings from `getPortfolio(userId)` — the repo the portfolio flow wrote.
 *   4. After `analyze` completes, `session.state.portfolio.accounts` must
 *      contain the IRA account written in step 2.
 *
 * WHY THIS IS A REAL GUARD (not a false pass):
 *   - The two flows share the repo only because they resolve the same
 *     `getRepository()` for the same `{userId}`. We never inject accounts via
 *     `seed.user.resources`, so the only path for the IRA to appear in
 *     `portfolio.accounts` is the shared repository read at seed time.
 *   - The negative case starts from a fresh, EMPTY repo (no portfolio write) —
 *     `seedSession` reads no accounts → `portfolio: null`. If the analysis flow
 *     somehow saw a stale or differently-keyed write, the negative would fail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";

// Both flows resolve getRepository() to this one in-memory repo, reset fresh
// per test (FIX-772) — the cross-flow share is now a shared repository, not a
// shared resource key.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import portfolioFlow from "../src/flows/portfolio/flow";
import reportFlow from "../src/flows/analysis/flow";

const USER_ID = "shared-user";
const SESSION_ID = "cross-flow-session";

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

// ---------------------------------------------------------------------------
// Minimal generator mocks — just enough to run the full analyze pipeline on
// `fast` preset without hitting real models. The portfolio assertion fires
// inside `seedSession`, well before any generator runs; the mocks exist only
// so the flow reaches `completed` status (confirming the pipeline ran fully).
// ---------------------------------------------------------------------------

function analystThesis(label: string) {
  return {
    structuredOutput: {
      label,
      headline: "Mock headline.",
      rating: "constructive" as const,
      metrics: [
        { key: "k1", value: "v1" },
        { key: "k2", value: "v2" },
        { key: "k3", value: "v3" },
        { key: "k4", value: "v4" },
      ],
      body: [
        { h: "Top", p: "Numbers fine.", items: null },
        { h: "Trend", p: "Positive.", items: null },
        { h: "Composite", p: "Holds.", items: null },
        { h: "Items", p: null, items: ["Watch A", "Watch B"] },
      ],
      citations: null,
      dataQuality: "full" as const,
    },
  };
}

function debateContrib(text: string) {
  return { text };
}

function bullOutput() {
  return {
    structuredOutput: {
      label: "Bull thesis",
      headline: "Bull.",
      rating: "buy" as const,
      metrics: { conviction: "0.7", horizon: "6mo", target: "$185", stop: "$132" },
      body: [
        { h: "Setup", p: "Strong.", items: null },
        { h: "Why bears miss", p: "Over-weighted.", items: null },
        { h: "What to see", p: "Acceleration.", items: null },
        { h: "Risks", p: "Valuation.", items: null },
      ],
    },
  };
}

function bearOutput() {
  return {
    structuredOutput: {
      label: "Bear thesis",
      headline: "Bear.",
      rating: "underweight" as const,
      metrics: { conviction: "0.6", horizon: "3mo", downside: "-20%", trigger: "Next print" },
      body: [
        { h: "Setup", p: "Rich.", items: null },
        { h: "Why bulls miss", p: "Pull-forward.", items: null },
        { h: "What to see", p: "Cautious cust.", items: null },
        { h: "Risks", p: "Squeeze.", items: null },
      ],
    },
  };
}

function rmOutput() {
  return {
    structuredOutput: {
      label: "Investment thesis",
      headline: "Constructive.",
      rating: "constructive" as const,
      metrics: { conviction: "0.55", horizon: "6mo", stance: "bullish", outOfScope: "Sizing" },
      body: [
        { h: "Resolution", p: "Demand durable.", items: null },
        { h: "Synthesized", p: "Lean long.", items: null },
        { h: "In scope", p: "Direction.", items: null },
        { h: "Out of scope", p: "Sizing.", items: null },
        { h: "Key risks", p: "Cycle.", items: null },
      ],
      stance: "bullish" as const,
      convictionScore: 0.55,
      keyRisks: ["Cycle pull-forward"],
      keyOpportunities: ["DC acceleration"],
      unresolvedDisagreements: ["Cap-ex cycle length"],
    },
  };
}

function traderOutput() {
  return {
    structuredOutput: {
      label: "Trade proposal",
      headline: "Long NVDA.",
      rating: "long" as const,
      metrics: { direction: "long", size: "1.4%", stop: "$132", target: "$185", conviction: "0.62" },
      body: [
        { h: "Reading", p: "Constructive.", items: null },
        { h: "Proposal", p: "Long 1.4%.", items: null },
        { h: "Why", p: "Mid conviction.", items: null },
        { h: "Exit", p: "Stop $132.", items: null },
      ],
      direction: "long" as const,
      sizePct: 1.4,
      stopPrice: 132,
      targetPrice: 185,
      holdingPeriod: "months" as const,
      invalidationCriteria: ["weekly close below $132"],
      dependsOn: ["Cap-ex cycle"],
      citations: null,
    },
  };
}

const baseRisk = {
  stance: "—",
  structuralChange: "—",
  scopeChange: "—",
  exitDiscipline: "—",
  stopMechanics: "—",
  followOn: "—",
};

function personaCritique(posture: "aggressive" | "conservative") {
  return {
    structuredOutput: {
      label: `${posture} critique`,
      headline: `${posture}.`,
      rating: posture,
      metrics: { ...baseRisk, stance: posture },
      body: [
        { h: "Argument", p: "Arg.", items: null },
        { h: "Propose", p: "Adj.", items: null },
        { h: "Not arguing", p: "OOS.", items: null },
      ],
      posture,
      raisedRisks: [{ description: "Risk", severity: "medium" as const }],
      proposedAdjustments: {
        sizing: "unchanged" as const,
        holdingPeriod: "unchanged" as const,
        invalidation: "unchanged" as const,
      },
      dismissedRisks: [],
      citations: null,
    },
  };
}

function neutralCritique() {
  return {
    structuredOutput: {
      label: "neutral critique",
      headline: "Neutral.",
      rating: "neutral",
      metrics: { ...baseRisk, stance: "neutral" },
      body: [
        { h: "Argument", p: "Filter.", items: null },
        { h: "Propose", p: "No change.", items: null },
        { h: "Not arguing", p: "OOS.", items: null },
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
      citations: null,
    },
  };
}

function riskAssessmentOutput() {
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
      citations: null,
    },
  };
}

function scenarioOutput() {
  return {
    structuredOutput: {
      label: "ScenarioForecast",
      headline: "Concentrated.",
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
      citations: null,
    },
  };
}

function pmOutput() {
  return {
    structuredOutput: {
      label: "PortfolioDecision",
      headline: "Final decision: Hold.",
      rating: "Hold",
      metrics: { rating: "Hold", ticker: "NVDA", window: "6 months", size: "1.4%", stop: "$132", target: "$185" },
      body: [
        { h: "Executive summary", p: "Hold.", items: null },
        { h: "Investment thesis", p: "Cited.", items: null },
        { h: "Supports", p: "Reasons.", items: null },
        { h: "Against", p: "Counterpoints.", items: null },
        { h: "Inflection", p: "Watch.", items: null },
        { h: "Exit", p: "Exit.", items: null },
        { h: "Adjacent tier", p: "Adjacent.", items: null },
        { h: "Follow-on", p: "Defer.", items: null },
        { h: "Citations", p: "Sources.", items: null },
      ],
      finalRating: "Hold",
      decisionSummary: "Hold NVDA.",
      decisionConfidence: 0.55,
      acceptedAdjustments: {
        sizing: { applied: false, reasoning: "OK." },
        holdingPeriod: { applied: false, reasoning: "Horizon." },
        invalidation: { applied: true, reasoning: "Stop." },
      },
      keyDependencies: ["Cap-ex cycle"],
      asymmetricEdge: "DC attach underpriced.",
      nearTermCatalyst: "Q2 print.",
      invalidationTrigger: "Attach rate flat.",
      traderDependencyDispositions: [{ index: 0, status: "carried" as const, note: "Central." }],
      primaryScenario: "Base",
      ratingOverrideReason: "",
      portfolioFit: null,
      citations: null,
    },
  };
}

function allMocks() {
  return {
    "fundamentals-analyst-generator": mockGenerator({ name: "fundamentals-analyst-generator", script: [analystThesis("Fundamentals")] }),
    "sentiment-analyst-generator": mockGenerator({ name: "sentiment-analyst-generator", script: [analystThesis("Sentiment")] }),
    "news-analyst-generator": mockGenerator({ name: "news-analyst-generator", script: [analystThesis("News")] }),
    "technical-analyst-generator": mockGenerator({ name: "technical-analyst-generator", script: [analystThesis("Technical")] }),
    "company-profile-analyst-generator": mockGenerator({ name: "company-profile-analyst-generator", script: [analystThesis("CompanyProfile")] }),
    "p2-research-debate-roster-bullResearcher": mockGenerator({ name: "p2-research-debate-roster-bullResearcher", script: [debateContrib("Bull r1.")] }),
    "p2-research-debate-roster-bearResearcher": mockGenerator({ name: "p2-research-debate-roster-bearResearcher", script: [debateContrib("Bear r1.")] }),
    "consolidate-bull-memo": mockGenerator({ name: "consolidate-bull-memo", script: [bullOutput()] }),
    "consolidate-bear-memo": mockGenerator({ name: "consolidate-bear-memo", script: [bearOutput()] }),
    "research-manager-generator": mockGenerator({ name: "research-manager-generator", script: [rmOutput()] }),
    "trader-approach-generator": mockGenerator({ name: "trader-approach-generator", script: [debateContrib("approach")] }),
    "trader-generator": mockGenerator({ name: "trader-generator", script: [traderOutput()] }),
    "aggressive-approach-generator": mockGenerator({ name: "aggressive-approach-generator", script: [debateContrib("approach")] }),
    "conservative-approach-generator": mockGenerator({ name: "conservative-approach-generator", script: [debateContrib("approach")] }),
    "neutral-approach-generator": mockGenerator({ name: "neutral-approach-generator", script: [debateContrib("approach")] }),
    "risk-assessment-approach-generator": mockGenerator({ name: "risk-assessment-approach-generator", script: [debateContrib("approach")] }),
    "aggressive-risk-generator": mockGenerator({ name: "aggressive-risk-generator", script: [personaCritique("aggressive")] }),
    "conservative-risk-generator": mockGenerator({ name: "conservative-risk-generator", script: [personaCritique("conservative")] }),
    "neutral-risk-generator": mockGenerator({ name: "neutral-risk-generator", script: [neutralCritique()] }),
    "risk-assessment-generator": mockGenerator({ name: "risk-assessment-generator", script: [riskAssessmentOutput()] }),
    "scenario-forecaster-approach-generator": mockGenerator({ name: "scenario-forecaster-approach-generator", script: [debateContrib("approach")] }),
    "scenario-forecaster-generator": mockGenerator({ name: "scenario-forecaster-generator", script: [scenarioOutput()] }),
    "portfolio-manager-approach-generator": mockGenerator({ name: "portfolio-manager-approach-generator", script: [debateContrib("approach")] }),
    "portfolio-manager-generator": mockGenerator({ name: "portfolio-manager-generator", script: [pmOutput()] }),
  };
}

// ---------------------------------------------------------------------------

describe("portfolio cross-flow sharing (shared repository)", () => {
  it("an account written via the portfolio flow is readable via the report flow", async () => {
    const stores = createInMemoryStores();

    // Step 1: write an IRA account through the PORTFOLIO flow. saveAccount
    // upserts it into the shared (mocked) repository for {userId}.
    const writeResult = await testFlow({
      flow: portfolioFlow,
      action: "saveAccount",
      userId: USER_ID,
      sessionId: "portfolio-session",
      stores,
      input: {
        accountId: null,
        name: "IRA",
        type: "IRA",
        cashBalance: 500,
      },
    });
    expect(writeResult.status).toBe("completed");

    // Step 2: run the REPORT flow's `analyze` — NO seed.user.resources for
    // accounts. The only way portfolio.accounts can contain the IRA is if
    // seedSession reads it from the shared repository the portfolio flow wrote.
    const analyzeResult = await testFlow({
      flow: reportFlow,
      action: "analyze",
      userId: USER_ID,
      sessionId: SESSION_ID,
      stores,
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
        selectedAccountIds: [],
      },
      generators: allMocks(),
      unmockedGeneratorPolicy: "error",
    });
    expect(analyzeResult.status).toBe("completed");

    // Step 3: read the session state that seedSession wrote.
    const session = await stores.session.get(SESSION_ID);
    const portfolio = (session?.state as {
      portfolio?: {
        accounts: Array<{ id: string; label: string }>;
        totalNav: number;
      } | null;
    })?.portfolio;

    // The IRA account written by the portfolio flow must appear here.
    expect(portfolio).not.toBeNull();
    expect(portfolio?.accounts.some((a) => a.label === "IRA")).toBe(true);
    // Cash-only NAV: 500 (no quotes → no market values from holdings, just cash).
    expect(portfolio?.totalNav).toBe(500);
  });

  it("is a real guard: WITHOUT the portfolio flow write, the report flow sees no accounts (null portfolio)", async () => {
    // Fresh empty repo (beforeEach), no portfolio flow write — seedSession
    // reads no accounts from the repository, so portfolio → null.
    const stores = createInMemoryStores();

    const analyzeResult = await testFlow({
      flow: reportFlow,
      action: "analyze",
      userId: USER_ID,
      sessionId: "no-portfolio-session",
      stores,
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
        selectedAccountIds: [],
      },
      generators: allMocks(),
      unmockedGeneratorPolicy: "error",
    });
    expect(analyzeResult.status).toBe("completed");

    const session = await stores.session.get("no-portfolio-session");
    const portfolio = (session?.state as {
      portfolio?: { accounts: Array<unknown> } | null;
    })?.portfolio;

    // No accounts written → buildPortfolioContext returns null → portfolio null.
    expect(portfolio).toBeNull();
  });
});
