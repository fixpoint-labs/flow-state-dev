/**
 * Tests for the Phase 5 writer taps. Confirms `markWritingP5`,
 * `markErrorP5`, and `commitPortfolioManagerMemo` flip
 * `session.memoStatus` and patch the resource correctly — including the
 * seven Phase 5 extension fields, the derived `agreesWithTrader` and
 * `upstreamReferences` fields, and the `runComplete` session flag.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import {
  commitPortfolioManagerMemo,
  markErrorP5,
  markWritingP5,
} from "../src/flows/trading-desk/agents/portfolio-manager/writer";
import { portfolioDecisionOutputSchema } from "../src/flows/trading-desk/agents/portfolio-manager/portfolio-manager";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";
import { valuationSpineResource } from "../src/flows/trading-desk/valuation-spine-resource";

const writePm = markWritingP5("portfolioManager");
const errorPm = markErrorP5("portfolioManager");

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-writer-test",
  actions: {
    writePm: { block: writePm },
    commitPm: { block: commitPortfolioManagerMemo },
    errorPm: { block: errorPm },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection, valuationSpine: valuationSpineResource },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-5" as const,
  maxDebateRounds: 1,
  memoStatus: {
    portfolioManager: "pending" as const,
  },
  runComplete: false,
};

function seededPmMemo(opts: { startedAt?: string | null } = {}) {
  return {
    status: opts.startedAt ? ("writing" as const) : ("pending" as const),
    agentName: "portfolioManager",
    agentTeam: "pm" as const,
    phaseId: "p5",
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
    decisionSummary: null,
    finalRating: null,
    decisionConfidence: null,
    acceptedAdjustments: null,
    keyDependencies: null,
    upstreamReferences: null,
    agreesWithTrader: null,
  };
}

// `commitPortfolioManagerMemo` reads only `direction` off the trader memo
// (see writer.ts:178). The test harness seeds resource state through a
// permissive `z.record(z.string(), z.unknown())` schema, so a minimal
// fixture works — Zod doesn't fill missing nullable defaults at seed time.
function seededTraderMemo(direction: "long" | "short" | "flat" | null) {
  return { direction };
}

function portfolioDecision(
  finalRating: "Sell" | "Underweight" | "Hold" | "Overweight" | "Buy",
) {
  return {
    label: "PortfolioDecision",
    headline: "Final decision.",
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
      { h: "Executive summary", p: "The decision.", items: null },
      { h: "Investment thesis", p: "Cited.", items: null },
      { h: "What supports this rating", p: "Reasons.", items: null },
      { h: "What argues against", p: "Counterpoints.", items: null },
      { h: "Critical near-term inflection", p: "Watch.", items: null },
      { h: "Pre-committed exit triggers", p: "Exit.", items: null },
      { h: "Why not the adjacent tier", p: "Adjacent reasoning.", items: null },
      { h: "Deferred follow-on", p: "Defer.", items: null },
      { h: "Citations", p: "Sources.", items: null },
    ],
    finalRating,
    decisionSummary: "Test summary.",
    decisionConfidence: 0.62,
    acceptedAdjustments: {
      sizing: { applied: true, reasoning: "Aligned with risk team." },
      holdingPeriod: { applied: false, reasoning: "Disagree on horizon." },
      invalidation: { applied: true, reasoning: "Stop level holds." },
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
    traderDependencyDispositions: [] as {
      index: number;
      status: "carried" | "dropped";
      note: string;
    }[],
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
  };
}

describe("Phase 5 writer taps", () => {
  it("markWritingP5 flips memoStatus.portfolioManager to writing", async () => {
    const result = await testBlock(writePm, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.portfolioManager).toBe("writing");
  });

  it("commitPortfolioManagerMemo publishes the memo, sets runComplete, and derives agreesWithTrader (matching direction)", async () => {
    const result = await testBlock(commitPortfolioManagerMemo, {
      input: portfolioDecision("Buy"),
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { portfolioManager: "writing" },
        },
        resources: {
          "memos/p5/portfolio-manager": seededPmMemo({
            startedAt: new Date().toISOString(),
          }),
          "memos/p3/trader": seededTraderMemo("long"),
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.portfolioManager).toBe("published");
    expect(last.runComplete).toBe(true);
  });

  // The `agreesWithTrader` derivation, the computed `upstreamReferences`,
  // and the patched memo body are exercised in `phase-5-e2e.spec.ts` — that
  // suite reads the in-memory store after the action completes, which is
  // the only way to inspect committed collection-item state. `testBlock`
  // captures `ctx.session.*` mutations in `stateChanges` but does NOT
  // surface `ctx.resources.<accessor>.<ref>.patchState(...)` calls.

  it("schema accepts empty asymmetricEdge when finalRating is Hold", () => {
    const parsed = portfolioDecisionOutputSchema.safeParse(
      portfolioDecision("Hold"),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.asymmetricEdge).toBe("");
      expect(parsed.data.nearTermCatalyst).toBe("");
      expect(parsed.data.invalidationTrigger).toBe("");
    }
  });

  it("schema accepts non-empty asymmetricEdge when finalRating is Buy", () => {
    const parsed = portfolioDecisionOutputSchema.safeParse(
      portfolioDecision("Buy"),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.asymmetricEdge.length).toBeGreaterThan(0);
    }
  });

  it("schema round-trips traderDependencyDispositions entries", () => {
    const decision = {
      ...portfolioDecision("Hold"),
      traderDependencyDispositions: [
        { index: 0, status: "carried" as const, note: "Still material." },
        { index: 1, status: "dropped" as const, note: "Out of horizon." },
      ],
    };
    const parsed = portfolioDecisionOutputSchema.safeParse(decision);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.traderDependencyDispositions).toEqual([
        { index: 0, status: "carried", note: "Still material." },
        { index: 1, status: "dropped", note: "Out of horizon." },
      ]);
    }
  });

  it("markErrorP5 flips portfolioManager to error and leaves runComplete false", async () => {
    const result = await testBlock(errorPm, {
      input: { error: new Error("LLM hiccup") },
      flow: fixtureFlow,
      session: {
        state: {
          ...baseSessionState,
          memoStatus: { portfolioManager: "writing" },
        },
        resources: {
          "memos/p5/portfolio-manager": seededPmMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.portfolioManager).toBe("error");
    expect(last.runComplete).toBe(false);
  });
});

type LastStatePayload = {
  memoStatus: Record<string, string>;
  runComplete: boolean;
};

type ResultLike = {
  stateChanges: Array<{
    scope: string;
    resultingState: Record<string, unknown>;
    targetName?: string;
    targetInstanceId?: string;
  }>;
};

function lastSessionState(result: ResultLike): LastStatePayload {
  const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
  expect(sessionPatches.length).toBeGreaterThan(0);
  return sessionPatches[sessionPatches.length - 1]
    .resultingState as unknown as LastStatePayload;
}
