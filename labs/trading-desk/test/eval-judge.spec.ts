/**
 * Tests for the LLM-judge layer (`eval/judge.ts` + `blinding.ts` + `rubrics.ts`,
 * FIX-790), driven with MOCKED models (no real spend).
 *
 * Intent encoded: the judge grades each rubric dimension over a BLINDED bundle,
 * runs k repeats, and turns every failure mode (a throwing model, a hung model)
 * into a score-0 repeat with a reason rather than crashing the sweep. Blinding
 * strips run provenance (sessionId, timestamps) while preserving the persona role
 * labels the rubrics need.
 */
import { describe, expect, it } from "vitest";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import type { ModelResolver } from "@flow-state-dev/core";
import { ALL_MEMO_KEYS } from "../flows/analysis/registry";
import type { MemoState } from "../flows/analysis/resources";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";
import type { RunSummary } from "../flows/analysis/run-summary";
import { blindBundle } from "../eval/blinding";
import { createJudgeBudget, runJudges } from "../eval/judge";
import { RUBRICS } from "../eval/rubrics";

const SECRET_SESSION = "run_SECRET_SESSION_id";
const SECRET_TS = "2020-01-02T03:04:05.000Z";

function pubMemo(agentName: string, phaseId: string, extra: Partial<MemoState> = {}): MemoState {
  return {
    status: "published",
    agentName,
    agentTeam: "analyst",
    ticker: "NVDA",
    date: "2026-05-06",
    phaseId,
    startedAt: SECRET_TS,
    completedAt: SECRET_TS,
    dataQuality: phaseId === "p1" ? "full" : null,
    body: [{ h: "Section", p: "Some prose.", items: null }],
    ...extra,
  } as MemoState;
}

function completedBundle(): RunArtifactsBundle {
  const memos = Object.values(ALL_MEMO_KEYS).map((entry) => {
    if (entry.phaseId === "p2b" || entry.collectionKey === ALL_MEMO_KEYS.thesisAlignment.collectionKey) {
      return { key: entry.collectionKey, state: null };
    }
    let extra: Partial<MemoState> = {};
    if (entry.collectionKey === ALL_MEMO_KEYS.scenarioForecast.collectionKey) {
      extra = {
        scenarios: [
          { name: "Bull", probability: 0.4, trigger: "x", triggerSource: "phase1", expectedOutcome: "up", expectedReturnPct: 25, tradeBehavior: "hold" },
          { name: "Base", probability: 0.4, trigger: "x", triggerSource: "phase1", expectedOutcome: "flat", expectedReturnPct: 5, tradeBehavior: "hold" },
          { name: "Bear", probability: 0.2, trigger: "x", triggerSource: "phase1", expectedOutcome: "down", expectedReturnPct: -15, tradeBehavior: "trim" },
        ],
        probabilitySum: 1.0,
      };
    }
    if (entry.collectionKey === ALL_MEMO_KEYS.portfolioManager.collectionKey) {
      extra = { finalRating: "Overweight", decisionConfidence: 0.7, decisionSummary: "Constructive.", agreesWithTrader: true };
    }
    return { key: entry.collectionKey, state: pubMemo(entry.agentName, entry.phaseId, extra) };
  });

  const summary: RunSummary = {
    ticker: "NVDA",
    date: "2026-05-06",
    costPreset: "full",
    dataSource: "fixture",
    mandateId: "balanced",
    sessionId: SECRET_SESSION,
    status: "completed",
    stopReason: null,
    stopMessage: null,
    durationMs: null,
    exitCode: null,
    error: null,
    capturePath: null,
    ranAt: SECRET_TS,
    finalRating: "Overweight",
    decisionConfidence: 0.7,
    targetWeightPct: 3,
    direction: "long",
    sizePct: 4,
    stopPrice: 100,
    targetPrice: 150,
    holdingPeriod: "quarters",
    decidedAt: SECRET_TS,
    mandateVerdict: "clears",
    capacityVetoed: false,
    rewardToRiskLossAdjustedGlr: 2,
    worstCaseReturnPct: -15,
    hasStandingThesis: null,
    mandatePresent: null,
    policyVerdict: null,
    positionCapClamped: null,
    excluded: null,
    preGatePolicyTargetPct: null,
    memos: [],
    memoErrors: 0,
  };

  return {
    summary,
    valuationSpine: null,
    rewardToRisk: null,
    lensConvergence: null,
    decisionSnapshot: null,
    riskMandate: null,
    citationIntegrity: null,
    hasUserThesis: false,
    p2Contributions: { entries: [{ round: 1, agentName: "bullResearcher", text: "Bull opens with a specific claim." }] },
    memos,
  };
}

/** A judge mock that always returns findings scoring `score` for each criterion.
 *  Provides enough script steps for k repeats. */
function judgeMock(name: string, score: number, criteria: string[]) {
  const findings = criteria.map((criterion) => ({
    criterion,
    score,
    assessment: "assessed",
    evidence: "cited evidence",
  }));
  const step = { structuredOutput: { findings, overallAssessment: "ok" } };
  return mockGenerator({ name, script: [step, step, step] });
}

function scoringResolver(score: number): ModelResolver {
  const generators: Record<string, ReturnType<typeof mockGenerator>> = {};
  for (const dim of RUBRICS) {
    generators[`eval-judge-${dim.key}`] = judgeMock(`eval-judge-${dim.key}`, score, dim.criteria);
  }
  return createMockModelResolver({ generators, policy: "error" });
}

describe("rubrics", () => {
  it("declares four dimensions, each with criteria assembled", () => {
    expect(RUBRICS).toHaveLength(4);
    expect(RUBRICS.map((r) => r.key).sort()).toEqual([
      "confidence-calibration",
      "debate-engagement",
      "evidence-quality",
      "pm-coherence",
    ]);
    for (const dim of RUBRICS) {
      expect(dim.criteria.length).toBeGreaterThan(0);
      expect(["graded", "checklist"]).toContain(dim.kind);
    }
  });
});

describe("blindBundle", () => {
  it("strips sessionId and timestamps but keeps persona role labels", () => {
    const blinded = blindBundle(completedBundle());
    const serialized = JSON.stringify(blinded);
    expect(serialized).not.toContain(SECRET_SESSION);
    expect(serialized).not.toContain(SECRET_TS);
    // Role labels the rubrics need survive.
    expect(serialized).toContain("bullResearcher");
    expect(serialized).toContain("portfolioManager");
  });

  it("strips reserved outcome fields so process-quality judges never see results", () => {
    const bundle = completedBundle();
    bundle.decisionSnapshot = {
      outcomeRealizedPrice: 999_999,
      outcomeAsOf: "SECRET_OUTCOME_DATE",
      outcomeVerdict: "correct",
    } as NonNullable<RunArtifactsBundle["decisionSnapshot"]>;
    const serialized = JSON.stringify(blindBundle(bundle));
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("SECRET_OUTCOME_DATE");
    expect(serialized).not.toContain("outcomeVerdict");
  });
});

describe("runJudges", () => {
  it("scores every dimension across k repeats with the mocked findings", async () => {
    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5", // cross-family → no self-preference warning
      k: 2,
      modelResolver: scoringResolver(0.8),
    });
    expect(report).not.toBeNull();
    expect(report!.dimensions).toHaveLength(4);
    for (const dim of report!.dimensions) {
      expect(dim.status).toBe("scored");
      expect(dim.k).toBe(2);
      expect(dim.scores).toHaveLength(2);
      // Graded dims record the raw 0.8; checklist dims snap 0.8 → 1 (binary).
      expect(dim.mean).toBeCloseTo(dim.kind === "checklist" ? 1 : 0.8, 5);
      // Raw findings survive per repeat for the sidecar (unbinarized).
      expect(dim.repeats[0].findings.length).toBeGreaterThan(0);
      expect(dim.repeats[0].findings[0].evidence).toBe("cited evidence");
    }
    expect(report!.warnings).toHaveLength(0);
  });

  it("snaps checklist-dimension scores to 0/1 while leaving graded scores raw", async () => {
    // 0.6 → 1 for the checklist dim (debate-engagement), stays 0.6 for graded dims.
    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 1,
      modelResolver: scoringResolver(0.6),
    });
    const debate = report!.dimensions.find((d) => d.key === "debate-engagement")!;
    const evidence = report!.dimensions.find((d) => d.key === "evidence-quality")!;
    expect(debate.kind).toBe("checklist");
    expect(debate.mean).toBe(1); // 0.6 snapped up
    expect(evidence.mean).toBeCloseTo(0.6, 5); // graded stays raw
    // The raw per-criterion score is preserved in the sidecar (unbinarized).
    expect(debate.repeats[0].findings[0].score).toBeCloseTo(0.6, 5);
  });

  it("counts duplicate, unknown, and omitted findings against the declared criteria", async () => {
    const generators: Record<string, ReturnType<typeof mockGenerator>> = {};
    for (const dim of RUBRICS) {
      const findings =
        dim.key === "evidence-quality"
          ? [
              { criterion: dim.criteria[0], score: 1, assessment: "first", evidence: "e1" },
              {
                criterion: dim.criteria[0],
                score: 1,
                assessment: "duplicate",
                evidence: "e2",
              },
              {
                criterion: "invented criterion",
                score: 1,
                assessment: "unknown",
                evidence: "e3",
              },
            ]
          : dim.criteria.map((criterion) => ({
              criterion,
              score: 1,
              assessment: "assessed",
              evidence: "cited evidence",
            }));
      generators[`eval-judge-${dim.key}`] = mockGenerator({
        name: `eval-judge-${dim.key}`,
        script: [{ structuredOutput: { findings, overallAssessment: "ok" } }],
      });
    }
    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 1,
      modelResolver: createMockModelResolver({ generators, policy: "error" }),
    });
    const evidence = report!.dimensions.find((d) => d.key === "evidence-quality")!;
    expect(evidence.mean).toBeCloseTo(1 / 3, 5);
  });

  it("warns that an unpriced judge model can't enforce the budget cap", async () => {
    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-opus-4-8", // not in the price table
      k: 1,
      maxCostUsd: 5,
      modelResolver: scoringResolver(0.8),
    });
    expect(report!.warnings.some((w) => w.includes("not in the price table"))).toBe(true);
  });

  it("records a self-preference warning when the judge shares the executor family", async () => {
    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/openai/gpt-5.4-mini",
      k: 1,
      modelResolver: scoringResolver(0.5),
    });
    expect(report!.warnings.some((w) => w.includes("self-preference"))).toBe(true);
  });

  it("turns a throwing judge into a score-0 failed repeat, never a crash", async () => {
    // No generators mocked + policy "error" → every judge call throws → failed.
    const resolver = createMockModelResolver({ generators: {}, policy: "error" });
    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 2,
      modelResolver: resolver,
    });
    expect(report).not.toBeNull();
    const dim = report!.dimensions[0];
    expect(dim.status).toBe("scored"); // it ran, it just failed
    expect(dim.scores).toEqual([0, 0]);
    expect(dim.repeats.every((r) => r.status === "failed" && r.reason)).toBe(true);
  });

  it("times out a hung judge into a score-0 timeout repeat", async () => {
    // A resolver whose model never resolves.
    const hangingResolver = ((modelId: string) => ({
      modelId,
      generate: () => new Promise(() => {}),
      // eslint-disable-next-line require-yield
      async *stream() {
        await new Promise(() => {});
      },
    })) as unknown as ModelResolver;

    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 1,
      timeoutMs: 30,
      modelResolver: hangingResolver,
    });
    const dim = report!.dimensions[0];
    expect(dim.repeats[0].status).toBe("timeout");
    expect(dim.repeats[0].score).toBe(0);
    expect(dim.repeats[0].reason).toBe("judge timeout");
  });

  it("stops further calls when a timeout makes spend unknowable under a budget cap", async () => {
    const hangingResolver = ((modelId: string) => ({
      modelId,
      generate: () => new Promise(() => {}),
      // eslint-disable-next-line require-yield
      async *stream() {
        await new Promise(() => {});
      },
    })) as unknown as ModelResolver;

    const report = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 2,
      timeoutMs: 20,
      maxCostUsd: 5,
      modelResolver: hangingResolver,
    });
    expect(report!.dimensions[0].k).toBe(1);
    expect(report!.dimensions.slice(1).every((d) => d.status === "skipped")).toBe(true);
    expect(report!.warnings.some((w) => w.includes("spend became unknown"))).toBe(true);
    expect(report!.totalCostUsd).toBeNull();
  });

  it("carries one judge budget across multiple sessions", async () => {
    let calls = 0;
    const resolver = ((modelId: string) => ({
      modelId,
      async generate() {
        calls++;
        return {
          structuredOutput: { findings: [], overallAssessment: "no findings" },
          finishReason: "stop",
          usage: {
            promptTokens: 1_000_000,
            completionTokens: 0,
            totalTokens: 1_000_000,
          },
        };
      },
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("stream should not be called");
      },
    })) as unknown as ModelResolver;
    const budget = createJudgeBudget(1);

    const first = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 1,
      budget,
      modelResolver: resolver,
    });
    expect(first).not.toBeNull();
    expect(calls).toBeGreaterThan(0);
    expect(budget.remainingUsd).toBe(0);

    const callsAfterFirstSession = calls;
    const second = await runJudges(completedBundle(), {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 1,
      budget,
      modelResolver: resolver,
    });
    expect(second!.dimensions.every((dimension) => dimension.status === "skipped")).toBe(true);
    expect(calls).toBe(callsAfterFirstSession);
  });

  it("skips the whole judge layer on a non-completed run", async () => {
    const b = completedBundle();
    b.summary.status = "stopped";
    const report = await runJudges(b, {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      modelResolver: scoringResolver(0.8),
    });
    expect(report).toBeNull();
  });

  it("skips the debate-engagement dimension when the transcript is absent", async () => {
    const b = completedBundle();
    b.p2Contributions = null;
    const report = await runJudges(b, {
      judgeModel: "vercel/anthropic/claude-haiku-4-5",
      k: 1,
      modelResolver: scoringResolver(0.8),
    });
    const debate = report!.dimensions.find((d) => d.key === "debate-engagement");
    expect(debate!.status).toBe("skipped");
    expect(debate!.skipReason).toContain("substrate");
  });
});
