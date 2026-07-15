/**
 * Unit test for `setupPhase3Memos` — verifies the trader memo is created
 * in `pending` (streamed off the live collection) and `activePhase` flips to
 * `"phase-3"`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase3Memos } from "../flows/analysis/agents/trader/setup";
import { memosCollection } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";
import { PHASE_3_MEMO_KEYS } from "../flows/analysis/registry";
import { latestMemoStatus } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p3-setup-test",
  actions: { run: { block: setupPhase3Memos } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

describe("setupPhase3Memos", () => {
  it("seeds the trader memo to pending and flips activePhase to phase-3", async () => {
    const result = await testBlock(setupPhase3Memos, {
      input: {},
      flow: fixtureFlow,
      session: {
        state: {
          ticker: "NVDA",
          date: "2026-05-06",
          costPreset: "fast",
          dataSource: "fixture",
          activePhase: "phase-2",
          maxDebateRounds: 1,
        },
      },
    });

    expect(result.error).toBeNull();
    const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
    expect(sessionPatches.length).toBeGreaterThan(0);
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.activePhase).toBe("phase-3");
    // The trader memo is seeded to pending.
    expect(latestMemoStatus(result.items, PHASE_3_MEMO_KEYS.trader.memoKey)).toBe("pending");
  });
});
