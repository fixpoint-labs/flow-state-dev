/**
 * Disclosure Analyst wiring and degradation tests (FIX-707).
 *
 * Verifies: memo commit transition, tool degradation when providers or
 * keys are missing, and discovery cost-gating. All offline — no live
 * providers, no LLM calls.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitMemo } from "../src/flows/trading-desk/phase-1/writer";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";
import { emptyPayload, skippedDiscoveryPayload } from "../src/flows/trading-desk/phase-1/tools/empty-payloads";
import { toolOutputSchemas } from "../src/flows/trading-desk/phase-1/tools/schemas";

function disclosureThesis() {
  return {
    label: "Disclosure memo",
    headline: "Filing read for NVDA.",
    rating: "constructive" as const,
    metrics: [
      { key: "guidanceVsConsensus", value: "raised, ~3% above" },
      { key: "revisionTrend", value: "up" },
      { key: "callTone", value: "confident" },
      { key: "ratingsPosture", value: "net buy, 18/24" },
      { key: "filingFlags", value: "none material" },
    ],
    body: [
      { h: "Latest filing", p: "10-K highlights.", items: null },
      { h: "Earnings call", p: "Guidance raised.", items: null },
      { h: "Consensus & revisions", p: "Beat + raise.", items: null },
      { h: "Read for NVDA", p: "Net constructive.", items: null },
      { h: "Data coverage", p: "Full.", items: null },
    ],
    citations: null,
    dataQuality: "full" as const,
  };
}

const commitBlock = commitMemo("disclosure");
const fixtureFlow = defineFlow({
  kind: "trading-desk-disclosure-test",
  actions: { commit: { block: commitBlock } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-1" as const,
  memoStatus: { disclosure: "writing" as const },
};

const seededResources = {
  "memos/p1/disclosure": {
    status: "writing" as const,
    agentName: "disclosureAnalyst",
    agentTeam: "analyst" as const,
    phaseId: "p1",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: new Date().toISOString(),
  },
};

describe("disclosure memo commit transition", () => {
  it("publishes a disclosure memo and flips memoStatus to published", async () => {
    const result = await testBlock(commitBlock, {
      input: disclosureThesis(),
      flow: fixtureFlow,
      session: { state: baseSessionState, resources: seededResources },
    });
    expect(result.error).toBeNull();
    const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
    const last = sessionPatches[sessionPatches.length - 1].resultingState as {
      memoStatus: Record<string, string>;
    };
    expect(last.memoStatus.disclosure).toBe("published");
  });
});

describe("disclosure tool degradation", () => {
  const input = { ticker: "NVDA", date: "2026-05-06" };

  it("get_sec_filings empty payload has unavailable source and empty arrays", () => {
    const payload = emptyPayload("get_sec_filings", input);
    expect(payload.source).toBe("unavailable");
    expect(payload.recentFilings).toEqual([]);
    expect(payload.latestPeriodic).toBeNull();
    expect(payload.redFlagProbes).toEqual([]);
    expect(toolOutputSchemas.get_sec_filings.safeParse(payload).success).toBe(true);
  });

  it("get_analyst_estimates empty payload has null consensus and price targets", () => {
    const payload = emptyPayload("get_analyst_estimates", input);
    expect(payload.source).toBe("unavailable");
    expect(payload.ratingsDistribution).toBeNull();
    expect(payload.consensusEstimates).toBeNull();
    expect(payload.priceTargets).toBeNull();
    expect(payload.recentRatingActions).toEqual([]);
    expect(toolOutputSchemas.get_analyst_estimates.safeParse(payload).success).toBe(true);
  });

  it("get_earnings_transcript empty payload has available=false", () => {
    const payload = emptyPayload("get_earnings_transcript", input);
    expect(payload.source).toBe("unavailable");
    expect(payload.available).toBe(false);
    expect(payload.content).toBeNull();
    expect(toolOutputSchemas.get_earnings_transcript.safeParse(payload).success).toBe(true);
  });

  it("discover_disclosure_context skipped payload on fast preset", () => {
    const payload = skippedDiscoveryPayload("discover_disclosure_context", input);
    expect(payload.source).toBe("skipped");
    expect(payload.items).toEqual([]);
    expect(toolOutputSchemas.discover_disclosure_context.safeParse(payload).success).toBe(true);
  });
});
