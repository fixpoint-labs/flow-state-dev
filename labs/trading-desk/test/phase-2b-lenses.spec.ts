/**
 * Phase-2b lens-pack wiring (Slice 5).
 *
 *   - On `full`, the four lens generators run, each lens memo publishes, and the
 *     deterministic `lensConvergence` resource is written from their verdicts
 *     (the convergence TAP reading committed memos — the path the pure-math unit
 *     test does not cover).
 *   - On `fast`, the lens pack is cost-gated OFF: no lens memos, and the
 *     convergence resource stays unwritten (so the PM emits portfolioFit with no
 *     convergence-derived convictionBasis).
 *   - A single lens failing is isolated: its memo errors, the other three still
 *     publish, and convergence is computed over the survivors.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores, toStates } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/db/repository";

// Collateral: this spec drives the analyze pipeline but does not test the
// portfolio. The repository (FIX-772) is mocked to an empty in-memory instance
// so `seedSession` runs portfolio-blind (no accounts → portfolio: null), the
// prior default. One repo for the file (beforeAll) — fast, never mutated.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import analysisFlow from "../flows/analysis/flow";
import { LENS_IDS } from "../flows/analysis/registry";

beforeAll(async () => {
  repoState.repo = await makeTestRepository();
});

const ticker = "NVDA";
const date = "2026-05-06";

function analystThesis(label: string) {
  return {
    structuredOutput: {
      label,
      headline: `${label} headline.`,
      rating: "constructive" as const,
      metrics: [
        { key: "k1", value: "v1" },
        { key: "k2", value: "v2" },
        { key: "k3", value: "v3" },
        { key: "k4", value: "v4" },
      ],
      body: [
        { h: "A", p: "a.", items: null },
        { h: "B", p: "b.", items: null },
        { h: "C", p: "c.", items: null },
        { h: "D", p: null, items: ["x", "y"] },
      ],
      citations: null,
      dataQuality: "full" as const,
    },
  };
}

function text(t: string) {
  return { text: t };
}

function rmStructuredOutput() {
  return {
    structuredOutput: {
      label: "Investment thesis",
      headline: "Constructive.",
      rating: "constructive" as const,
      metrics: { conviction: "0.55", horizon: "6mo", stance: "bullish", outOfScope: "Sizing" },
      body: [
        { h: "Resolution", p: "Agree.", items: null },
        { h: "Synthesized thesis", p: "Lean long.", items: null },
        { h: "In scope", p: "Direction.", items: null },
        { h: "Out of scope", p: "Sizing.", items: null },
        { h: "Key risks", p: "Cycle.", items: null },
      ],
      stance: "bullish" as const,
      convictionScore: 0.55,
      keyRisks: ["Cap-ex"],
      keyOpportunities: ["DC"],
      unresolvedDisagreements: ["AI cap-ex cycle length"],
    },
  };
}

function bullOut() {
  return {
    structuredOutput: {
      label: "Bull thesis",
      headline: "Runway.",
      rating: "buy" as const,
      metrics: { conviction: "0.7", horizon: "6mo", target: "$185", stop: "$132" },
      body: [
        { h: "Setup", p: "Durable.", items: null },
        { h: "Why short misses", p: "Print risk.", items: null },
        { h: "Scale", p: "DC.", items: null },
        { h: "Risks", p: "Valuation.", items: null },
      ],
    },
  };
}

function bearOut() {
  return {
    structuredOutput: {
      label: "Bear thesis",
      headline: "Priced in.",
      rating: "underweight" as const,
      metrics: { conviction: "0.6", horizon: "3mo", downside: "-22%", trigger: "Earnings" },
      body: [
        { h: "Setup", p: "Run.", items: null },
        { h: "Why long misses", p: "Pull-forward.", items: null },
        { h: "Scale", p: "Cautious.", items: null },
        { h: "Risks", p: "Squeeze.", items: null },
      ],
    },
  };
}

function lensVerdict(lensId: string, stance: "bullish" | "neutral" | "bearish", conviction: number) {
  return {
    structuredOutput: {
      lensId,
      stance,
      conviction,
      verdict: `${lensId} sees ${stance}.`,
      keyDriver: `${lensId} driver`,
      disqualifierHit: "",
      dataGap: lensId === "quality-value" ? "no EV/EBIT in the bundle" : "",
      missingData: lensId === "quality-value" ? ["EV/EBIT", "ROIC"] : [],
    },
  };
}

/** Phase 1 + Phase 2 mocks shared by the lens tests. The lens pack only needs
 *  Phases 1–2 + the spine to be present; the PM is mocked minimally. */
function upToPhase2Mocks() {
  return {
    "fundamentals-analyst-generator": mockGenerator({ name: "fundamentals-analyst-generator", script: [analystThesis("Fundamentals")] }),
    "sentiment-analyst-generator": mockGenerator({ name: "sentiment-analyst-generator", script: [analystThesis("Sentiment")] }),
    "news-analyst-generator": mockGenerator({ name: "news-analyst-generator", script: [analystThesis("News")] }),
    "technical-analyst-generator": mockGenerator({ name: "technical-analyst-generator", script: [analystThesis("Technical")] }),
    "company-profile-analyst-generator": mockGenerator({ name: "company-profile-analyst-generator", script: [analystThesis("Company Profile")] }),
    // The full preset runs 2 debate rounds, so each researcher is called twice.
    "p2-research-debate-roster-bullResearcher": mockGenerator({ name: "p2-research-debate-roster-bullResearcher", script: [text("bull r1"), text("bull r2")] }),
    "p2-research-debate-roster-bearResearcher": mockGenerator({ name: "p2-research-debate-roster-bearResearcher", script: [text("bear r1"), text("bear r2")] }),
    "consolidate-bull-memo": mockGenerator({ name: "consolidate-bull-memo", script: [bullOut()] }),
    "consolidate-bear-memo": mockGenerator({ name: "consolidate-bear-memo", script: [bearOut()] }),
    "research-manager-generator": mockGenerator({ name: "research-manager-generator", script: [rmStructuredOutput()] }),
  };
}

/** Phases 3–5 mocks — terminal enough to let the run complete. The PM emits a
 *  portfolioFit (no portfolio supplied → portfolio-blind). */
function phase3to5Mocks() {
  return {
    "trader-approach-generator": mockGenerator({ name: "trader-approach-generator", script: [text("a")] }),
    "trader-generator": mockGenerator({
      name: "trader-generator",
      script: [{
        structuredOutput: {
          label: "Trade proposal", headline: "Long.", rating: "long" as const,
          metrics: { direction: "long", size: "1.4%", stop: "$132", target: "$185", conviction: "0.62" },
          body: [
            { h: "Reading", p: "x.", items: null },
            { h: "Proposal", p: "x.", items: null },
            { h: "Size", p: "x.", items: null },
            { h: "Exit", p: "x.", items: null },
          ],
          direction: "long" as const, sizePct: 1.4, stopPrice: 132, targetPrice: 185,
          holdingPeriod: "months" as const, invalidationCriteria: ["x"], dependsOn: ["AI cap-ex cycle length"],
          citations: null,
        },
      }],
    }),
    "aggressive-approach-generator": mockGenerator({ name: "aggressive-approach-generator", script: [text("a")] }),
    "conservative-approach-generator": mockGenerator({ name: "conservative-approach-generator", script: [text("a")] }),
    "neutral-approach-generator": mockGenerator({ name: "neutral-approach-generator", script: [text("a")] }),
    "aggressive-risk-generator": mockGenerator({ name: "aggressive-risk-generator", script: [persona("aggressive")] }),
    "conservative-risk-generator": mockGenerator({ name: "conservative-risk-generator", script: [persona("conservative")] }),
    "neutral-risk-generator": mockGenerator({ name: "neutral-risk-generator", script: [neutralPersona()] }),
    "risk-assessment-approach-generator": mockGenerator({ name: "risk-assessment-approach-generator", script: [text("a")] }),
    "risk-assessment-generator": mockGenerator({ name: "risk-assessment-generator", script: [riskAssessment()] }),
    "scenario-forecaster-approach-generator": mockGenerator({ name: "scenario-forecaster-approach-generator", script: [text("a")] }),
    "scenario-forecaster-generator": mockGenerator({ name: "scenario-forecaster-generator", script: [scenario()] }),
    "portfolio-manager-approach-generator": mockGenerator({ name: "portfolio-manager-approach-generator", script: [text("a")] }),
    "portfolio-manager-generator": mockGenerator({ name: "portfolio-manager-generator", script: [pm()] }),
  };
}

const baseRiskMetrics = { stance: "—", structuralChange: "—", scopeChange: "—", exitDiscipline: "—", stopMechanics: "—", followOn: "—" };
function persona(posture: "aggressive" | "conservative") {
  return { structuredOutput: {
    label: `${posture}`, headline: "h", rating: posture, metrics: { ...baseRiskMetrics, stance: posture },
    body: [{ h: "A", p: "a", items: null }, { h: "B", p: "b", items: null }, { h: "C", p: "c", items: null }],
    posture, raisedRisks: [{ description: "r", severity: "medium" as const }],
    proposedAdjustments: { sizing: "unchanged" as const, holdingPeriod: "unchanged" as const, invalidation: "unchanged" as const },
    dismissedRisks: [],
    citations: null,
  } };
}
function neutralPersona() {
  return { structuredOutput: {
    label: "neutral", headline: "h", rating: "neutral", metrics: { ...baseRiskMetrics, stance: "neutral" },
    body: [{ h: "A", p: "a", items: null }, { h: "B", p: "b", items: null }, { h: "C", p: "c", items: null }],
    posture: "neutral" as const, raisedRisks: [],
    proposedAdjustments: { sizing: "unchanged" as const, holdingPeriod: "unchanged" as const, invalidation: "tighter" as const },
    dismissedRisks: [{ description: "x", reason: "y", dismissalCategory: "out-of-scope" as const }],
    citations: null,
  } };
}
function riskAssessment() {
  return { structuredOutput: {
    label: "Risk assessment", headline: "h", rating: "calibrated",
    metrics: { calibration: "calibrated", sizing: "unchanged", invalidation: "tighter", holdingPeriod: "unchanged" },
    body: [{ h: "A", p: "a", items: null }, { h: "B", p: "b", items: null }, { h: "C", p: "c", items: null }, { h: "D", p: "d", items: null }, { h: "E", p: "e", items: null }],
    criticalRisks: [{ description: "x", raisedBy: "conservative" as const, severity: "medium" as const }],
    dismissedRisks: [{ description: "x", reason: "y", dismissalCategory: "out-of-scope" as const }],
    recommendedAdjustments: {
      sizing: { direction: "unchanged" as const, rationale: "r", attributedTo: "neutral" as const },
      holdingPeriod: { direction: "unchanged" as const, rationale: "r", attributedTo: "neutral" as const },
      invalidation: { direction: "tighter" as const, rationale: "r", attributedTo: "conservative" as const },
    },
    confidenceCalibration: "calibrated" as const, calibrationRationale: "r",
    citations: null,
  } };
}
function scenario() {
  return { structuredOutput: {
    label: "ScenarioForecast", headline: "h", rating: "concentrated",
    metrics: { horizon: "months", distribution: "concentrated", buckets: "3", evidence: "sufficient" },
    body: [{ h: "S", p: "s", items: null }],
    scenarios: [
      { name: "Base", probability: 0.55, trigger: "t", triggerSource: "investmentThesis", expectedOutcome: "o", tradeBehavior: "b" },
      { name: "Up", probability: 0.25, trigger: "t", triggerSource: "tradeProposal", expectedOutcome: "o", tradeBehavior: "b" },
      { name: "Down", probability: 0.2, trigger: "t", triggerSource: "riskAssessment", expectedOutcome: "o", tradeBehavior: "b" },
    ],
    distribution: "concentrated", evidenceBasis: "sufficient",
    citations: null,
  } };
}
function pm() {
  return { structuredOutput: {
    label: "PortfolioDecision", headline: "h", rating: "Overweight",
    metrics: { rating: "Overweight", ticker: "NVDA", window: "6m", size: "2%", stop: "$132", target: "$185" },
    body: [
      { h: "Executive summary", p: "x", items: null }, { h: "Investment thesis", p: "x", items: null },
      { h: "What supports this rating", p: "x", items: null }, { h: "What argues against", p: "x", items: null },
      { h: "Critical near-term inflection", p: "x", items: null }, { h: "Pre-committed exit triggers", p: "x", items: null },
      { h: "Why not the adjacent tier", p: "x", items: null }, { h: "Deferred follow-on", p: "x", items: null },
      { h: "Citations", p: "x", items: null },
    ],
    finalRating: "Overweight", decisionSummary: "x", decisionConfidence: 0.62,
    acceptedAdjustments: {
      sizing: { applied: true, reasoning: "x" }, holdingPeriod: { applied: false, reasoning: "x" }, invalidation: { applied: true, reasoning: "x" },
    },
    keyDependencies: ["AI cap-ex cycle length"],
    asymmetricEdge: "x", nearTermCatalyst: "x", invalidationTrigger: "x",
    traderDependencyDispositions: [{ index: 0, status: "carried" as const, note: "x" }],
    primaryScenario: "Base", ratingOverrideReason: "",
    portfolioFit: { action: "initiate" as const, targetWeightPct: 2, sizingRationale: "x", concentrationRisk: "", suggestedAccount: "", convictionBasis: "robust across philosophies — convergent" },
    citations: null,
  } };
}

function lensMocks(overrides: Partial<Record<string, ReturnType<typeof mockGenerator>>> = {}) {
  return {
    "lens-quality-value-generator": mockGenerator({ name: "lens-quality-value-generator", script: [lensVerdict("quality-value", "bullish", 0.7)] }),
    "lens-cycle-risk-generator": mockGenerator({ name: "lens-cycle-risk-generator", script: [lensVerdict("cycle-risk", "bullish", 0.6)] }),
    "lens-macro-reflexive-generator": mockGenerator({ name: "lens-macro-reflexive-generator", script: [lensVerdict("macro-reflexive", "bullish", 0.8)] }),
    "lens-forensic-skeptic-generator": mockGenerator({ name: "lens-forensic-skeptic-generator", script: [lensVerdict("forensic-skeptic", "bearish", 0.5)] }),
    ...overrides,
  };
}

describe("phase-2b lens pack", () => {
  it("on full: all four lens memos publish and convergence is written", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p2b-full";
    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "u",
      sessionId,
      stores,
      input: { ticker, date, costPreset: "full" as const, dataSource: "fixture" as const },
      generators: { ...upToPhase2Mocks(), ...lensMocks(), ...phase3to5Mocks() },
      unmockedGeneratorPolicy: "error",
    });
    expect(result.status).toBe("completed");

    const resources = toStates(await stores.resourceState.getAll("session", sessionId));
    for (const id of LENS_IDS) {
      const memo = resources[`memos/p2b/${id}`] as { status?: string } | undefined;
      expect(memo?.status).toBe("published");
    }
    // Convergence: 3 bullish + 1 bearish → majority bullish, agreement 0.75 → mixed.
    const conv = resources["lensConvergence"] as
      | { classification?: string; majorityStance?: string; agreementScore?: number; dissenters?: string[]; verdicts?: unknown[] }
      | undefined;
    expect(conv?.verdicts).toHaveLength(4);
    expect(conv?.majorityStance).toBe("bullish");
    expect(conv?.agreementScore).toBe(0.75);
    expect(conv?.classification).toBe("mixed");
    expect(conv?.dissenters).toEqual(["forensic-skeptic"]);
  });

  it("on fast: the lens pack is skipped — no lens memos, no convergence resource", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p2b-fast";
    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "u",
      sessionId,
      stores,
      input: { ticker, date, costPreset: "fast" as const, dataSource: "fixture" as const },
      generators: { ...upToPhase2Mocks(), ...phase3to5Mocks() },
      unmockedGeneratorPolicy: "error",
    });
    expect(result.status).toBe("completed");

    const resources = toStates(await stores.resourceState.getAll("session", sessionId));
    for (const id of LENS_IDS) {
      expect(resources[`memos/p2b/${id}`]).toBeUndefined();
    }
    // The single resource may be absent or an unwritten empty shell — either way
    // it carries no classification (the pack never ran).
    const conv = resources["lensConvergence"] as { classification?: string } | undefined;
    expect(conv?.classification).toBeUndefined();
  });

  it("a single lens failing is isolated: its memo errors, the other three publish, convergence over survivors", async () => {
    const stores = createInMemoryStores();
    const sessionId = "p2b-one-fails";
    const result = await testFlow({
      flow: analysisFlow,
      action: "analyze",
      userId: "u",
      sessionId,
      stores,
      input: { ticker, date, costPreset: "full" as const, dataSource: "fixture" as const },
      generators: {
        ...upToPhase2Mocks(),
        ...lensMocks({
          // empty script → the forensic-skeptic lens produces nothing → its
          // memo flips to error via the per-step rescue.
          "lens-forensic-skeptic-generator": mockGenerator({ name: "lens-forensic-skeptic-generator", script: [] }),
        }),
        ...phase3to5Mocks(),
      },
      unmockedGeneratorPolicy: "error",
    });
    expect(result.status).toBe("completed");

    const resources = toStates(await stores.resourceState.getAll("session", sessionId));
    expect((resources["memos/p2b/forensic-skeptic"] as { status?: string })?.status).toBe("error");
    for (const id of ["quality-value", "cycle-risk", "macro-reflexive"]) {
      expect((resources[`memos/p2b/${id}`] as { status?: string })?.status).toBe("published");
    }
    // Convergence computed over the 3 survivors (all bullish) → convergent.
    const conv = resources["lensConvergence"] as
      | { verdicts?: unknown[]; classification?: string; majorityStance?: string }
      | undefined;
    expect(conv?.verdicts).toHaveLength(3);
    expect(conv?.majorityStance).toBe("bullish");
    expect(conv?.classification).toBe("convergent");
  });
});
