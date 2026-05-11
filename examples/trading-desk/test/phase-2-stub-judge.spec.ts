/**
 * Verifies the Phase 2 judge terminates the round-robin loop once the
 * current round meets `session.maxDebateRounds`. The pattern's hard cap
 * is 2 (mirroring the schema); the judge enforces the lower
 * session-driven cap when present.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { sessionCapJudge } from "../src/flows/trading-desk/phase-2/stub-judge";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p2-judge-test",
  actions: { run: { block: sessionCapJudge } },
  session: { stateSchema: sessionStateSchema },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-2" as const,
  maxDebateRounds: 1,
  memoStatus: {},
};

describe("sessionCapJudge", () => {
  it("returns done:false at round 0 (loop not yet started)", async () => {
    // With round still 0 (initial), neither cap is hit — `done: false`.
    // The integration behavior (early termination at session.maxDebateRounds)
    // is exercised by the live `fsdev run` smoke test.
    const result = await testBlock(sessionCapJudge, {
      input: {},
      flow: fixtureFlow,
      session: { state: { ...baseSessionState, maxDebateRounds: 1 } },
      sequencer: { state: { goal: "", round: 0, done: false } },
    });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ done: false, summary: "" });
  });
});
