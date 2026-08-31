/**
 * Per-tool `retry` and `timeoutMs` on the tool execution path (FIX-1230).
 *
 * `executeBlock` has always resolved retry as a per-block override merged over
 * the ambient policy. `buildToolExecutor` read the flow-level pair and ignored
 * `tool.config.retry` entirely — while reading `tool.config.cacheable` two lines
 * later — so the field was declared and never honoured here. This closes that.
 *
 * **Why it matters beyond consistency.** The generic timeout rejects on its timer
 * and does nothing to the underlying promise, so a flow-wide default shorter than
 * a tool's real work lets the retry start a second call while the first is still
 * live. For a tool with a side effect that is a duplicate, arriving under a
 * configuration nobody set on purpose.
 *
 * The pairing below is what makes each test non-vacuous: an ordinary tool and an
 * opted-out tool run under the SAME flow defaults, so a "fix" that disabled the
 * defaults flow-wide would break the ordinary tool's assertion.
 */
import { describe, expect, it, vi } from "vitest";
import { buildToolExecutor, type ToolExecutorConfig } from "../../src/blocks/internal/tool-executor";
import type { BlockContext, RetryPolicy } from "../../src/types/block";
import { createMockContext } from "../helpers";

function makeTool(overrides: {
  name?: string;
  run?: (args: unknown, ctx: BlockContext) => Promise<unknown>;
  retry?: RetryPolicy;
  timeoutMs?: number;
} = {}) {
  const runFn = overrides.run ?? (async (args: unknown) => ({ result: args }));
  return {
    name: overrides.name ?? "test-tool",
    kind: "handler" as const,
    description: "a test tool",
    inputSchema: {},
    config: {
      ...(overrides.retry !== undefined ? { retry: overrides.retry } : {}),
      ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {})
    },
    run: runFn,
    _substrate: { run: runFn }
  } as any;
}

/** Flow defaults short enough to fire, with retry enabled. */
function makeConfig(overrides?: Partial<ToolExecutorConfig>): ToolExecutorConfig {
  return {
    flowTools: { defaults: { timeoutMs: 20, retry: { maxAttempts: 3, baseDelayMs: 0 } } },
    generatorBlockName: "gen",
    itemVisibility: undefined,
    agentName: undefined,
    statusGuard: { active: 0, saved: "" },
    ...overrides
  };
}

/** A tool whose work outlasts the flow's default timeout. */
function slowRun(calls: { count: number }) {
  return async () => {
    calls.count += 1;
    await new Promise((r) => setTimeout(r, 80));
    return { done: true };
  };
}

describe("per-tool retry and timeout on the tool path", () => {
  it("a tool declaring timeoutMs: 0 and maxAttempts: 1 runs EXACTLY ONCE under short flow defaults", async () => {
    const calls = { count: 0 };
    const execute = buildToolExecutor(
      makeTool({ name: "sender", run: slowRun(calls), timeoutMs: 0, retry: { maxAttempts: 1 } }),
      makeConfig(),
      createMockContext()
    );

    await expect(execute({})).resolves.toEqual({ done: true });
    // One call, and it completed — not one call that was abandoned mid-flight.
    expect(calls.count).toBe(1);
  });

  it("an ORDINARY tool in the same generator still times out and still retries", async () => {
    // The half that makes the test above mean something. If someone "fixed" the
    // duplicate by disabling `tools.defaults` flow-wide, this assertion breaks —
    // which is the outcome the per-tool seam exists to prevent.
    const calls = { count: 0 };
    const execute = buildToolExecutor(
      makeTool({ name: "ordinary", run: slowRun(calls) }),
      makeConfig(),
      createMockContext()
    );

    await expect(execute({})).rejects.toThrow(/timed out/);
    // Three attempts, because the flow default retry is still in force for it.
    expect(calls.count).toBe(3);
  });

  it("MERGES the tool's retry over the flow default rather than replacing it", async () => {
    // Merge, not replace, so `config.retry` means one thing on both execution
    // paths — `executeBlock` merges, and a reader who learned one rule would
    // otherwise be wrong about the other half the time. Here the tool overrides
    // only `maxAttempts`; the flow's `baseDelayMs` still applies, which is what
    // keeps this test fast rather than sleeping on a default backoff.
    const calls = { count: 0 };
    const execute = buildToolExecutor(
      makeTool({
        name: "merger",
        run: async () => {
          calls.count += 1;
          throw new Error("always fails");
        },
        retry: { maxAttempts: 2 }
      }),
      makeConfig({ flowTools: { defaults: { retry: { maxAttempts: 5, baseDelayMs: 0 } } } }),
      createMockContext()
    );

    await expect(execute({})).rejects.toThrow("always fails");
    expect(calls.count).toBe(2);
  });

  it("leaves a tool declaring neither on the flow defaults, byte for byte", async () => {
    // The off state (BP-035). Every tool in every existing flow declares neither
    // of these fields, so this is the path this change must not move.
    const run = vi.fn(async () => ({ ok: true }));
    const execute = buildToolExecutor(
      makeTool({ name: "untouched", run }),
      makeConfig({ flowTools: { defaults: { timeoutMs: 1000, retry: { maxAttempts: 2 } } } }),
      createMockContext()
    );

    await expect(execute({})).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("applies a tool's timeoutMs when the flow declares no defaults at all", async () => {
    const calls = { count: 0 };
    const execute = buildToolExecutor(
      makeTool({ name: "own-clock", run: slowRun(calls), timeoutMs: 10 }),
      makeConfig({ flowTools: undefined }),
      createMockContext()
    );

    await expect(execute({})).rejects.toThrow(/timed out/);
  });
});
