/**
 * Tests for the Phase 6 writer taps and the ThesisAlignment output schema.
 * Confirms `markWriting` flips `session.memoStatus`, that
 * `commitThesisAlignmentMemo` publishes a well-formed audit, and that the
 * schema enforces the `blindSpots.min(1)` floor (the structural guard that
 * forces the validator to do the audit work).
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitThesisAlignmentMemo } from "../src/flows/analysis/agents/thesis-validator/writer";
import { markError, markWriting } from "../src/flows/analysis/agents/_recipe/memo-writer";
import { thesisAlignmentOutputSchema } from "../src/flows/analysis/agents/thesis-validator/thesis-validator";
import { memosCollection } from "../src/flows/analysis/resources/memos";
import { sessionStateSchema } from "../src/flows/analysis/state";

const writeTv = markWriting("thesisAlignment");
const errorTv = markError("thesisAlignment");

const fixtureFlow = defineFlow({
  kind: "trading-desk-p6-writer-test",
  actions: {
    writeTv: { block: writeTv },
    commitTv: { block: commitThesisAlignmentMemo },
    errorTv: { block: errorTv },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-6" as const,
  maxDebateRounds: 1,
  memoStatus: { thesisAlignment: "pending" as const },
  runComplete: true,
  userThesis: "NVDA data-center growth decelerates faster than consensus.",
};

function seededTvMemo(opts: { startedAt?: string | null } = {}) {
  return {
    status: opts.startedAt ? ("writing" as const) : ("pending" as const),
    agentName: "thesisValidator",
    agentTeam: "pm" as const,
    phaseId: "p6",
    ticker: "NVDA",
    date: "2026-05-06",
    startedAt: opts.startedAt ?? null,
  };
}

function thesisAlignment(
  alignment: "aligned" | "partially-aligned" | "contradicted" | "orthogonal",
  overrides: Partial<{
    supportingEvidence: { source: string; claim: string }[];
    contradictingEvidence: { source: string; claim: string }[];
    blindSpots: string[];
    proposedRevision: string | null;
  }> = {},
) {
  return {
    label: "ThesisAlignment",
    headline: "The evidence partially supports the user.",
    rating: alignment,
    metrics: {
      alignment,
      confidence: "0.7",
      supporting: "2 items",
      contradicting: "1 item",
      blindSpots: "1 item",
    },
    body: [
      { h: "What the evidence supports", p: "Supported.", items: null },
      { h: "What the evidence contradicts", p: "Contradicted.", items: null },
      { h: "Blind spots — what the pipeline found that you did not mention", p: "Blind.", items: null },
      { h: "Proposed revision", p: "Revise.", items: null },
    ],
    alignment,
    alignmentConfidence: 0.7,
    supportingEvidence:
      overrides.supportingEvidence ??
      [{ source: "Fundamentals Analyst", claim: "Margins durable." }],
    contradictingEvidence:
      overrides.contradictingEvidence ??
      [{ source: "Risk Assessment", claim: "Cycle pull-forward risk." }],
    blindSpots: overrides.blindSpots ?? ["Did not mention competitive dynamics."],
    proposedRevision:
      "proposedRevision" in overrides
        ? overrides.proposedRevision!
        : "Re-frame around margin durability, not pure growth deceleration.",
    citations: null,
  };
}

describe("Phase 6 writer taps", () => {
  it("markWriting flips memoStatus.thesisAlignment to writing", async () => {
    const result = await testBlock(writeTv, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.thesisAlignment).toBe("writing");
  });

  it("commitThesisAlignmentMemo publishes a partially-aligned audit", async () => {
    const result = await testBlock(commitThesisAlignmentMemo, {
      input: thesisAlignment("partially-aligned"),
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { thesisAlignment: "writing" } },
        resources: {
          "memos/p6/thesis-alignment": seededTvMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.thesisAlignment).toBe("published");
  });

  it("markError flips thesisAlignment to error", async () => {
    const result = await testBlock(errorTv, {
      input: { error: new Error("LLM hiccup") },
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { thesisAlignment: "writing" } },
        resources: {
          "memos/p6/thesis-alignment": seededTvMemo({
            startedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(result.error).toBeNull();
    const last = lastSessionState(result);
    expect(last.memoStatus.thesisAlignment).toBe("error");
  });
});

describe("thesisAlignmentOutputSchema", () => {
  it("round-trips a valid audit", () => {
    const parsed = thesisAlignmentOutputSchema.safeParse(
      thesisAlignment("partially-aligned"),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts blindSpots of length exactly 1 (the minimum boundary)", () => {
    const parsed = thesisAlignmentOutputSchema.safeParse(
      thesisAlignment("partially-aligned", { blindSpots: ["one"] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty blindSpots array", () => {
    const parsed = thesisAlignmentOutputSchema.safeParse(
      thesisAlignment("partially-aligned", { blindSpots: [] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("accepts proposedRevision: null (valid for an aligned verdict)", () => {
    const parsed = thesisAlignmentOutputSchema.safeParse(
      thesisAlignment("aligned", { proposedRevision: null }),
    );
    expect(parsed.success).toBe(true);
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
