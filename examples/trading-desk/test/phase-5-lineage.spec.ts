/**
 * Tests for the Phase 5 dependency-lineage check inside
 * `commitPortfolioManagerMemo`. Every item in `trader.dependsOn` must
 * appear in the PM's `keyDependencies` or `acknowledgedAndDropped`; an
 * orphaned dependency throws, which the pipeline's per-step rescue turns
 * into an `error` memo. Here we exercise the throw directly through
 * `testBlock` (the rescue wiring itself is covered in phase-5-writer.spec).
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitPortfolioManagerMemo } from "../src/flows/trading-desk/phase-5/writer";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-lineage-test",
  actions: {
    commitPm: { block: commitPortfolioManagerMemo },
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
  memoStatus: { portfolioManager: "writing" as const },
  runComplete: false,
};

function seededPmMemo() {
  return {
    status: "writing" as const,
    agentName: "portfolioManager",
    agentTeam: "pm" as const,
    phaseId: "p5",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
  };
}

function decision(opts: {
  keyDependencies: string[];
  acknowledgedAndDropped?: { item: string; reason: string }[];
}) {
  return {
    label: "PortfolioDecision",
    headline: "Final decision.",
    rating: "Hold",
    metrics: {
      rating: "Hold",
      ticker: "NVDA",
      window: "6 months",
      size: "0%",
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
      { h: "Why not the adjacent tier", p: "Adjacent.", items: null },
      { h: "Deferred follow-on", p: "Defer.", items: null },
      { h: "Citations", p: "Sources.", items: null },
    ],
    finalRating: "Hold" as const,
    decisionSummary: "Test summary.",
    decisionConfidence: 0.5,
    acceptedAdjustments: {
      sizing: { applied: true, reasoning: "OK." },
      holdingPeriod: { applied: true, reasoning: "OK." },
      invalidation: { applied: true, reasoning: "OK." },
    },
    keyDependencies: opts.keyDependencies,
    asymmetricEdge: "",
    nearTermCatalyst: "",
    invalidationTrigger: "",
    acknowledgedAndDropped: opts.acknowledgedAndDropped ?? [],
    primaryScenario: "",
  };
}

async function commitWith(opts: {
  traderDependsOn: string[] | null;
  keyDependencies: string[];
  acknowledgedAndDropped?: { item: string; reason: string }[];
}) {
  return testBlock(commitPortfolioManagerMemo, {
    input: decision({
      keyDependencies: opts.keyDependencies,
      acknowledgedAndDropped: opts.acknowledgedAndDropped,
    }),
    flow: fixtureFlow,
    session: {
      state: baseSessionState,
      resources: {
        "memos/p5/portfolio-manager": seededPmMemo(),
        "memos/p3/trader": { direction: "flat", dependsOn: opts.traderDependsOn },
      },
    },
  });
}

describe("Phase 5 dependency lineage", () => {
  it("commits when every trader dependency is carried in keyDependencies", async () => {
    const deps = ["AI cap-ex cycle", "China export controls", "Margin trajectory"];
    const result = await commitWith({
      traderDependsOn: deps,
      keyDependencies: deps,
    });
    expect(result.error).toBeNull();
  });

  it("commits when dependencies split across keyDependencies and acknowledgedAndDropped", async () => {
    const result = await commitWith({
      traderDependsOn: ["AI cap-ex cycle", "China export controls", "Margin trajectory"],
      keyDependencies: ["AI cap-ex cycle", "China export controls"],
      acknowledgedAndDropped: [
        { item: "Margin trajectory", reason: "Already priced into the stop." },
      ],
    });
    expect(result.error).toBeNull();
  });

  it("throws a lineage-violation when a trader dependency is orphaned", async () => {
    const result = await commitWith({
      traderDependsOn: ["AI cap-ex cycle", "China export controls", "Margin trajectory"],
      keyDependencies: ["AI cap-ex cycle"],
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("lineage-violation");
    expect(result.error?.message).toContain("China export controls");
    expect(result.error?.message).toContain("Margin trajectory");
  });

  it("commits trivially when trader.dependsOn is empty", async () => {
    const result = await commitWith({
      traderDependsOn: [],
      keyDependencies: [],
    });
    expect(result.error).toBeNull();
  });
});
