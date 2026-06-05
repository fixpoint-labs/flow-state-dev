/**
 * Unit test for `setupPhase4Memos` — verifies the four P4 memo slots are
 * seeded to `pending`, `session.memoStatus` gains the four entries, prior
 * phases' entries are preserved, and `activePhase` flips to `"phase-4"`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase4Memos } from "../src/flows/analysis/agents/risk/setup";
import { memosCollection } from "../src/flows/analysis/resources/memos";
import { sessionStateSchema } from "../src/flows/analysis/state";

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
          memoStatus: {
            fundamentals: "published",
            researchManager: "published",
            trader: "published",
          },
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
    const memoStatus = last.memoStatus as Record<string, string>;
    // Earlier-phase entries are preserved.
    expect(memoStatus.fundamentals).toBe("published");
    expect(memoStatus.researchManager).toBe("published");
    expect(memoStatus.trader).toBe("published");
    // All four P4 entries seeded.
    expect(memoStatus.aggressive).toBe("pending");
    expect(memoStatus.conservative).toBe("pending");
    expect(memoStatus.neutral).toBe("pending");
    expect(memoStatus.riskAssessment).toBe("pending");
  });
});
