/**
 * Unit test for `setupPhase4Memos` — verifies the four P4 memo slots are
 * seeded to `pending` (streamed off the live collection) and `activePhase`
 * flips to `"phase-4"`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase4Memos } from "../flows/analysis/agents/risk/setup";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { PHASE_4_MEMO_KEYS } from "../flows/analysis/registry";
import { latestMemoStatus } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p4-setup-test",
  actions: { run: { block: setupPhase4Memos } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

describe("setupPhase4Memos", () => {
  it("seeds the four P4 memos to pending and flips activePhase to phase-4", async () => {
    const result = await testBlock(setupPhase4Memos, {
      input: {},
      flow: fixtureFlow,
      session: {
        state: {
          ticker: "NVDA",
          date: "2026-05-06",
          costPreset: "fast",
          dataSource: "fixture",
          activePhase: "phase-3",
          maxDebateRounds: 1,
        },
      },
    });

    expect(result.error).toBeNull();
    const sessionPatches = result.stateChanges.filter(
      (c) => c.scope === "session",
    );
    expect(sessionPatches.length).toBeGreaterThan(0);
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.activePhase).toBe("phase-4");
    // All four P4 memos seeded to pending.
    expect(latestMemoStatus(result.items, PHASE_4_MEMO_KEYS.aggressive.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_4_MEMO_KEYS.conservative.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_4_MEMO_KEYS.neutral.memoKey)).toBe("pending");
    expect(latestMemoStatus(result.items, PHASE_4_MEMO_KEYS.riskAssessment.memoKey)).toBe("pending");
  });
});
