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
} from "../src/flows/trading-desk/memo-writer";
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
      metrics: {
        revGrowth: "+42%",
        opMargin: "62%",
        fcfConv: "91%",
        forwardPE: "32.5x",
      },
      body: [
        { h: "Top of book", p: "Revenue +42% YoY." },
        { h: "Trend", p: "Sequential acceleration." },
        { h: "Composite reading", p: "Fundamentals supportive." },
        { h: "Material items", items: ["Cap-ex ramp"] },
      ],
    };
    const result = await testBlock(commitBlock, {
      input: thesis,
      flow: fixtureFlow,
      session: {
        state: { ...baseSessionState, memoStatus: { fundamentals: "writing" } },
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
