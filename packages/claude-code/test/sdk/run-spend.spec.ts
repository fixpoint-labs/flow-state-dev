/**
 * A Claude Code run reports what it spent into the running request when it
 * ends, however it ends (FIX-2145): the tokens and cost Claude Code reported,
 * and whether the run was on an API key or a subscription, as Claude Code's
 * own `accountInfo()` says.
 *
 * Why it matters: per-worker usage counts a harness's tokens only through this
 * report. A run that fails, or is stopped, spent tokens too, and a dollar
 * figure is shown only for a run billed to an API key.
 */
import { describe, expect, it } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { REQUEST_SPEND_SEAM, type HarnessRunSpend } from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "../../src/sdk/agent";
import type { ResolveClaudeAgent, SdkMessageLike } from "../../src/sdk/types";

/** A scripted query that also answers `accountInfo()`, as the SDK's handle does. */
function scripted(
  messages: SdkMessageLike[],
  account: Record<string, unknown> | (() => Promise<Record<string, unknown>>),
  opts: { throwAfter?: boolean } = {},
): ResolveClaudeAgent {
  return () => ({
    query: () => {
      const iterate = async function* () {
        for (const m of messages) yield m;
        if (opts.throwAfter === true) throw new Error("the CLI exited with code 1");
      };
      return Object.assign(iterate(), { accountInfo: typeof account === "function" ? account : async () => account });
    },
  }) as never;
}

/** Run the block in a context that carries a spend ledger, and collect what it reports. */
async function runReporting(block: ReturnType<typeof claudeCodeAgent>, opts: { failErrorItem?: boolean } = {}) {
  const reported: HarnessRunSpend[] = [];
  const runtime = await createTestContext({ declaredResources: block.declaredResources });
  if (opts.failErrorItem === true) {
    const emit = runtime.ctx.response.emit.bind(runtime.ctx.response);
    (runtime.ctx.response as { emit: typeof emit }).emit = async (event: Parameters<typeof emit>[0]) => {
      if ((event as { item?: { type?: string } }).item?.type === "error") throw new Error("item store unavailable");
      return emit(event);
    };
  }
  (runtime.ctx as unknown as Record<symbol, unknown>)[REQUEST_SPEND_SEAM] = { reportHarnessRun: (run: HarnessRunSpend) => reported.push(run) };
  const outcome = await Promise.resolve(block.config.execute?.({ prompt: "go" }, runtime.ctx as never)).then(
    () => "returned",
    () => "threw",
  );
  return { reported, outcome, settled: settledOf(reported) };
}

/** The run's last report (the one that stands), with its run id checked and dropped. */
function settledOf(reported: HarnessRunSpend[]) {
  const last = reported.at(-1);
  if (last === undefined) return [];
  expect(new Set(reported.map((r) => r.runId)).size).toBe(1);
  expect(typeof last.runId).toBe("string");
  const { runId: _runId, model: _model, ...rest } = last;
  return [rest];
}

const RESULT: SdkMessageLike = {
  type: "result",
  subtype: "success",
  result: "done",
  session_id: "sess_1",
  usage: { input_tokens: 1000, output_tokens: 200 },
  total_cost_usd: 0.42,
};

describe("claudeCodeAgent reports its run's spend", () => {
  it("reports the run's tokens, its reported cost, and api-key billing when Claude Code runs on a key", async () => {
    const block = claudeCodeAgent({ resolveClaudeAgent: scripted([RESULT], { apiKeySource: "ANTHROPIC_API_KEY" }), detached: true });

    const { settled: reported, outcome } = await runReporting(block);

    expect(outcome).toBe("returned");
    expect(reported).toEqual([{ harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "api-key" }]);
  });

  it("reports subscription billing for a signed-in plan, keeping the cost Claude Code sent for the writer to judge", async () => {
    const block = claudeCodeAgent({
      resolveClaudeAgent: scripted([RESULT], { apiKeySource: "none", email: "me@example.test", subscriptionType: "max" }),
      detached: true,
    });

    const { settled: reported } = await runReporting(block);

    expect(reported).toEqual([{ harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "subscription" }]);
  });

  it("reports a failed result's spend even when its error notice could not be written", async () => {
    // Claude Code emits an error item before the result: losing that item must
    // not lose the tokens and cost the result already carried.
    const failed: SdkMessageLike = { ...RESULT, subtype: "error_max_turns", is_error: true, result: undefined };
    const block = claudeCodeAgent({ resolveClaudeAgent: scripted([failed], { apiKeySource: "ANTHROPIC_API_KEY" }), detached: true });

    const { settled: reported } = await runReporting(block, { failErrorItem: true });

    expect(reported).toEqual([{ harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "api-key" }]);
  });

  it("reports a run that failed after its result arrived", async () => {
    const block = claudeCodeAgent({ resolveClaudeAgent: scripted([RESULT], { apiKeySource: "ANTHROPIC_API_KEY" }, { throwAfter: true }), detached: true });

    const { settled: reported, outcome } = await runReporting(block);

    expect(outcome).toBe("threw");
    expect(reported).toEqual([{ harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "api-key" }]);
  });

  it("reports a run that ended before Claude Code sent usage as one run with nothing reported", async () => {
    const block = claudeCodeAgent({
      resolveClaudeAgent: scripted([{ type: "system", subtype: "init", session_id: "sess_1" }], {}, { throwAfter: true }),
      detached: true,
    });

    const { settled: reported, outcome } = await runReporting(block);

    expect(outcome).toBe("threw");
    expect(reported).toEqual([{ harness: "claude-code", inputTokens: null, outputTokens: null, costUsd: null, billing: null }]);
  });

  it("counts the whole query's tokens, cached input and sub-agents included, from modelUsage", async () => {
    // `usage` is the main agent loop only and leaves cache tokens out; a
    // worker's total read from it would miss most of a cached run's input.
    const result: SdkMessageLike = {
      ...RESULT,
      usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 },
      modelUsage: {
        "claude-opus-4-7": { inputTokens: 10, outputTokens: 200, cacheReadInputTokens: 5000, cacheCreationInputTokens: 300 },
        "claude-haiku-4-5": { inputTokens: 40, outputTokens: 60, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      },
    };
    const block = claudeCodeAgent({ resolveClaudeAgent: scripted([result], { apiKeySource: "ANTHROPIC_API_KEY" }), detached: true });

    const { settled: reported } = await runReporting(block);

    expect(reported).toEqual([{ harness: "claude-code", inputTokens: 5350, outputTokens: 260, costUsd: 0.42, billing: "api-key" }]);
  });

  it("counts cached input from usage when the result carries no modelUsage", async () => {
    const result: SdkMessageLike = { ...RESULT, usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 } };
    const block = claudeCodeAgent({ resolveClaudeAgent: scripted([result], { apiKeySource: "ANTHROPIC_API_KEY" }), detached: true });

    const { settled: reported } = await runReporting(block);

    expect(reported).toEqual([{ harness: "claude-code", inputTokens: 5310, outputTokens: 200, costUsd: 0.42, billing: "api-key" }]);
  });

  it("takes the billing from a retried account lookup when the first one failed", async () => {
    // The first lookup fails; the next usage window asks again and that answer is
    // the only one that says how the run is billed. Without it the run's
    // cost would be dropped as if its billing were unknown.
    let asked = 0;
    const account = async () => {
      asked += 1;
      if (asked === 1) throw new Error("not ready");
      return { apiKeySource: "none", email: "me@example.test", subscriptionType: "max" };
    };
    const window: SdkMessageLike = {
      type: "rate_limit_event",
      session_id: "sess_1",
      rate_limit_info: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1_900_000_000 },
    };
    const block = claudeCodeAgent({ resolveClaudeAgent: scripted([window, window, RESULT], account), detached: true, onUsage: () => undefined });

    const { settled: reported } = await runReporting(block);

    expect(asked).toBe(2);
    expect(reported).toEqual([{ harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "subscription" }]);
  });
});

/**
 * FIX-2288: a Claude Code run reports as it goes. Why it matters: a task card's
 * count must rise while a run works, name the model Claude Code says it runs
 * (not the configured one), and end at the whole query's total, never that
 * total added on top of the running sum.
 */
describe("claudeCodeAgent reports its spend as the run goes", () => {
  const INIT: SdkMessageLike = { type: "system", subtype: "init", session_id: "sess_1", model: "claude-sonnet-4-5" };
  const assistant = (id: string, input: number, output: number, cacheRead = 0): SdkMessageLike => ({
    type: "assistant",
    session_id: "sess_1",
    message: { id, content: [{ type: "text", text: "working" }], usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead } },
  });

  it("names the init message's model before any tokens, then rises per assistant message, then ends at the result's whole-query total", async () => {
    const result: SdkMessageLike = {
      ...RESULT,
      modelUsage: { "claude-sonnet-4-5": { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
    };
    const block = claudeCodeAgent({
      model: "claude-opus-4-1",
      resolveClaudeAgent: scripted([INIT, assistant("m1", 100, 20), assistant("m2", 100, 20), assistant("m3", 100, 20), result], { apiKeySource: "ANTHROPIC_API_KEY" }),
      detached: true,
    });

    const { reported } = await runReporting(block);

    expect(reported.map((r) => [r.model, r.inputTokens, r.outputTokens])).toEqual([
      // At init: the model Claude Code named, not the configured one, and no tokens yet (never 0).
      ["claude-sonnet-4-5", null, null],
      ["claude-sonnet-4-5", 100, 20],
      ["claude-sonnet-4-5", 200, 40],
      ["claude-sonnet-4-5", 300, 60],
      // The result replaces the running sum: 1 000 + 200, not 1 300 + 260.
      ["claude-sonnet-4-5", 1000, 200],
      // The finally's report says the same.
      ["claude-sonnet-4-5", 1000, 200],
    ]);
  });

  it("counts a message's usage once when the SDK repeats it across the assistant messages sharing its id", async () => {
    // A parallel tool call splits one model message into several assistant
    // messages, each carrying the same usage.
    const block = claudeCodeAgent({
      resolveClaudeAgent: scripted([INIT, assistant("m1", 100, 20, 50), assistant("m1", 100, 20, 50), assistant("m2", 10, 5)], {}, { throwAfter: true }),
      detached: true,
    });

    const { reported, outcome } = await runReporting(block);

    expect(outcome).toBe("threw");
    // Stopped before its result: the running sum stands, cached input counted.
    expect(reported.at(-1)).toMatchObject({ model: "claude-sonnet-4-5", inputTokens: 160, outputTokens: 25 });
  });
});
