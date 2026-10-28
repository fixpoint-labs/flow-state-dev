/**
 * Claude Code runs record the pull requests they open (`recordPullRequests`,
 * on by default).
 *
 * What a reader of the record relies on: a `gh pr create` the run's `Bash`
 * ran is a row, from a string result and from content blocks alike; a GitHub
 * MCP create tool is a row; a `gh pr view` is not; the block declares the
 * collection by default, and declares and records nothing when the option is
 * off. The matcher and writer are core's, tested there; this holds the Claude
 * Code side, through its own emitter and a scripted `query`.
 */
import { describe, it, expect } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { OBSERVED_PULL_REQUESTS, observedPullRequestsCollection } from "@flow-state-dev/core";
import { REQUEST_END_SEAM, type RequestEndHook } from "@flow-state-dev/core/types";
import { claudeCodeAgent, type ClaudeCodeAgentOptions } from "../../src/sdk/agent";
import type { ResolveClaudeAgent, SdkMessageLike } from "../../src/sdk/types";

function scriptedQuery(messages: SdkMessageLike[]): ResolveClaudeAgent {
  return () => ({
    query: async function* () {
      for (const m of messages) yield m;
    },
  });
}

/** One tool call and its result, as the SDK streams them. */
function call(id: string, name: string, input: Record<string, unknown>, content: unknown): SdkMessageLike[] {
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } },
  ] as SdkMessageLike[];
}

const RESULT_OK = {
  type: "result",
  subtype: "success",
  result: "done",
  session_id: "sess_1",
  usage: { input_tokens: 1, output_tokens: 1 },
} as SdkMessageLike;

/** Run the block once in a context with the record and a request-end seam; end the request; return the rows. */
async function run(messages: SdkMessageLike[], options: Partial<ClaudeCodeAgentOptions> = {}) {
  const block = claudeCodeAgent({
    resolveClaudeAgent: scriptedQuery([{ type: "system", subtype: "init", session_id: "sess_1" } as SdkMessageLike, ...messages, RESULT_OK]),
    detached: true,
    includePartialMessages: false,
    ...options,
  });
  const runtime = await createTestContext();
  const rows = new Map<string, Record<string, unknown>>();
  const hooks: RequestEndHook[] = [];
  const ctx = runtime.ctx as unknown as Record<PropertyKey, unknown>;
  ctx.resources = {
    [OBSERVED_PULL_REQUESTS]: {
      getOptional: async (key: string) => (rows.has(key) ? { state: rows.get(key)! } : undefined),
      upsert: async (key: string, update: Record<string, unknown>) => void rows.set(key, { ...rows.get(key), ...update }),
    },
  };
  ctx[REQUEST_END_SEAM] = { add: (hook: RequestEndHook) => hooks.push(hook) };
  await block.config.execute?.({ prompt: "open a pull request" }, runtime.ctx as never);
  for (const hook of hooks) await hook({ status: "completed" });
  return rows;
}

describe("recordPullRequests — on the Claude Code block", () => {
  it("records the gh pr create and MCP create the run made, and not a gh pr view", async () => {
    const rows = await run([
      ...call("t1", "Bash", { command: 'gh pr create --title "Notes" --head notes --body x', description: "Open a PR" }, "https://github.com/acme/app/pull/88\n"),
      ...call("t2", "Bash", { command: "gh pr view 12 --repo other/repo" }, [{ type: "text", text: "url:\thttps://github.com/other/repo/pull/12" }]),
      ...call(
        "t3",
        "mcp__github__create_pull_request",
        { owner: "acme", repo: "app", title: "Fix", head: "fix", base: "main" },
        [{ type: "text", text: '{"number":89,"html_url":"https://github.com/acme/app/pull/89"}' }],
      ),
    ]);
    expect([...rows.keys()].sort()).toEqual(["github.com/acme/app/88", "github.com/acme/app/89"]);
    expect(rows.get("github.com/acme/app/88")).toMatchObject({ title: "Notes", branch: "notes", source: "tool" });
    expect(rows.get("github.com/acme/app/89")).toMatchObject({ title: "Fix", branch: "fix" });
  });

  it("is on by default and declares the record; off, it declares and records nothing", async () => {
    const on = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK]) });
    expect(on.declaredResources?.[OBSERVED_PULL_REQUESTS]).toBe(observedPullRequestsCollection);
    const off = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK]), recordPullRequests: false });
    expect(off.declaredResources?.[OBSERVED_PULL_REQUESTS]).toBeUndefined();
    const rows = await run(call("t1", "Bash", { command: "gh pr create --fill" }, "https://github.com/acme/app/pull/88\n"), {
      recordPullRequests: false,
    });
    expect(rows.size).toBe(0);
  });
});
