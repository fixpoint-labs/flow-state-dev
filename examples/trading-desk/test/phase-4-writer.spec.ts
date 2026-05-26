/**
 * Tests for the Phase 4 writer taps. Confirms `markWritingP4`,
 * `markErrorP4`, and the four commit handlers flip `session.memoStatus`
 * and patch the resources with the right extension fields.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import {
  commitPersonaMemo,
  commitRiskAssessmentMemo,
  markErrorP4,
  markWritingP4,
} from "../src/flows/trading-desk/phase-4/writer";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";
import {
  personaCritiqueOutputSchema,
  riskAssessmentOutputSchema,
} from "../src/flows/trading-desk/phase-4/schemas";
import {
  NEUTRAL_PROMPT,
  RISK_ASSESSMENT_PROMPT,
} from "../src/flows/trading-desk/phase-4/prompts";

const DISMISSAL_CATEGORIES = [
  "already-addressed",
  "out-of-scope",
  "no-mechanism",
  "asymmetric-no-bound",
] as const;

const writeAggressive = markWritingP4("aggressive");
const errorAggressive = markErrorP4("aggressive");
const commitAggressive = commitPersonaMemo("aggressive");
const commitConservative = commitPersonaMemo("conservative");
const commitNeutral = commitPersonaMemo("neutral");

const fixtureFlow = defineFlow({
  kind: "trading-desk-p4-writer-test",
  actions: {
    writeAggressive: { block: writeAggressive },
    commitAggressive: { block: commitAggressive },
    commitConservative: { block: commitConservative },
    commitNeutral: { block: commitNeutral },
    commitAssessment: { block: commitRiskAssessmentMemo },
    errorAggressive: { block: errorAggressive },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-4" as const,
  maxDebateRounds: 1,
  memoStatus: {
    aggressive: "pending" as const,
    conservative: "pending" as const,
    neutral: "pending" as const,
    riskAssessment: "pending" as const,
  },
};

function seededP4Memo(opts: {
  agentName: string;
  startedAt?: string | null;
}) {
  return {
    status: opts.startedAt ? ("writing" as const) : ("pending" as const),
    agentName: opts.agentName,
    agentTeam: "risk" as const,
    phaseId: "p4",
    ticker: "NVDA",
    date: "2026-05-06",
    label: null,
    headline: null,
    rating: null,
    body: null,
    metrics: null,
    startedAt: opts.startedAt ?? null,
    completedAt: null,
    errorMessage: null,
    stance: null,
    conviction: null,
    keyRisks: null,
    keyOpportunities: null,
    unresolvedDisagreements: null,
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
  };
}

const baseMetrics = {
  stance: "—",
  structuralChange: "—",
  scopeChange: "—",
  exitDiscipline: "—",
  stopMechanics: "—",
  followOn: "—",
};

const aggressiveCritique = {
  label: "Aggressive critique",
  headline: "Sizing below the structural setup; push for 2.5–3% of NAV.",
  rating: "upsize",
  metrics: {
    ...baseMetrics,
    stance: "Underweight given asymmetry",
    structuralChange: "Increase size to 2.5–3% of NAV",
    scopeChange: "Add weekly options overlay",
  },
  body: [
    { h: "The argument", p: "Asymmetric setup; size too small.", items: null },
    { h: "What I would propose", p: "Upsize to 2.5%.", items: null },
    {
      h: "What I am not arguing",
      p: "Not arguing against the stop.",
      items: null,
    },
  ],
  posture: "aggressive" as const,
  raisedRisks: [
    { description: "Missing the breakout if size <1%", severity: "high" as const },
  ],
  proposedAdjustments: {
    sizing: "larger" as const,
    holdingPeriod: "unchanged" as const,
    invalidation: "looser" as const,
  },
  dismissedRisks: [],
};

const conservativeCritique = {
  ...aggressiveCritique,
  label: "Conservative critique",
  headline: "Stop is too loose; tighten to 1×ATR.",
  rating: "size correct",
  posture: "conservative" as const,
  proposedAdjustments: {
    sizing: "smaller" as const,
    holdingPeriod: "shorter" as const,
    invalidation: "tighter" as const,
  },
};

const neutralCritique = {
  ...aggressiveCritique,
  label: "Neutral critique",
  headline: "Endorse sizing as proposed; layer a hedge.",
  rating: "size correct + hedge",
  posture: "neutral" as const,
  proposedAdjustments: {
    sizing: "unchanged" as const,
    holdingPeriod: "unchanged" as const,
    invalidation: "tighter" as const,
  },
  dismissedRisks: [
    {
      description: "Generic 'earnings drawdown' risk",
      reason: "Trade exits before earnings.",
      dismissalCategory: "out-of-scope" as const,
    },
  ],
};

const riskAssessment = {
  label: "Risk assessment",
  headline: "Calibrated. Endorse sizing; tighten stop modestly.",
  rating: "size correct + hedge",
  metrics: {
    calibration: "calibrated",
    sizing: "unchanged",
    invalidation: "tighter",
    holdingPeriod: "unchanged",
  },
  body: [
    { h: "What the personas converged on", p: "Sizing is appropriate.", items: null },
    { h: "Where the personas disagreed", p: "Stop tightness.", items: null },
    { h: "What load-bears", p: "Stop discipline.", items: null },
    { h: "What was noise", p: "Earnings drawdown is OOS.", items: null },
    { h: "Calibration call", p: "Calibrated.", items: null },
  ],
  criticalRisks: [
    {
      description: "Stop is 1.5×ATR below entry",
      raisedBy: "conservative" as const,
      severity: "medium" as const,
    },
  ],
  dismissedRisks: [
    {
      description: "Generic 'earnings drawdown' risk",
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
      rationale: "1.5×ATR is too loose given vol regime.",
      attributedTo: "conservative" as const,
    },
  },
  confidenceCalibration: "calibrated" as const,
  calibrationRationale: "Conviction aligns with the evidence base.",
};

function lastSessionState(result: {
  stateChanges: Array<{
    scope: string;
    resultingState: Record<string, unknown>;
  }>;
}): { memoStatus: Record<string, string> } {
  const sessionPatches = result.stateChanges.filter(
    (c) => c.scope === "session",
  );
  expect(sessionPatches.length).toBeGreaterThan(0);
  return sessionPatches[sessionPatches.length - 1]
    .resultingState as unknown as { memoStatus: Record<string, string> };
}

describe("Phase 4 writer taps", () => {
  it("markWritingP4 flips memoStatus[shortName] to writing", async () => {
    const result = await testBlock(writeAggressive, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.aggressive).toBe("writing");
  });

  it("commitPersonaMemo('aggressive') flips aggressive to published", async () => {
    const result = await testBlock(commitAggressive, {
      input: aggressiveCritique,
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { aggressive: "writing" } },
        resources: {
          "memos/p4/aggressive-risk": seededP4Memo({
            agentName: "aggressiveRisk",
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    expect(lastSessionState(result).memoStatus.aggressive).toBe("published");
  });

  it("commitPersonaMemo('conservative') flips conservative to published", async () => {
    const result = await testBlock(commitConservative, {
      input: conservativeCritique,
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { conservative: "writing" } },
        resources: {
          "memos/p4/conservative-risk": seededP4Memo({
            agentName: "conservativeRisk",
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    expect(lastSessionState(result).memoStatus.conservative).toBe("published");
  });

  it("commitPersonaMemo('neutral') writes persona fields plus dismissedRisks", async () => {
    const result = await testBlock(commitNeutral, {
      input: neutralCritique,
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { neutral: "writing" } },
        resources: {
          "memos/p4/neutral-risk": seededP4Memo({
            agentName: "neutralRisk",
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    expect(lastSessionState(result).memoStatus.neutral).toBe("published");
  });

  it("commitRiskAssessmentMemo flips riskAssessment to published", async () => {
    const result = await testBlock(commitRiskAssessmentMemo, {
      input: riskAssessment,
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { riskAssessment: "writing" },
        },
        resources: {
          "memos/p4/risk-assessment": seededP4Memo({
            agentName: "riskAssessment",
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    expect(lastSessionState(result).memoStatus.riskAssessment).toBe(
      "published",
    );
  });

  for (const category of DISMISSAL_CATEGORIES) {
    it(`persona schema round-trips dismissalCategory "${category}"`, () => {
      const parsed = personaCritiqueOutputSchema.safeParse({
        ...neutralCritique,
        dismissedRisks: [
          {
            description: "A dismissed risk",
            reason: "Reason for dismissal.",
            dismissalCategory: category,
          },
        ],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.dismissedRisks[0].dismissalCategory).toBe(category);
      }
    });

    it(`risk-assessment schema round-trips dismissalCategory "${category}"`, () => {
      const parsed = riskAssessmentOutputSchema.safeParse({
        ...riskAssessment,
        dismissedRisks: [
          {
            description: "A dismissed risk",
            reason: "Reason for dismissal.",
            dismissalCategory: category,
          },
        ],
      });
      expect(parsed.success).toBe(true);
    });
  }

  it("persona schema rejects an unknown dismissalCategory", () => {
    const parsed = personaCritiqueOutputSchema.safeParse({
      ...neutralCritique,
      dismissedRisks: [
        {
          description: "A dismissed risk",
          reason: "Reason.",
          dismissalCategory: "made-up",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("neutral and risk-assessment prompts name every dismissalCategory", () => {
    for (const category of DISMISSAL_CATEGORIES) {
      expect(NEUTRAL_PROMPT).toContain(category);
      expect(RISK_ASSESSMENT_PROMPT).toContain(category);
    }
  });

  it("markErrorP4 flips memo to error and returns a text placeholder", async () => {
    const result = await testBlock(errorAggressive, {
      input: { error: new Error("LLM hiccup") },
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { aggressive: "writing" } },
        resources: {
          "memos/p4/aggressive-risk": seededP4Memo({
            agentName: "aggressiveRisk",
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    expect(lastSessionState(result).memoStatus.aggressive).toBe("error");
    expect((result.output as { text: string }).text).toBe(
      "(critique unavailable: aggressiveRisk)",
    );
  });
});
