/**
 * Unit tests for `setupPhase2Memos` — verifies the three p2 memos are
 * pre-created and `session.memoStatus` carries the initial `pending`
 * entries before the bull/bear loop runs.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase2Memos } from "../src/flows/trading-desk/agents/research/setup";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

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
          memoStatus: {
            fundamentals: "published",
            sentiment: "published",
            news: "published",
            technical: "published",
          },
        },
      },
    });

    expect(result.error).toBeNull();
    const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
    expect(sessionPatches.length).toBeGreaterThan(0);
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.activePhase).toBe("phase-2");
    const memoStatus = last.memoStatus as Record<string, string>;
    // Phase 1 entries are preserved.
    expect(memoStatus.fundamentals).toBe("published");
    // Phase 2 entries are seeded.
    expect(memoStatus.bull).toBe("pending");
    expect(memoStatus.bear).toBe("pending");
    expect(memoStatus.researchManager).toBe("pending");
  });
});
