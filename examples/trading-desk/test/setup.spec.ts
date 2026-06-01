/**
 * Unit tests for `setupPhase1Memos` — confirms it creates eight memos in
 * `pending` status and seeds the `memoStatus` mirror.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { setupPhase1Memos } from "../src/flows/trading-desk/phase-1/setup";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-test",
  actions: {
    run: { block: setupPhase1Memos },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

describe("setupPhase1Memos", () => {
  it("creates eight pending memos and seeds memoStatus", async () => {
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
          memoStatus: {},
        },
      },
    });

    expect(result.error).toBeNull();
    const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
    expect(sessionPatches.length).toBeGreaterThan(0);
    // Final session state should mark phase-1 active and seed all five
    // memo-status entries to "pending".
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.activePhase).toBe("phase-1");
    const memoStatus = last.memoStatus as Record<string, string>;
    expect(memoStatus.fundamentals).toBe("pending");
    expect(memoStatus.sentiment).toBe("pending");
    expect(memoStatus.news).toBe("pending");
    expect(memoStatus.technical).toBe("pending");
    expect(memoStatus.companyProfile).toBe("pending");
    expect(memoStatus.market).toBe("pending");
    expect(memoStatus.macro).toBe("pending");
    expect(memoStatus.quant).toBe("pending");
  });
});
