/**
 * `runClaudeHeadless` — the blocking, unattended Agent SDK run.
 *
 * The behaviour worth pinning is not the option list; it is that this function
 * **settles rather than throws** on every way a run can go wrong, because
 * callers keep a ledger off the returned value and a thrown error would skip
 * the record entirely. Each failure mode below is one of those ways.
 *
 * The other pinned behaviours are the two SDK defaults that are *not* Claude
 * Code's defaults: with `settingSources` omitted the SDK loads no `CLAUDE.md`
 * and no project settings, and with `systemPrompt` omitted it runs with an
 * empty system prompt. A run dispatched into a repository silently loses both,
 * so this module opts back in and the tests hold it to that.
 */
import { describe, expect, it, vi } from "vitest";
import { runClaudeHeadless } from "../../src/sdk/headless";
import { createResolveClaudeAgentQuery } from "../../src/sdk/sdk-client";
import type {
  ClaudeAgentQueryOptions,
  ResolveClaudeAgentQuery,
  SdkMessageLike,
} from "../../src/sdk/types";

/** A terminal `result` message, success by default. */
const result = (extra: Partial<Extract<SdkMessageLike, { type: "result" }>> = {}) =>
  ({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    session_id: "sess-abc",
    total_cost_usd: 1.25,
    usage: { input_tokens: 900, output_tokens: 120 },
    ...extra,
  }) satisfies SdkMessageLike;

/** A resolver whose `query` replays `messages`, recording the options it got. */
function scriptedAgent(messages: readonly SdkMessageLike[]) {
  const query = vi.fn(async function* (_args: {
    prompt: string | AsyncIterable<unknown>;
    options?: ClaudeAgentQueryOptions;
  }): AsyncGenerator<SdkMessageLike> {
    for (const message of messages) yield message;
  });
  const resolveAgent: ResolveClaudeAgentQuery = () => ({ query });
  return { query, resolveAgent };
}

/** The options the scripted `query` was called with. */
const optionsOf = (query: ReturnType<typeof scriptedAgent>["query"]): ClaudeAgentQueryOptions =>
  vi.mocked(query).mock.calls[0]![0].options!;

describe("runClaudeHeadless", () => {
  it("runs the prompt in the directory it was given", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "do the thing", cwd: "/repo/wt", resolveAgent });

    expect(query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls[0]![0].prompt).toBe("do the thing");
    expect(optionsOf(query).cwd).toBe("/repo/wt");
  });

  it("loads the project's settings and CLAUDE.md, which the SDK does not do on its own", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent });

    // `project` is the source that carries CLAUDE.md; omitting settingSources
    // entirely would have run the agent blind to the repository it is editing.
    expect(optionsOf(query).settingSources).toContain("project");
    expect(optionsOf(query).settingSources).toEqual(["user", "project", "local"]);
  });

  it("asks for Claude Code's system prompt, which the SDK also does not do on its own", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(optionsOf(query).systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  });

  it("lets a caller isolate a run from the filesystem and replace the prompt", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      settingSources: [],
      systemPrompt: "You are a linter.",
      resolveAgent,
    });
    expect(optionsOf(query).settingSources).toEqual([]);
    expect(optionsOf(query).systemPrompt).toBe("You are a linter.");
  });

  it("passes model, turn and budget ceilings only when set, so the SDK's defaults stand", async () => {
    const bare = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent: bare.resolveAgent });
    expect(optionsOf(bare.query).model).toBeUndefined();
    expect(optionsOf(bare.query).maxTurns).toBeUndefined();
    expect(optionsOf(bare.query).maxBudgetUsd).toBeUndefined();

    const configured = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      model: "opus",
      maxTurns: 40,
      maxBudgetUsd: 5,
      resolveAgent: configured.resolveAgent,
    });
    expect(optionsOf(configured.query).model).toBe("opus");
    expect(optionsOf(configured.query).maxTurns).toBe(40);
    expect(optionsOf(configured.query).maxBudgetUsd).toBe(5);
  });

  it("merges extra environment over the host's rather than replacing it", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", env: { CONDUCTOR_PHASE: "IMPLEMENTATION" }, resolveAgent });

    const env = optionsOf(query).env!;
    expect(env.CONDUCTOR_PHASE).toBe("IMPLEMENTATION");
    // The SDK's `env` is the *whole* environment, so passing the caller's map
    // through would run the agent without PATH, HOME, or its credentials.
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("leaves the environment alone when the caller sets none", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(optionsOf(query).env).toBeUndefined();
  });

  it("carries the explicit-intent flag the SDK demands alongside bypassPermissions", async () => {
    const bypass = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      permissionMode: "bypassPermissions",
      resolveAgent: bypass.resolveAgent,
    });
    expect(optionsOf(bypass.query).allowDangerouslySkipPermissions).toBe(true);

    // Every other mode must not carry it — it is a confirmation, not a default.
    const edits = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      permissionMode: "acceptEdits",
      resolveAgent: edits.resolveAgent,
    });
    expect(optionsOf(edits.query).allowDangerouslySkipPermissions).toBeUndefined();
  });

  it("reports the final message, session, cost, usage and subtype of a successful run", async () => {
    const { resolveAgent } = scriptedAgent([result()]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run).toEqual({
      ok: true,
      error: null,
      finalMessage: "done",
      sessionId: "sess-abc",
      costUsd: 1.25,
      subtype: "success",
      usage: { inputTokens: 900, outputTokens: 120 },
    });
  });

  it("fails on an error subtype, naming the class so the caller can tell a ceiling from a crash", async () => {
    const { resolveAgent } = scriptedAgent([
      result({
        subtype: "error_max_turns",
        is_error: true,
        result: undefined,
        errors: ["ran out of turns"],
      }),
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.subtype).toBe("error_max_turns");
    expect(run.error).toContain("ran out of turns");
    expect(run.error).toContain("error_max_turns");
    // Cost and usage are real when the run failed — the tokens were spent.
    expect(run.costUsd).toBe(1.25);
    expect(run.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
  });

  it("fails when the SDK flags a success result as an error", async () => {
    const { resolveAgent } = scriptedAgent([result({ is_error: true, result: "hit a wall" })]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("hit a wall");
    expect(run.costUsd).toBe(1.25);
  });

  it("fails on a subtype it does not recognize, rather than reading a future failure as success", async () => {
    const { resolveAgent } = scriptedAgent([
      result({ subtype: "error_something_new", is_error: true, result: undefined }),
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.subtype).toBeNull();
    expect(run.error).toContain("error_something_new");
  });

  it("settles as failed when the SDK is not installed, instead of throwing past the caller's ledger", async () => {
    const resolveAgent = createResolveClaudeAgentQuery(() => {
      throw new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'");
    });
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("@anthropic-ai/claude-agent-sdk");
    expect(run.costUsd).toBeNull();
  });

  it("settles as failed when the run throws mid-stream, keeping the session it had reached", async () => {
    const resolveAgent: ResolveClaudeAgentQuery = () => ({
      query: async function* (): AsyncGenerator<SdkMessageLike> {
        yield { type: "system", subtype: "init", session_id: "sess-partial" };
        throw new Error("stream closed unexpectedly");
      },
    });
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("stream closed unexpectedly");
    expect(run.sessionId).toBe("sess-partial");
  });

  it("settles as failed when the run exceeds its time budget, and aborts the agent", async () => {
    let abortedSignal: AbortSignal | undefined;
    const resolveAgent: ResolveClaudeAgentQuery = () => ({
      query: async function* (args): AsyncGenerator<SdkMessageLike> {
        abortedSignal = args.options?.abortController?.signal;
        yield { type: "system", subtype: "init", session_id: "sess-slow" };
        await new Promise<void>((_resolve, reject) => {
          abortedSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    });
    const run = await runClaudeHeadless({ prompt: "p", timeoutMs: 10, resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("10 ms budget");
    expect(run.sessionId).toBe("sess-slow");
    expect(abortedSignal?.aborted).toBe(true);
  });

  it("settles as failed when the stream ends without a terminal result", async () => {
    const { resolveAgent } = scriptedAgent([
      { type: "system", subtype: "init", session_id: "sess-truncated" },
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("without a terminal result");
    expect(run.sessionId).toBe("sess-truncated");
  });
});
