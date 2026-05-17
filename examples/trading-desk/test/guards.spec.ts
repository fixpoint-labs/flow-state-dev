/**
 * Unit tests for the FIX-605 early-stop primitives.
 *
 * The two pipeline guards (pre-flight ticker resolution + post-Phase-1
 * data-quality gate) are inline `.throwIf` predicates in `flow.ts`, not
 * standalone handler blocks, so they don't have unit tests here — they're
 * covered structurally by the e2e test suites. This file covers:
 *
 *   - `rescueEarlyStop` patches session state to the terminal stopped
 *      condition for an `EarlyStopError`.
 *   - `rescueEarlyStop` rethrows any other error type so the runtime's
 *      normal error handling kicks in.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import {
  EarlyStopError,
  rescueEarlyStop,
} from "../src/flows/trading-desk/guards";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const guardsFlow = defineFlow({
  kind: "trading-desk-guards-test",
  actions: {
    rescue: { block: rescueEarlyStop },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection },
})({ id: "test" });

const baseSession = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "idle" as const,
  memoStatus: {},
  runComplete: false,
  stoppedReason: null,
  stoppedMessage: null,
};

describe("rescueEarlyStop", () => {
  it("patches session state on EarlyStopError and returns the stopped sentinel", async () => {
    const result = await testBlock(rescueEarlyStop, {
      // Matches the runtime invocation shape: the rescue path passes the
      // raw Error directly as input, not wrapped in `{ error: ... }`.
      input: new EarlyStopError(
        "unresolvable-ticker",
        "Could not resolve ticker ZZZZ.",
      ),
      flow: guardsFlow,
      session: { state: baseSession },
    });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ stopped: true });
    const sessionPatches = result.stateChanges.filter(
      (c) => c.scope === "session",
    );
    const last = sessionPatches[sessionPatches.length - 1].resultingState;
    expect(last.stoppedReason).toBe("unresolvable-ticker");
    expect(last.stoppedMessage).toBe("Could not resolve ticker ZZZZ.");
    expect(last.runComplete).toBe(true);
  });

  it("rethrows non-EarlyStopError errors unchanged", async () => {
    const original = new Error("upstream blew up");
    const result = await testBlock(rescueEarlyStop, {
      input: original,
      flow: guardsFlow,
      session: { state: baseSession },
    });
    expect(result.error).not.toBeNull();
    expect((result.error as { cause?: unknown }).cause).toBe(original);
  });
});
