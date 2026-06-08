/**
 * Tests for the Phase 5 dependency-lineage check inside
 * `commitPortfolioManagerMemo`. Every item in `trader.dependsOn` must be
 * dispositioned by the PM in `traderDependencyDispositions`, referenced by
 * its array index (the same `[n]` it was rendered with). An index left
 * un-dispositioned throws, which the pipeline's per-step rescue turns into
 * an `error` memo. Here we exercise the throw directly through `testBlock`
 * (the rescue wiring itself is covered in phase-5-writer.spec).
 *
 * The check is referential, not string-based: the PM may phrase
 * `keyDependencies` however it likes — the regression test below proves a
 * fully paraphrased `keyDependencies` still passes as long as every trader
 * index is dispositioned. (Previously the writer string-matched the PM's
 * free text against the trader's, so any rewording orphaned the dependency
 * and failed the run.)
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitPortfolioManagerMemo } from "../src/flows/analysis/agents/portfolio-manager/writer";
import { memosCollection } from "../src/flows/analysis/resources";
import { sessionStateSchema } from "../src/flows/analysis/state";
import { valuationSpineResource } from "../src/flows/analysis/valuation-spine-resource";

type Disposition = {
  index: number;
  status: "carried" | "dropped";
  note: string;
};

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-lineage-test",
  actions: {
    commitPm: { block: commitPortfolioManagerMemo },
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

/** Disposition every index 0..n-1 as carried — the common "kept it all" case. */
function carryAll(n: number): Disposition[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    status: "carried" as const,
    note: "Still material to the decision.",
  }));
}

function decision(opts: {
  keyDependencies: string[];
  traderDependencyDispositions?: Disposition[];
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
    traderDependencyDispositions: opts.traderDependencyDispositions ?? [],
    primaryScenario: "",
    ratingOverrideReason: "",
    portfolioFit: {
      action: "hold" as const,
      targetWeightPct: 0,
      sizingRationale: "Sized without portfolio context (none supplied).",
      concentrationRisk: "",
      suggestedAccount: "",
      convictionBasis: "",
    },
  };
}

async function commitWith(opts: {
  traderDependsOn: string[] | null;
  keyDependencies: string[];
  traderDependencyDispositions?: Disposition[];
}) {
  return testBlock(commitPortfolioManagerMemo, {
    input: decision({
      keyDependencies: opts.keyDependencies,
      traderDependencyDispositions: opts.traderDependencyDispositions,
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
  it("commits when every trader dependency index is dispositioned", async () => {
    const deps = ["AI cap-ex cycle", "China export controls", "Margin trajectory"];
    const result = await commitWith({
      traderDependsOn: deps,
      keyDependencies: deps,
      traderDependencyDispositions: carryAll(3),
    });
    expect(result.error).toBeNull();
  });

  it("commits when dispositions mix carried and dropped", async () => {
    const result = await commitWith({
      traderDependsOn: ["AI cap-ex cycle", "China export controls", "Margin trajectory"],
      keyDependencies: ["AI cap-ex cycle", "China export controls"],
      traderDependencyDispositions: [
        { index: 0, status: "carried", note: "Core to the thesis." },
        { index: 1, status: "carried", note: "Tail risk we still hold." },
        { index: 2, status: "dropped", note: "Already priced into the stop." },
      ],
    });
    expect(result.error).toBeNull();
  });

  it("commits even when keyDependencies share no text with trader.dependsOn (regression)", async () => {
    // The PM paraphrases every dependency in its free-text keyDependencies
    // and adds new ones. Under the old string-match check this orphaned all
    // three trader deps and failed the run. With index-based dispositions
    // the lineage check passes because every index is accounted for.
    const result = await commitWith({
      traderDependsOn: [
        "Whether operating margins are compressing and by how much",
        "Whether AUM scaling translates to higher distributable earnings after overhead",
        "Whether current valuation is justified once unverified sentiment is removed",
      ],
      keyDependencies: [
        "Operating margin compression magnitude",
        "Distributable-earnings leverage from AUM growth",
        "Valuation support after stripping sentiment",
        "A brand-new dependency the trader never named",
      ],
      traderDependencyDispositions: carryAll(3),
    });
    expect(result.error).toBeNull();
  });

  it("throws a lineage-violation when a trader dependency index is not dispositioned", async () => {
    const result = await commitWith({
      traderDependsOn: ["AI cap-ex cycle", "China export controls", "Margin trajectory"],
      keyDependencies: ["AI cap-ex cycle"],
      traderDependencyDispositions: [
        { index: 0, status: "carried", note: "Carried." },
      ],
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("lineage-violation");
    // The message names the orphaned dependencies (indices 1 and 2).
    expect(result.error?.message).toContain("China export controls");
    expect(result.error?.message).toContain("Margin trajectory");
  });

  it("commits trivially when trader.dependsOn is empty", async () => {
    const result = await commitWith({
      traderDependsOn: [],
      keyDependencies: [],
      traderDependencyDispositions: [],
    });
    expect(result.error).toBeNull();
  });
});
