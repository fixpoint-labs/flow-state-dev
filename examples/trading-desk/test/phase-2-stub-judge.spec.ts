/**
 * Verifies the Phase 2 stub judge always returns `{ done: false }` so the
 * round-robin loop terminates only via `maxRounds`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { stubJudge } from "../src/flows/trading-desk/phase-2/stub-judge";

const fixtureFlow = defineFlow({
  kind: "trading-desk-p2-judge-test",
  actions: { run: { block: stubJudge } },
})({ id: "test" });

describe("stubJudge", () => {
  it("returns { done: false, summary: '' } regardless of input", async () => {
    const result = await testBlock(stubJudge, {
      input: { whatever: true },
      flow: fixtureFlow,
    });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ done: false, summary: "" });
  });
});
