/**
 * Unit tests for `setupPhase1Memos` — confirms it creates nine memos in
 * `pending` status.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase1Memos } from "../src/flows/analysis/agents/analysts/setup";
import { memosCollection } from "../src/flows/analysis/resources";
import { sessionStateSchema } from "../src/flows/analysis/state";
import { PHASE_1_MEMO_KEYS } from "../src/flows/analysis/registry";
import { latestMemoStatus } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-test",
  actions: {
    run: { block: setupPhase1Memos },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

describe("setupPhase1Memos", () => {
  it("creates nine pending memos", async () => {
    const result = await testBlock(setupPhase1Memos, {
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast",
        dataSource: "fixture",
      },
      flow: fixtureFlow,
      session: {
        state: {
          ticker: "NVDA",
          date: "2026-05-06",
          costPreset: "fast",
          dataSource: "fixture",
          activePhase: "idle",
        },
      },
    });

    expect(result.error).toBeNull();
    const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
    expect(sessionPatches.length).toBeGreaterThan(0);
    // Final session state should mark phase-1 active; each of the nine memos
    // streams a `pending` scaffold.
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.activePhase).toBe("phase-1");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.fundamentals.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.sentiment.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.news.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.technical.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.companyProfile.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.market.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.macro.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.quant.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_1_MEMO_KEYS.disclosure.memoKey)).toBe("pending");
  });
});
