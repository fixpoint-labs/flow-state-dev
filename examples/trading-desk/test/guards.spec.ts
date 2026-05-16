/**
 * Unit tests for the FIX-605 pipeline guards.
 *
 * Covers:
 *   - `validateTickerGuard` passes a known fixture ticker through unchanged.
 *   - `validateTickerGuard` throws `EarlyStopError` on a fixture miss.
 *   - `phase1QualityGate` throws `EarlyStopError` when all Phase 1 memos
 *      are `error`.
 *   - `phase1QualityGate` passes when at least one memo is `published`.
 *   - `rescueEarlyStop` patches session state to the terminal stopped
 *      condition for an `EarlyStopError` and rethrows any other error.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { PHASE_1_MEMO_KEYS } from "../src/flows/trading-desk/agents";
import {
  EarlyStopError,
  phase1QualityGate,
  rescueEarlyStop,
  validateTickerGuard,
} from "../src/flows/trading-desk/guards";
import { memosCollection } from "../src/flows/trading-desk/resources";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const guardsFlow = defineFlow({
  kind: "trading-desk-guards-test",
  actions: {
    validate: { block: validateTickerGuard },
    gate: { block: phase1QualityGate },
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

function memoState(
  status: "error" | "published",
  shortName: keyof typeof PHASE_1_MEMO_KEYS,
) {
  const { agentName } = PHASE_1_MEMO_KEYS[shortName];
  return {
    status,
    agentName: agentName as string,
    agentTeam: "analyst" as const,
    phaseId: "p1",
    ticker: "NVDA",
    date: "2026-05-06",
    label: null,
    headline: null,
    rating: null,
    body: null,
    metrics: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    errorMessage: status === "error" ? "boom" : null,
  };
}

describe("validateTickerGuard", () => {
  it("passes through a fixture ticker that exists", async () => {
    const input = {
      ticker: "NVDA",
      date: "2026-05-06",
      costPreset: "fast" as const,
      dataSource: "fixture" as const,
    };
    const result = await testBlock(validateTickerGuard, {
      input,
      flow: guardsFlow,
      session: { state: baseSession },
    });
    expect(result.error).toBeNull();
  });

  it("throws EarlyStopError on a missing fixture ticker", async () => {
    const result = await testBlock(validateTickerGuard, {
      input: {
        ticker: "ZZZZ",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
      },
      flow: guardsFlow,
      session: { state: { ...baseSession, ticker: "ZZZZ" } },
    });
    // Block-thrown errors get wrapped in `FlowError`; the original
    // `EarlyStopError` is on `.cause`.
    expect(result.error).not.toBeNull();
    const cause = (result.error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(EarlyStopError);
    expect((cause as EarlyStopError).reason).toBe("unresolvable-ticker");
  });
});

describe("phase1QualityGate", () => {
  it("throws EarlyStopError when every Phase 1 memo is in error status", async () => {
    // Resources are seeded by full storage key — the collection pattern
    // is `memos/**`, so `collectionKey: "p1/fundamentals"` lands as
    // `memos/p1/fundamentals` in the resource store.
    const memos: Record<string, ReturnType<typeof memoState>> = {};
    for (const [shortName, mapping] of Object.entries(PHASE_1_MEMO_KEYS)) {
      memos[`memos/${mapping.collectionKey}`] = memoState(
        "error",
        shortName as keyof typeof PHASE_1_MEMO_KEYS,
      );
    }
    const result = await testBlock(phase1QualityGate, {
      input: {},
      flow: guardsFlow,
      session: {
        state: baseSession,
        resources: memos,
      },
    });
    expect(result.error).not.toBeNull();
    const cause = (result.error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(EarlyStopError);
    expect((cause as EarlyStopError).reason).toBe("phase-1-no-data");
  });

  it("passes through when at least one Phase 1 memo is published", async () => {
    const memos: Record<string, ReturnType<typeof memoState>> = {};
    let first = true;
    for (const [shortName, mapping] of Object.entries(PHASE_1_MEMO_KEYS)) {
      memos[`memos/${mapping.collectionKey}`] = memoState(
        first ? "published" : "error",
        shortName as keyof typeof PHASE_1_MEMO_KEYS,
      );
      first = false;
    }
    const result = await testBlock(phase1QualityGate, {
      input: { ok: true },
      flow: guardsFlow,
      session: {
        state: baseSession,
        resources: memos,
      },
    });
    expect(result.error).toBeNull();
  });
});

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
