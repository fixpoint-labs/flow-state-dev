/**
 * Conformance, runtime half.
 *
 * The type-level half — the block is assignable to core's `HarnessBlock` — is in
 * `harness-conformance.test-d.ts`, because an alias over `any, any` is checked
 * by the compiler and proves little on its own. This file holds the half that
 * proves something: a handle this package produces parses against the NEUTRAL
 * schema, not merely against its own.
 */
import { describe, it, expect } from "vitest";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import { CURSOR_SOURCE, cursorAgentHandleSchema, type CursorAgentHandle } from "../src/types";
import { cursorAgent, INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import { TESTED_SDK_VERSION } from "../src/types";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

const MINIMAL: CursorAgentHandle = {
  source: CURSOR_SOURCE,
  status: "completed",
  sessionId: "agent-abc",
  url: null,
  dispatchedAt: 1_700_000_000_000,
  outcome: "finished",
  finalMessage: "done",
  usage: { inputTokens: 1200, outputTokens: 300 },
  cost: { usd: 0.0012, basis: "estimated" },
  cursorUsage: {
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    totalTokens: 1500,
    reasoningTokens: 100,
  },
  failureMessage: null,
};

describe("harness conformance", () => {
  it("a handle this package produces parses against the NEUTRAL contract schema", () => {
    const parsed = harnessRunHandleSchema.parse(MINIMAL);
    expect(parsed.source).toBe("cursor/sdk");
    expect(parsed.outcome).toBe("finished");
    expect(parsed.cost).toEqual({ usd: 0.0012, basis: "estimated" });
  });

  it("the same handle parses against this package's extension", () => {
    const parsed = cursorAgentHandleSchema.parse(MINIMAL);
    expect(parsed.cursorUsage?.cacheReadTokens).toBe(200);
    expect(parsed.failureMessage).toBeNull();
  });

  it("a handle persisted before the extension's fields existed still parses (BP-030)", () => {
    const legacy = {
      source: CURSOR_SOURCE,
      status: "completed",
      sessionId: "agent-abc",
      url: null,
      dispatchedAt: 1,
    };
    const parsed = cursorAgentHandleSchema.parse(legacy);
    expect(parsed.outcome).toBeNull();
    expect(parsed.cursorUsage).toBeNull();
    expect(parsed.failureMessage).toBeNull();
  });

  it("the block declares the contract's own input schema, not a local copy", () => {
    const block = cursorAgent(GATE_OFF);
    expect(block.config.inputSchema).toBe(harnessRunInputSchema);
  });

  it("`source` follows the contract's <package>/<door> rule", () => {
    expect(CURSOR_SOURCE).toBe("cursor/sdk");
  });
});
