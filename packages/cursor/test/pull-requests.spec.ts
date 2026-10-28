/**
 * Cursor runs record the pull requests they open (`recordPullRequests`, on by
 * default).
 *
 * What a reader of the record relies on: a `gh pr create` Cursor runs is a
 * row, written when its shell call settles; a `gh pr view` is not; the block
 * declares the collection by default, and declares and records nothing when
 * the option is off. The matcher and writer are core's, tested there; this
 * holds the Cursor side, through Cursor's own emitter and a scripted client,
 * with the shell result shape a real Cursor run recorded
 * (`core/test/fixtures/pull-requests/cursor-shell.json`).
 */
import { describe, it, expect } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { OBSERVED_PULL_REQUESTS, observedPullRequestsCollection } from "@flow-state-dev/core";
import { REQUEST_END_SEAM, type RequestEndHook } from "@flow-state-dev/core/types";
import { cursorAgent, INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import { TESTED_SDK_VERSION, type CursorSdkMessage, type ResolvedCursorClient } from "../src/types";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

/** A Cursor shell call, opened and settled with the result shape a real run carried. */
function shell(callId: string, command: string, stdout: string, stderr = "", exitCode = 0): CursorSdkMessage[] {
  const args = { command, timeout: 30000 };
  return [
    { type: "tool_call", call_id: callId, name: "shell", status: "running", args },
    {
      type: "tool_call",
      call_id: callId,
      name: "shell",
      status: "completed",
      args,
      result: { status: "success", value: { exitCode, signal: "", stdout, stderr, executionTime: 90 } },
    },
  ];
}

function replaying(messages: CursorSdkMessage[]): () => ResolvedCursorClient {
  const agent = {
    agentId: "agent_1",
    async send() {
      return {
        id: "run_1",
        stream: async function* () {
          for (const m of messages) yield m;
        },
        wait: async () => ({ status: "finished" }),
        cancel: async () => {},
      };
    },
  };
  return () => ({ create: async () => agent, resume: async () => agent });
}

/** Run the block once in a context with the record and a request-end seam; end the request; return the rows. */
async function run(messages: CursorSdkMessage[], options: Partial<CursorAgentOptions> = {}) {
  const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying(messages), ...options });
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

const CREATE = "gh pr create --title 'Add notes export' --body x --head notes-export";

describe("recordPullRequests — on the Cursor block", () => {
  it("records a gh pr create Cursor ran, and not a gh pr view", async () => {
    const rows = await run([
      ...shell("c1", CREATE, "https://github.com/acme/app/pull/88\n", "\nCreating pull request for notes-export into main in acme/app\n\n"),
      ...shell("c2", "gh pr view 12 --repo other/repo", "url:\thttps://github.com/other/repo/pull/12\n"),
    ]);
    expect([...rows.keys()]).toEqual(["github.com/acme/app/88"]);
    expect(rows.get("github.com/acme/app/88")).toMatchObject({
      repository: "acme/app",
      number: 88,
      title: "Add notes export",
      branch: "notes-export",
      source: "tool",
    });
  });

  it("is on by default and declares the record; off, it declares and records nothing", async () => {
    const on = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([]) });
    expect(on.declaredResources?.[OBSERVED_PULL_REQUESTS]).toBe(observedPullRequestsCollection);
    const off = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([]), recordPullRequests: false });
    expect(off.declaredResources?.[OBSERVED_PULL_REQUESTS]).toBeUndefined();
    const rows = await run(shell("c1", CREATE, "https://github.com/acme/app/pull/88\n"), { recordPullRequests: false });
    expect(rows.size).toBe(0);
  });
});
