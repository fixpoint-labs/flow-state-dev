/**
 * Tests for the post-Phase-1 stop-condition guards (FIX-681).
 *
 *   - `checkPhase1HasFundamentalsAndProfile` halts the run when either
 *     non-substitutable analyst (`fundamentals` / `companyProfile`) errored,
 *     even if the other five succeeded.
 *   - `checkPhase1HasData` (the pre-existing all-error backstop) halts only
 *     when every analyst errored.
 *
 * Each guard is a `.tap` that patches `stoppedReason` on session state; the
 * pipeline's following `.exitIf` (exercised in the flow, not here) bails on a
 * non-null reason. These tests drive the guards directly with seeded memo
 * states and assert the resulting session patch.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import {
  checkPhase1HasData,
  checkPhase1HasFundamentalsAndProfile,
} from "../src/flows/trading-desk/flow";
import { PHASE_1_MEMO_KEYS } from "../src/flows/trading-desk/agents";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-flow-guards-test",
  actions: {
    primary: { block: checkPhase1HasFundamentalsAndProfile },
    allError: { block: checkPhase1HasData },
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
  memoStatus: {},
  stoppedReason: null,
  stoppedMessage: null,
};

/** Build a seeded memo-resources map: every Phase 1 memo `published` except
 *  the named short-names, which are `error`. */
function seedMemos(erroredShortNames: Array<keyof typeof PHASE_1_MEMO_KEYS>): Record<string, unknown> {
  const errored = new Set(erroredShortNames);
  const resources: Record<string, unknown> = {};
  for (const [shortName, mapping] of Object.entries(PHASE_1_MEMO_KEYS)) {
    resources[mapping.memoKey] = {
      status: errored.has(shortName as keyof typeof PHASE_1_MEMO_KEYS) ? "error" : "published",
      agentName: mapping.agentName,
      agentTeam: "analyst",
      phaseId: "p1",
      ticker: "NVDA",
      date: "2026-05-06",
    };
  }
  return resources;
}

/** The `stoppedReason` after running a guard, or `null` if the guard did not
 *  patch session state. */
async function stoppedReasonAfter(
  block: typeof checkPhase1HasData,
  erroredShortNames: Array<keyof typeof PHASE_1_MEMO_KEYS>,
): Promise<string | null> {
  const result = await testBlock(block, {
    input: {},
    flow: fixtureFlow,
    session: { state: baseSessionState, resources: seedMemos(erroredShortNames) },
  });
  expect(result.error).toBeNull();
  const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
  if (sessionPatches.length === 0) return null;
  return (sessionPatches[sessionPatches.length - 1].resultingState as { stoppedReason: string | null })
    .stoppedReason;
}

describe("checkPhase1HasFundamentalsAndProfile", () => {
  it("trips when fundamentals errored and others succeeded", async () => {
    expect(await stoppedReasonAfter(checkPhase1HasFundamentalsAndProfile, ["fundamentals"])).toBe(
      "phase-1-missing-primary",
    );
  });

  it("trips when companyProfile errored and others succeeded", async () => {
    expect(await stoppedReasonAfter(checkPhase1HasFundamentalsAndProfile, ["companyProfile"])).toBe(
      "phase-1-missing-primary",
    );
  });

  it("does NOT trip when only a substitutable analyst (news) errored", async () => {
    expect(await stoppedReasonAfter(checkPhase1HasFundamentalsAndProfile, ["news"])).toBeNull();
  });

  it("does NOT trip when every analyst succeeded", async () => {
    expect(await stoppedReasonAfter(checkPhase1HasFundamentalsAndProfile, [])).toBeNull();
  });
});

describe("checkPhase1HasData (all-error backstop)", () => {
  it("trips only when every analyst errored", async () => {
    expect(
      await stoppedReasonAfter(checkPhase1HasData, [
        "fundamentals",
        "sentiment",
        "news",
        "technical",
        "companyProfile",
        "market",
        "macro",
        "quant",
        "disclosure",
      ]),
    ).toBe("phase-1-no-data");
  });

  it("does NOT trip when one analyst (news) survived... but a primary errored", async () => {
    // checkPhase1HasData only fires on ALL-error; a single survivor leaves it
    // dormant. The primary-analyst guard is what catches this case upstream.
    expect(
      await stoppedReasonAfter(checkPhase1HasData, [
        "fundamentals",
        "sentiment",
        "technical",
        "companyProfile",
      ]),
    ).toBeNull();
  });
});
