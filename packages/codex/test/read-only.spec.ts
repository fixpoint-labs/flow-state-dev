/**
 * `codexAgent({ access })` (FIX-2900): a run fed `read-only` starts or resumes
 * its thread in Codex's read-only sandbox, with no approval asked and no
 * network, whatever the host's thread options say. A full run, or one with no
 * feed, keeps the host's options.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import type { HarnessAccess } from "@flow-state-dev/core/harness";
import { codexAgent, INTERNAL_CODEX_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { codexHarness } from "../src/harness";
import { TESTED_CODEX_SDK, type CodexThreadEvent } from "../src/types";

const GATE_OFF = {
  [INTERNAL_CODEX_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_CODEX_SDK.range }),
} as CodexAgentOptions;

const STREAM: CodexThreadEvent[] = [
  { type: "thread.started", thread_id: "thr_1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "i1", type: "agent_message", text: "It merged." } },
  { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
];

/** A Codex client that records the thread options each start and resume was handed. */
function recording() {
  const seen: Array<Record<string, unknown> | undefined> = [];
  const thread = (id: string | null) => ({
    get id() {
      return id;
    },
    async runStreamed() {
      return { events: (async function* () { for (const event of STREAM) yield event; })() };
    },
  });
  return {
    seen,
    resolve: () => ({
      startThread: (options?: Record<string, unknown>) => (seen.push(options), thread(null)),
      resumeThread: (id: string, options?: Record<string, unknown>) => (seen.push(options), thread(id)),
    }),
  };
}

/** The host's bag: what `codexHarness()` hands a run, widened as far as a host can. */
const HOST: CodexAgentOptions["thread"] = { sandboxMode: "danger-full-access", approvalPolicy: "on-request", networkAccessEnabled: true };

async function threadOptionsFor(access: HarnessAccess | undefined, resume: string | null) {
  const client = recording();
  const result = await testBlock(
    codexAgent({
      ...GATE_OFF,
      resolveCodexClient: client.resolve,
      cwd: () => "/work/checkout",
      resume: () => resume,
      thread: HOST,
      ...(access === undefined ? {} : { access: () => access }),
    }),
    { input: { prompt: "Is it in?" } },
  );
  expect(result.error ?? null).toBeNull();
  return client.seen[0];
}

describe("a read-only Codex run", () => {
  it.each([
    ["a fresh thread", null],
    ["a resumed thread", "thr_0"],
  ])("%s runs in the read-only sandbox, never asks, and has no network, over the host's thread options", async (_name, resume) => {
    expect(await threadOptionsFor("read-only", resume)).toMatchObject({
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      workingDirectory: "/work/checkout",
    });
  });

  it("control: a full run, and a run with no access feed, keep the host's thread options", async () => {
    for (const access of ["full", undefined] as const) {
      expect(await threadOptionsFor(access, null)).toMatchObject(HOST!);
    }
  });

  it("the block declares enforcesReadOnly, and the harness feeds it access", async () => {
    expect(codexAgent({ ...GATE_OFF }).enforcesReadOnly).toBe(true);
    const client = recording();
    const harness = codexHarness({ resolveCodexClient: client.resolve, ...GATE_OFF });
    const block = harness.agent({ cwd: () => "/work", worktree: () => "/work", resume: () => null, onSession: () => {}, onUsage: () => {}, access: () => "read-only" });
    expect(block.enforcesReadOnly).toBe(true);
    await testBlock(block, { input: { prompt: "Is it in?" } });
    expect(client.seen[0]).toMatchObject({ sandboxMode: "read-only" });
  });
});
