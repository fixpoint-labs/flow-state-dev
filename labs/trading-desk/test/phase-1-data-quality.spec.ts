/**
 * Wiring tests for the Phase 1 `dataQuality` sentinel (FIX-681).
 *
 * The sentinel is an LLM-emitted field on `thesisOutputSchema`; the analyst
 * generators are mocked in this offline suite, so LLM adherence to the
 * prompt's classification rule is not unit-testable. What IS testable — and
 * what these tests guard — is the contract and the plumbing:
 *
 *   1. `thesisOutputSchema` requires `dataQuality` and accepts exactly the
 *      three enum values (fails if the field is dropped or the enum drifts).
 *   2. `commitAnalystMemo` accepts a thesis carrying any of the three values and
 *      publishes the memo without error (fails if the commit projection
 *      stops threading the new required field through).
 *
 * The downstream consequence of `dataQuality === "unavailable"` (the
 * "do not synthesize" formatter prefix) is covered in `format-memos.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitAnalystMemo } from "../flows/analysis/agents/analysts/writer";
import { thesisOutputSchema } from "../flows/analysis/agents/analysts/thesis-schema";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { latestMemoStatus } from "./_helpers/memo-status";

const DATA_QUALITY_VALUES = ["full", "partial", "unavailable"] as const;

function thesisWith(dataQuality: (typeof DATA_QUALITY_VALUES)[number]) {
  return {
    label: "Fundamentals memo",
    headline: "Headline.",
    rating: "neutral" as const,
    metrics: [
      { key: "revGrowth", value: "n/a" },
      { key: "opMargin", value: "n/a" },
      { key: "fcfConv", value: "n/a" },
      { key: "forwardPE", value: "n/a" },
      { key: "trailingPE", value: "n/a" },
    ],
    body: [{ h: "Top of book", p: "Body.", items: null }],
    citations: null,
    dataQuality,
  };
}

describe("thesisOutputSchema dataQuality contract", () => {
  for (const value of DATA_QUALITY_VALUES) {
    it(`accepts dataQuality="${value}"`, () => {
      expect(thesisOutputSchema.parse(thesisWith(value)).dataQuality).toBe(value);
    });
  }

  it("rejects a thesis missing dataQuality", () => {
    const { dataQuality: _omit, ...withoutDataQuality } = thesisWith("full");
    expect(thesisOutputSchema.safeParse(withoutDataQuality).success).toBe(false);
  });

  it("rejects an out-of-vocabulary dataQuality value", () => {
    expect(
      thesisOutputSchema.safeParse({ ...thesisWith("full"), dataQuality: "degraded" }).success,
    ).toBe(false);
  });
});

const commitBlock = commitAnalystMemo("fundamentals");

const fixtureFlow = defineFlow({
  kind: "trading-desk-data-quality-test",
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
};

const seededResources = {
  "memos/p1/fundamentals": {
    status: "writing" as const,
    agentName: "fundamentalsAnalyst",
    agentTeam: "analyst" as const,
    phaseId: "p1",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: new Date().toISOString(),
  },
};

describe("commitAnalystMemo with dataQuality sentinel", () => {
  for (const value of DATA_QUALITY_VALUES) {
    it(`publishes a memo carrying dataQuality="${value}"`, async () => {
      const result = await testBlock(commitBlock, {
        input: thesisWith(value),
        flow: fixtureFlow,
        session: { state: baseSessionState, resources: seededResources },
      });
      expect(result.error).toBeNull();
      expect(
        latestMemoStatus(result.items, "memos/p1/fundamentals"),
      ).toBe("published");
    });
  }
});
