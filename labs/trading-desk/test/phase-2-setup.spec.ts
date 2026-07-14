/**
 * Unit tests for `setupPhase2Memos` — verifies the three p2 memos are
 * pre-created in `pending` (streamed off the live collection) before the
 * bull/bear loop runs.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase2Memos } from "../flows/analysis/agents/research/setup";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { PHASE_2_MEMO_KEYS } from "../flows/analysis/registry";
import { latestMemoStatus } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p2-setup-test",
  actions: { run: { block: setupPhase2Memos } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

describe("setupPhase2Memos", () => {
  it("seeds bull/bear/researchManager memos to pending and flips activePhase", async () => {
    const result = await testBlock(setupPhase2Memos, {
      input: {},
      flow: fixtureFlow,
      session: {
        state: {
          ticker: "NVDA",
          date: "2026-05-06",
          costPreset: "fast",
          dataSource: "fixture",
          activePhase: "phase-1",
          maxDebateRounds: 1,
        },
      },
    });

    expect(result.error).toBeNull();
    const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
    expect(sessionPatches.length).toBeGreaterThan(0);
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.activePhase).toBe("phase-2");
    // Phase 2 memos are seeded to pending.
    expect(latestMemoStatus(result.items, PHASE_2_MEMO_KEYS.bull.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_2_MEMO_KEYS.bear.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_2_MEMO_KEYS.researchManager.memoKey)).toBe("pending");
  });
});
