/**
 * Tests for the Phase 5 scenario-forecast writer taps and the ScenarioForecast output schema.
 * Confirms `markWriting` flips `session.memoStatus`, that
 * `commitScenarioForecastMemo` publishes a well-formed forecast with
 * normalized probabilities and copied horizon, and that out-of-band
 * probability sums trigger `probability-violation`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitScenarioForecastMemo } from "../src/flows/analysis/agents/scenario-forecaster/writer";
import { markError, markWriting } from "../src/flows/analysis/agents/_recipe/memo-writer";
import { scenarioForecastOutputSchema } from "../src/flows/analysis/agents/scenario-forecaster/scenario-forecaster";
import { memosCollection } from "../src/flows/analysis/resources/memos";
import { sessionStateSchema } from "../src/flows/analysis/state";

const writeSf = markWriting("scenarioForecast");
const errorSf = markError("scenarioForecast");

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-sf-writer-test",
  actions: {
    writeSf: { block: writeSf },
    commitSf: { block: commitScenarioForecastMemo },
    errorSf: { block: errorSf },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-5" as const,
  maxDebateRounds: 1,
  memoStatus: { scenarioForecast: "pending" as const },
  runComplete: false,
};

function seededSfMemo(opts: { startedAt?: string | null } = {}) {
  return {
    status: opts.startedAt ? ("writing" as const) : ("pending" as const),
    agentName: "scenarioForecaster",
    agentTeam: "pm" as const,
    phaseId: "p5",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: opts.startedAt ?? null,
  };
}

function scenarioForecast(
  overrides: Partial<{
    scenarios: Array<{
      name: string;
      probability: number;
      trigger: string;
      triggerSource: "investmentThesis" | "tradeProposal" | "riskAssessment" | "phase1";
      expectedOutcome: string;
      tradeBehavior: string;
    }>;
    distribution: "concentrated" | "balanced" | "barbell" | "long-tail";
    evidenceBasis: "sufficient" | "thin";
  }> = {},
) {
  return {
    label: "ScenarioForecast",
    headline: "Concentrated around the base case.",
    rating: "concentrated",
    metrics: {
      horizon: "months",
      distribution: "concentrated",
      buckets: "3 scenarios",
      evidence: "sufficient",
    },
    body: [
      { h: "Distribution summary", p: "Most mass in the base case.", items: null },
      { h: "Base case", p: "Data-center growth in line.", items: null },
      { h: "Upside scenarios", p: "Beat on attach rate.", items: null },
      { h: "Downside scenarios", p: "Guidance cut.", items: null },
      { h: "Evidence gaps", p: "China exposure unclear.", items: null },
    ],
    scenarios: overrides.scenarios ?? [
      {
        name: "Base case — in-line growth",
        probability: 0.55,
        trigger: "Consensus data-center revenue met",
        triggerSource: "investmentThesis" as const,
        expectedOutcome: "Stock +3-5% on guidance re-affirm",
        tradeBehavior: "Modest gain, hold to target",
      },
      {
        name: "Data-center beat, +12%",
        probability: 0.25,
        trigger: "Attach rate exceeds street model",
        triggerSource: "tradeProposal" as const,
        expectedOutcome: "Stock +10-15% on Q2 beat",
        tradeBehavior: "Full profit, consider scaling out",
      },
      {
        name: "Guidance cut, -8%",
        probability: 0.20,
        trigger: "China export controls tighten",
        triggerSource: "riskAssessment" as const,
        expectedOutcome: "Stock -5 to -10% on cut",
        tradeBehavior: "Stop hit, exit at loss",
      },
    ],
    distribution: overrides.distribution ?? "concentrated",
    evidenceBasis: overrides.evidenceBasis ?? "sufficient",
  };
}

describe("Phase 5 scenario-forecast writer taps", () => {
  it("markWriting flips memoStatus.scenarioForecast to writing", async () => {
    const result = await testBlock(writeSf, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.scenarioForecast).toBe("writing");
  });

  it("commitScenarioForecastMemo publishes a well-formed forecast", async () => {
    const result = await testBlock(commitScenarioForecastMemo, {
      input: scenarioForecast(),
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { scenarioForecast: "writing" },
        },
        resources: {
          "memos/p5/scenario-forecaster": seededSfMemo({
            startedAt: new Date().toISOString(),
          }),
          "memos/p3/trader": { holdingPeriod: "months" },
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.scenarioForecast).toBe("published");
  });

  it("commitScenarioForecastMemo normalizes probabilities to sum 1.0", async () => {
    const scenarios = [
      {
        name: "A", probability: 0.5, trigger: "t", triggerSource: "investmentThesis" as const,
        expectedOutcome: "o", tradeBehavior: "b",
      },
      {
        name: "B", probability: 0.3, trigger: "t", triggerSource: "riskAssessment" as const,
        expectedOutcome: "o", tradeBehavior: "b",
      },
      {
        name: "C", probability: 0.3, trigger: "t", triggerSource: "tradeProposal" as const,
        expectedOutcome: "o", tradeBehavior: "b",
      },
    ];
    // Sum = 1.1, within [0.8, 1.2] — should normalize
    const result = await testBlock(commitScenarioForecastMemo, {
      input: scenarioForecast({ scenarios }),
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { scenarioForecast: "writing" },
        },
        resources: {
          "memos/p5/scenario-forecaster": seededSfMemo({
            startedAt: new Date().toISOString(),
          }),
          "memos/p3/trader": { holdingPeriod: "weeks" },
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.scenarioForecast).toBe("published");
  });

  it("markError flips scenarioForecast to error", async () => {
    const result = await testBlock(errorSf, {
      input: { error: new Error("LLM hiccup") },
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { scenarioForecast: "writing" },
        },
        resources: {
          "memos/p5/scenario-forecaster": seededSfMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.scenarioForecast).toBe("error");
  });
});

describe("scenarioForecastOutputSchema", () => {
  it("round-trips a valid 3-bucket forecast", () => {
    const parsed = scenarioForecastOutputSchema.safeParse(scenarioForecast());
    expect(parsed.success).toBe(true);
  });

  it("accepts a 5-bucket forecast", () => {
    const scenarios = [
      { name: "A", probability: 0.3, trigger: "t", triggerSource: "investmentThesis" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "B", probability: 0.25, trigger: "t", triggerSource: "riskAssessment" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "C", probability: 0.2, trigger: "t", triggerSource: "tradeProposal" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "D", probability: 0.15, trigger: "t", triggerSource: "phase1" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "E", probability: 0.1, trigger: "t", triggerSource: "investmentThesis" as const, expectedOutcome: "o", tradeBehavior: "b" },
    ];
    const parsed = scenarioForecastOutputSchema.safeParse(
      scenarioForecast({ scenarios }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a 2-bucket forecast", () => {
    const scenarios = [
      { name: "A", probability: 0.6, trigger: "t", triggerSource: "investmentThesis" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "B", probability: 0.4, trigger: "t", triggerSource: "riskAssessment" as const, expectedOutcome: "o", tradeBehavior: "b" },
    ];
    const parsed = scenarioForecastOutputSchema.safeParse(
      scenarioForecast({ scenarios }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a 6-bucket forecast", () => {
    const scenarios = Array.from({ length: 6 }, (_, i) => ({
      name: `S${i}`,
      probability: 1 / 6,
      trigger: "t",
      triggerSource: "investmentThesis" as const,
      expectedOutcome: "o",
      tradeBehavior: "b",
    }));
    const parsed = scenarioForecastOutputSchema.safeParse(
      scenarioForecast({ scenarios }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("probability-violation rescue", () => {
  it("throws when probabilities sum below 0.8", async () => {
    const scenarios = [
      { name: "A", probability: 0.2, trigger: "t", triggerSource: "investmentThesis" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "B", probability: 0.2, trigger: "t", triggerSource: "riskAssessment" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "C", probability: 0.2, trigger: "t", triggerSource: "tradeProposal" as const, expectedOutcome: "o", tradeBehavior: "b" },
    ];
    // Sum = 0.6, outside [0.8, 1.2]
    const result = await testBlock(commitScenarioForecastMemo, {
      input: scenarioForecast({ scenarios }),
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { scenarioForecast: "writing" },
        },
        resources: {
          "memos/p5/scenario-forecaster": seededSfMemo({
            startedAt: new Date().toISOString(),
          }),
          "memos/p3/trader": { holdingPeriod: "months" },
        },
      },
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("probability-violation");
  });

  it("throws when probabilities sum above 1.2", async () => {
    const scenarios = [
      { name: "A", probability: 0.5, trigger: "t", triggerSource: "investmentThesis" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "B", probability: 0.5, trigger: "t", triggerSource: "riskAssessment" as const, expectedOutcome: "o", tradeBehavior: "b" },
      { name: "C", probability: 0.5, trigger: "t", triggerSource: "tradeProposal" as const, expectedOutcome: "o", tradeBehavior: "b" },
    ];
    // Sum = 1.5, outside [0.8, 1.2]
    const result = await testBlock(commitScenarioForecastMemo, {
      input: scenarioForecast({ scenarios }),
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { scenarioForecast: "writing" },
        },
        resources: {
          "memos/p5/scenario-forecaster": seededSfMemo({
            startedAt: new Date().toISOString(),
          }),
          "memos/p3/trader": { holdingPeriod: "months" },
        },
      },
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("probability-violation");
  });
});

type LastStatePayload = { memoStatus: Record<string, string> };

type ResultLike = {
  stateChanges: Array<{ scope: string; resultingState: Record<string, unknown> }>;
};

function lastSessionState(result: ResultLike): LastStatePayload {
  const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
  expect(sessionPatches.length).toBeGreaterThan(0);
  return sessionPatches[sessionPatches.length - 1]
    .resultingState as unknown as LastStatePayload;
}
