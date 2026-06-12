/**
 * Anti-yes-man enforcement for the Phase 6 validator.
 *
 * `alignment: "aligned"` is the highest bar and the failure mode the phase
 * exists to prevent. The commit handler rejects an `aligned` verdict unless
 * `supportingEvidence` has ≥ 2 entries AND `contradictingEvidence` is empty.
 * It also rejects a non-aligned verdict that omits `proposedRevision`. The
 * rule lives in the writer (not the schema) because a Zod refinement would
 * break OpenAI strict structured output — so these tests drive the commit
 * handler directly and assert it throws (which flips the memo to `error` via
 * the per-step rescue in the live pipeline).
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitThesisAlignmentMemo } from "../src/flows/analysis/agents/thesis-validator/writer";
import type { ThesisAlignmentOutput } from "../src/flows/analysis/agents/thesis-validator/thesis-validator";
import { memosCollection } from "../src/flows/analysis/resources";
import { sessionStateSchema } from "../src/flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p6-enforcement-test",
  actions: { commitTv: { block: commitThesisAlignmentMemo } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const sessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-6" as const,
  maxDebateRounds: 1,
  runComplete: true,
  userThesis: "A thesis long enough to audit against the pipeline.",
};

const seededMemo = {
  status: "writing" as const,
  agentName: "thesisValidator",
  agentTeam: "pm" as const,
  phaseId: "p6",
  ticker: "NVDA",
  date: "2026-05-06",
  startedAt: new Date().toISOString(),
};

function alignedAudit(
  overrides: Partial<{
    supportingEvidence: { source: string; claim: string }[];
    contradictingEvidence: { source: string; claim: string }[];
  }> = {},
): ThesisAlignmentOutput {
  return {
    label: "ThesisAlignment",
    headline: "The evidence fully supports the user.",
    rating: "aligned",
    metrics: {
      alignment: "aligned",
      confidence: "0.85",
      supporting: "2 items",
      contradicting: "0 items",
      blindSpots: "1 item",
    },
    body: [
      { h: "What the evidence supports", p: "Supported.", items: null },
      { h: "What the evidence contradicts", p: "Nothing.", items: null },
      { h: "Blind spots — what the pipeline found that you did not mention", p: "Blind.", items: null },
      { h: "Your thesis stands", p: "Stands.", items: null },
    ],
    alignment: "aligned" as const,
    alignmentConfidence: 0.85,
    supportingEvidence:
      overrides.supportingEvidence ??
      [
        { source: "Fundamentals Analyst", claim: "Margins durable." },
        { source: "Investment thesis", claim: "Demand durable." },
      ],
    contradictingEvidence: overrides.contradictingEvidence ?? [],
    blindSpots: ["Did not mention competitive dynamics."],
    proposedRevision: null,
    citations: null,
  };
}

async function commit(input: ThesisAlignmentOutput) {
  return testBlock(commitThesisAlignmentMemo, {
    input,
    flow: fixtureFlow,
    session: {
      state: sessionState,
      resources: { "memos/p6/thesis-alignment": seededMemo },
    },
  });
}

describe("Phase 6 anti-yes-man enforcement", () => {
  it("accepts aligned with ≥ 2 supporting and no contradicting evidence", async () => {
    const result = await commit(alignedAudit());
    expect(result.error).toBeNull();
  });

  it("rejects aligned when contradictingEvidence is non-empty", async () => {
    const result = await commit(
      alignedAudit({
        contradictingEvidence: [
          { source: "Risk Assessment", claim: "Cycle pull-forward." },
        ],
      }),
    );
    expect(result.error).not.toBeNull();
    expect(String(result.error)).toContain("alignment-violation");
  });

  it("rejects aligned when supportingEvidence has fewer than 2 entries", async () => {
    const result = await commit(
      alignedAudit({
        supportingEvidence: [
          { source: "Fundamentals Analyst", claim: "Margins durable." },
        ],
      }),
    );
    expect(result.error).not.toBeNull();
    expect(String(result.error)).toContain("alignment-violation");
  });

  it("rejects a non-aligned verdict that omits proposedRevision", async () => {
    const audit = {
      ...alignedAudit(),
      rating: "contradicted",
      alignment: "contradicted" as const,
      contradictingEvidence: [
        { source: "Risk Assessment", claim: "Cycle pull-forward." },
      ],
      proposedRevision: null,
    };
    const result = await commit(audit);
    expect(result.error).not.toBeNull();
    expect(String(result.error)).toContain("alignment-violation");
  });
});
