/**
 * Unit test for `setupPhase5Memos` — verifies the portfolio-manager memo is
 * created in `pending` (streamed off the live collection) and `activePhase`
 * flips to `"phase-5"`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase5Memos } from "../src/flows/analysis/agents/portfolio-manager/setup";
import { memosCollection } from "../src/flows/analysis/resources";
import { sessionStateSchema } from "../src/flows/analysis/state";
import { PHASE_5_MEMO_KEYS } from "../src/flows/analysis/registry";
import { latestMemoStatus } from "./_helpers/memo-status";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p5-setup-test",
  actions: { run: { block: setupPhase5Memos } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

describe("setupPhase5Memos", () => {
  it("seeds the portfolioManager memo to pending and flips activePhase to phase-5", async () => {
    const result = await testBlock(setupPhase5Memos, {
      input: {},
      flow: fixtureFlow,
      session: {
        state: {
          ticker: "NVDA",
          date: "2026-05-06",
          costPreset: "fast",
          dataSource: "fixture",
          activePhase: "phase-4",
          maxDebateRounds: 1,
          runComplete: false,
        },
      },
    });

    expect(result.error).toBeNull();
    // Filter out memo-resource state changes (which also carry `scope:
    // "session"` because the memos collection is session-scoped) by
    // requiring no `targetName` — those are the bare `ctx.session.*` ops.
    const sessionPatches = result.stateChanges.filter(
      (c) => c.scope === "session" && c.targetName === undefined,
    );
    expect(sessionPatches.length).toBeGreaterThan(0);
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.activePhase).toBe("phase-5");
    // The portfolioManager memo is seeded to pending.
    expect(latestMemoStatus(result.items, PHASE_5_MEMO_KEYS.portfolioManager.memoKey)).toBe("pending");
  });
});
