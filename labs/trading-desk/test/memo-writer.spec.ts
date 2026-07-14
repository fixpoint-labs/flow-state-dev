/**
 * Unit tests for the memo-writer taps — `markWriting`, `commitAnalystMemo`,
 * `markError`. Confirms each tap mutates both resource state (carries body
 * content) and session state (carries the live navigator status).
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { commitAnalystMemo } from "../flows/analysis/agents/analysts/writer";
import { markError, markWriting } from "../flows/analysis/agents/_recipe/memo-writer";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { latestMemoStatus } from "./_helpers/memo-status";

const writeBlock = markWriting("fundamentals");
const commitBlock = commitAnalystMemo("fundamentals");
const errorBlock = markError("fundamentals");

const fixtureFlow = defineFlow({
  kind: "trading-desk-memo-writer-test",
  actions: {
    write: { block: writeBlock },
    commit: { block: commitBlock },
    error: { block: errorBlock },
  },
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

/**
 * `commitAnalystMemo` and `markError` both `get()` the pre-existing memo (throws
 * when missing — see writer.ts). In the live pipeline, `setupPhase1Memos`
 * pre-creates the memo before any analyst runs; the unit tests have to
 * seed the equivalent state via the testBlock `session.resources` slot.
 */
const seededFundamentalsMemo = {
  status: "writing" as const,
  agentName: "fundamentalsAnalyst",
  agentTeam: "analyst" as const,
  phaseId: "p1",
  ticker: "NVDA",
  date: "2026-05-06",
  label: null,
  headline: null,
  rating: null,
  body: null,
  metrics: null,
  startedAt: new Date().toISOString(),
  completedAt: null,
  errorMessage: null,
};

const seededResources = {
  "memos/p1/fundamentals": seededFundamentalsMemo,
};

describe("memo-writer taps", () => {
  it("markWriting flips the memo to writing", async () => {
    const result = await testBlock(writeBlock, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    expect(latestMemoStatus(result.items, "memos/p1/fundamentals")).toBe("writing");
  });

  it("commitAnalystMemo writes thesis fields and flips the memo to published", async () => {
    const thesis = {
      label: "Fundamentals memo",
      headline: "Top-line growth durable; margins stable.",
      rating: "constructive" as const,
      metrics: [
        { key: "revGrowth", value: "+42%" },
        { key: "opMargin", value: "62%" },
        { key: "fcfConv", value: "91%" },
        { key: "forwardPE", value: "32.5x" },
        { key: "trailingPE", value: "47.2x" },
      ],
      body: [
        { h: "Top of book", p: "Revenue +42% YoY.", items: null },
        { h: "Trend", p: "Sequential acceleration.", items: null },
        { h: "Composite reading", p: "Fundamentals supportive.", items: null },
        { h: "Material items", p: null, items: ["Cap-ex ramp"] },
      ],
      citations: null,
      dataQuality: "full" as const,
    };
    const result = await testBlock(commitBlock, {
      input: thesis,
      flow: fixtureFlow,
      session: {
        state: baseSessionState,
        resources: seededResources,
      },
    });
    expect(result.error).toBeNull();
    expect(latestMemoStatus(result.items, "memos/p1/fundamentals")).toBe("published");
  });

  it("markError flips the memo to error and stamps an error message", async () => {
    const result = await testBlock(errorBlock, {
      input: { error: new Error("provider timeout") },
      flow: fixtureFlow,
      session: {
        state: baseSessionState,
        resources: seededResources,
      },
    });
    expect(result.error).toBeNull();
    expect(latestMemoStatus(result.items, "memos/p1/fundamentals")).toBe("error");
  });
});
