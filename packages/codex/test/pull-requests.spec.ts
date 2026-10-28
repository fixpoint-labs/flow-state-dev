/**
 * Codex runs record the pull requests they open (`recordPullRequests`, on by
 * default).
 *
 * What a reader of the record relies on: a `gh pr create` Codex runs, wrapped
 * in its shell, is a row written when the command settles; a create-PR MCP
 * tool is a row too; a `gh pr view` is not; the block declares the collection
 * by default, and declares and records nothing when the option is off. The
 * matcher and writer are core's, tested there; this holds the Codex side,
 * through Codex's own emitter and a scripted client.
 */
import { describe, it, expect } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { OBSERVED_PULL_REQUESTS, observedPullRequestsCollection } from "@flow-state-dev/core";
import { REQUEST_END_SEAM, type RequestEndHook } from "@flow-state-dev/core/types";
import { codexAgent, INTERNAL_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { TESTED_SDK_VERSION, type CodexThreadEvent } from "../src/types";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CodexAgentOptions;

/** A Codex command, started and settled. */
function command(id: string, cmd: string, output: string, exitCode = 0): CodexThreadEvent[] {
  return [
    { type: "item.started", item: { id, type: "command_execution", command: cmd, aggregated_output: "", status: "in_progress" } },
    { type: "item.completed", item: { id, type: "command_execution", command: cmd, aggregated_output: output, exit_code: exitCode, status: "completed" } },
  ] as CodexThreadEvent[];
}

function scripted(events: CodexThreadEvent[]) {
  const thread = {
    id: "thr_1",
    async runStreamed() {
      return {
        events: (async function* () {
          yield { type: "thread.started", thread_id: "thr_1" } as CodexThreadEvent;
          for (const e of events) yield e;
          yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } } as CodexThreadEvent;
        })(),
      };
    },
  };
  return () => ({ startThread: () => thread, resumeThread: () => thread });
}

/** Run the block once in a context with the record and a request-end seam; end the request; return the rows. */
async function run(events: CodexThreadEvent[], options: Partial<CodexAgentOptions> = {}) {
  const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(events) as never, ...options });
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

describe("recordPullRequests — on the Codex block", () => {
  it("records the gh pr create and the create-PR tool Codex ran, and not a gh pr view", async () => {
    const rows = await run([
      ...command("i1", "/bin/bash -lc \"gh pr create --title 'Notes' --head notes --fill\"", "https://github.com/acme/app/pull/88\n"),
      ...command("i2", "/bin/bash -lc 'gh pr view 12 --repo other/repo'", "url:\thttps://github.com/other/repo/pull/12\n"),
      {
        type: "item.completed",
        item: {
          id: "i3",
          type: "mcp_tool_call",
          server: "github",
          tool: "create_pull_request",
          arguments: { owner: "acme", repo: "app", title: "Fix", head: "fix" },
          result: { content: [{ type: "text", text: '{"number":89,"html_url":"https://github.com/acme/app/pull/89"}' }] },
          status: "completed",
        },
      } as CodexThreadEvent,
    ]);
    expect([...rows.keys()].sort()).toEqual(["github.com/acme/app/88", "github.com/acme/app/89"]);
    expect(rows.get("github.com/acme/app/88")).toMatchObject({ title: "Notes", branch: "notes", source: "tool" });
    expect(rows.get("github.com/acme/app/89")).toMatchObject({ title: "Fix", branch: "fix" });
  });

  it("is on by default and declares the record; off, it declares and records nothing", async () => {
    const on = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted([]) as never });
    expect(on.declaredResources?.[OBSERVED_PULL_REQUESTS]).toBe(observedPullRequestsCollection);
    const off = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted([]) as never, recordPullRequests: false });
    expect(off.declaredResources ?? {}).toEqual({});
    const rows = await run(command("i1", "gh pr create --fill", "https://github.com/acme/app/pull/88\n"), { recordPullRequests: false });
    expect(rows.size).toBe(0);
  });
});
