/**
 * Conformance, runtime half (LAB-153 §10, theme 7).
 *
 * The type-level half — the block is assignable to core's `HarnessBlock` — is
 * in `conformance.test-d.ts`, because an alias over `any, any` is checked by
 * the compiler and proves little on its own. This file holds the half that
 * proves something: a handle this package produces parses against the NEUTRAL
 * schema, not merely against its own.
 */
import { describe, it, expect } from "vitest";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import {
  CODEX_SOURCE,
  codexAgentHandleSchema,
  type CodexAgentHandle,
} from "../src/types";
import { codexAgent } from "../src/agent";

const MINIMAL: CodexAgentHandle = {
  source: CODEX_SOURCE,
  status: "completed",
  sessionId: "thr_1",
  url: null,
  dispatchedAt: 1_700_000_000_000,
  outcome: "finished",
  finalMessage: "done",
  usage: { inputTokens: 1200, outputTokens: 300 },
  cost: { usd: 0.0012, basis: "estimated" },
  codexUsage: {
    inputTokens: 1200,
    cachedInputTokens: 200,
    cacheWriteInputTokens: 0,
    outputTokens: 300,
    reasoningOutputTokens: 100,
  },
  failureMessage: null,
};

describe("harness conformance", () => {
  it("a handle this package produces parses against the NEUTRAL contract schema", () => {
    const parsed = harnessRunHandleSchema.parse(MINIMAL);
    expect(parsed.source).toBe("codex/sdk");
    expect(parsed.outcome).toBe("finished");
    expect(parsed.cost).toEqual({ usd: 0.0012, basis: "estimated" });
  });

  it("the same handle parses against this package's extension", () => {
    const parsed = codexAgentHandleSchema.parse(MINIMAL);
    expect(parsed.codexUsage?.cachedInputTokens).toBe(200);
    expect(parsed.failureMessage).toBeNull();
  });

  it("a handle persisted before the extension's fields existed still parses (BP-030)", () => {
    const legacy = {
      source: CODEX_SOURCE,
      status: "completed",
      sessionId: "thr_1",
      url: null,
      dispatchedAt: 1,
    };
    const parsed = codexAgentHandleSchema.parse(legacy);
    expect(parsed.outcome).toBeNull();
    expect(parsed.codexUsage).toBeNull();
    expect(parsed.failureMessage).toBeNull();
  });

  it("the block declares the contract's own input schema, not a local copy", () => {
    const block = codexAgent();
    expect(block.config.inputSchema).toBe(harnessRunInputSchema);
  });

  it("`source` follows the contract's <package>/<door> rule", () => {
    expect(CODEX_SOURCE).toBe("codex/sdk");
  });
});
