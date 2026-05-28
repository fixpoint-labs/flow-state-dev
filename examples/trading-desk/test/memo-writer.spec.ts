/**
 * Unit tests for the memo-writer taps — `markWriting`, `commitMemo`,
 * `markError`. Confirms each tap mutates both resource state (carries body
 * content) and session state (carries the live navigator status).
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import {
  commitMemo,
  markError,
  markWriting,
} from "../src/flows/trading-desk/phase-1/writer";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const writeBlock = markWriting("fundamentals");
const commitBlock = commitMemo("fundamentals");
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
  memoStatus: { fundamentals: "pending" as const },
};

/**
 * `commitMemo` and `markError` both `get()` the pre-existing memo (throws
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
  it("markWriting flips memoStatus to writing", async () => {
    const result = await testBlock(writeBlock, {
      input: {},
      flow: fixtureFlow,
      session: { state: baseSessionState },
    });
    expect(result.error).toBeNull();
    const sessionState = lastSessionState(result);
    expect(sessionState.memoStatus.fundamentals).toBe("writing");
  });

  it("commitMemo writes thesis fields and flips memoStatus to published", async () => {
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
        state: { ...baseSessionState, memoStatus: { fundamentals: "writing" } },
        resources: seededResources,
      },
    });
    expect(result.error).toBeNull();
    const sessionState = lastSessionState(result);
    expect(sessionState.memoStatus.fundamentals).toBe("published");
  });

  it("markError flips memoStatus to error and stamps an error message", async () => {
    const result = await testBlock(errorBlock, {
      input: { error: new Error("provider timeout") },
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { fundamentals: "writing" } },
        resources: seededResources,
      },
    });
    expect(result.error).toBeNull();
    const sessionState = lastSessionState(result);
    expect(sessionState.memoStatus.fundamentals).toBe("error");
  });
});

type LastStatePayload = {
  memoStatus: Record<string, string>;
};

function lastSessionState(result: {
  stateChanges: Array<{ scope: string; resultingState: Record<string, unknown> }>;
}): LastStatePayload {
  const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
  expect(sessionPatches.length).toBeGreaterThan(0);
  return sessionPatches[sessionPatches.length - 1].resultingState as unknown as LastStatePayload;
}
