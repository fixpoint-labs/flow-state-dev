/**
 * The harness contract's own behaviour: what the neutral shapes accept, and
 * what they must never require.
 *
 * The point of these is not that Zod works. It is that a harness nobody has
 * written yet can fill the handle honestly — and that a handle written to disk
 * before a field existed still reads back. Both are promises the contract makes
 * to packages outside this one, and neither is visible from the types alone.
 */
import { describe, it, expect } from "vitest";
import {
  harnessRunEnvelopeSchema,
  harnessRunHandleSchema,
  harnessRunInputSchema,
} from "@flow-state-dev/core";

describe("the harness contract", () => {
  it("accepts a handle from a harness that reports nothing but the run itself", () => {
    // A second harness that has no cost to report, no usage, and has not
    // finished: every post-envelope field is legitimately absent. If this ever
    // fails, the contract has grown a field only one vendor can fill.
    const parsed = harnessRunHandleSchema.parse({
      source: "codex/sdk",
      status: "running",
      sessionId: "thread_1",
      url: null,
      dispatchedAt: 1_700_000_000_000,
    });

    expect(parsed).toEqual({
      source: "codex/sdk",
      status: "running",
      sessionId: "thread_1",
      url: null,
      dispatchedAt: 1_700_000_000_000,
      outcome: null,
      finalMessage: null,
      usage: null,
      cost: null,
    });
  });

  it("keeps parsing a handle persisted under the pre-contract source enum", () => {
    // `source` was an enum of one package's two doors. Widening it must not
    // strand a handle already sitting in session state (BP-030).
    const parsed = harnessRunEnvelopeSchema.parse({
      source: "sdk",
      status: "completed",
      sessionId: "sess_old",
      url: null,
      dispatchedAt: 1,
    });

    expect(parsed.source).toBe("sdk");
  });

  it("carries a harness's own extras through rather than rejecting them", () => {
    // Every real harness returns the neutral handle PLUS its own extension, so
    // a contract that rejected extras would conform to nothing. The promise is
    // that no vendor field is *required* — not that none may travel alongside.
    const parsed = harnessRunHandleSchema.parse({
      source: "claude-code/sdk",
      status: "completed",
      sessionId: "sess_1",
      url: null,
      dispatchedAt: 1,
      outcome: "finished",
      finalMessage: "done",
      usage: { inputTokens: 3, outputTokens: 4 },
      cost: { usd: 0.02, basis: "reported" },
      resultSubtype: "success",
      toolsObserved: ["Read"],
    });

    expect(parsed.outcome).toBe("finished");
    expect("resultSubtype" in parsed).toBe(false);
  });

  it("says whether a cost was reported or estimated, and refuses a bare number", () => {
    // A harness that reports no cost at all (Codex) leaves ours derived. The
    // basis is what stops a report showing a precision the harness never gave,
    // so a cost without one is not a cost.
    expect(
      harnessRunHandleSchema.parse({
        source: "codex/sdk",
        status: "completed",
        sessionId: null,
        url: null,
        dispatchedAt: 1,
        cost: { usd: 0.5, basis: "estimated" },
      }).cost,
    ).toEqual({ usd: 0.5, basis: "estimated" });

    expect(
      harnessRunHandleSchema.safeParse({
        source: "codex/sdk",
        status: "completed",
        sessionId: null,
        url: null,
        dispatchedAt: 1,
        cost: { usd: 0.5 },
      }).success,
    ).toBe(false);
  });

  it("asks a harness for the prompt and nothing else", () => {
    // The input schema is model-facing through a block's capability tool
    // preset. A working directory or a session id here would be a field a model
    // could set (BP-031) — so neither is accepted onto the contract, and an
    // attempt to smuggle one in is dropped rather than honoured.
    const parsed = harnessRunInputSchema.parse({
      prompt: "do the thing",
      resumeSessionId: "sess_someone_elses",
    });

    expect(parsed).toEqual({ prompt: "do the thing" });
  });
});
