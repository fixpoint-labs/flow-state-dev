/**
 * The wire, pinned. The graduated form of the spec POC
 * (`spec-poc/LAB-153-codex-sdk-shape/`), which never merges.
 *
 * Every other spec here scripts the client, which proves the block and proves
 * nothing about the SDK. This one runs the **installed `@openai/codex-sdk`**
 * against a fake `codex` binary that speaks the JSONL wire, so the block is
 * driven end to end through the real client, the real argv construction and the
 * real JSONL parser — with no API key, no network and no model.
 *
 * That is the enforcement half of decision 1. The version gate says a host may
 * not run an untested wire; this spec is what makes "tested" mean something,
 * and it is what goes red when a Codex bump changes the wire under us.
 *
 * No subprocess-free shortcut can replace it: the premises it holds — the argv
 * shape, `resume <id>` after every option, the thread id on the first event,
 * an abort that rejects, a non-zero exit that throws — are all facts about the
 * SDK, not about this package.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTestContext, testBlock } from "@flow-state-dev/testing";
import { codexAgent } from "../src/agent";
import { CodexAgentAbortedError, CodexAgentRunError } from "../src/errors";
import type { CodexAgentHandle, CodexClientOptions } from "../src/types";

const FAKE = resolve(import.meta.dirname, "fake-codex.mjs");
const LOG = join(mkdtempSync(join(tmpdir(), "codex-wire-")), "fake.log");

beforeAll(() => {
  chmodSync(FAKE, 0o755);
});

/** Client options pointing the REAL SDK at the fake binary. */
function client(mode: string): CodexClientOptions {
  writeFileSync(LOG, "");
  return {
    codexPathOverride: FAKE,
    apiKey: "sk-test",
    // The SDK does not inherit `process.env` when `env` is given, so PATH has
    // to be spread in or the fake's `#!/usr/bin/env node` shebang cannot resolve.
    env: {
      ...(process.env as Record<string, string>),
      FAKE_CODEX_MODE: mode,
      FAKE_CODEX_LOG: LOG,
    },
  };
}

const log = () => readFileSync(LOG, "utf8");

describe("the installed SDK against the pinned wire", () => {
  it("builds `exec --experimental-json` with the resolved directory and the forwarded options, and puts the prompt on stdin", async () => {
    const block = codexAgent({
      client: client("ok"),
      cwd: () => "/tmp",
      thread: { model: "gpt-5.4-codex", sandboxMode: "workspace-write", skipGitRepoCheck: true },
    });
    const { output, error } = await testBlock(block, { input: { prompt: "write notes.md" } });
    const handle = output as CodexAgentHandle;

    expect(error).toBeNull();
    const argv = log();
    expect(argv).toMatch(/ARGV: exec --experimental-json/);
    expect(argv).toContain("--model gpt-5.4-codex");
    expect(argv).toContain("--cd /tmp");
    expect(argv).toContain("--skip-git-repo-check");
    // The prompt travels on stdin, never on the argv a process list would show.
    expect(argv).toContain("STDIN: write notes.md");
    expect(argv.split("\n")[0]).not.toContain("write notes.md");
    // And the client options reached the child's environment.
    expect(argv).toContain("CODEX_API_KEY=sk-test");

    expect(handle).toMatchObject({
      source: "codex/sdk",
      status: "completed",
      sessionId: "thr_fake_1",
      outcome: "finished",
      finalMessage: "Wrote notes.md",
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
    expect(handle.cost).toMatchObject({ basis: "estimated" });
  });

  it("puts `resume <id>` on the argv after every option, and hands the id back on the handle", async () => {
    const block = codexAgent({
      client: client("ok"),
      cwd: () => "/tmp",
      resume: () => "thr_saved_42",
      thread: { skipGitRepoCheck: true },
    });
    const { output } = await testBlock(block, { input: { prompt: "continue" } });

    expect(log()).toMatch(/ARGV: exec --experimental-json .*resume thr_saved_42$/m);
    expect((output as CodexAgentHandle).sessionId).toBe("thr_saved_42");
  });

  it("names the thread on the FIRST event, so the hook has the id before the turn ends", async () => {
    const seen: string[] = [];
    const block = codexAgent({
      client: client("ok"),
      thread: { skipGitRepoCheck: true },
      onSession: (id) => {
        seen.push(id);
      },
    });
    const { output } = await testBlock(block, { input: { prompt: "go" } });

    expect(seen).toEqual(["thr_fake_1"]);
    expect((output as CodexAgentHandle).finalMessage).toBe("Wrote notes.md");
  });

  it("a turn the model fails is an outcome on the handle, not a throw", async () => {
    const block = codexAgent({ client: client("fail"), thread: { skipGitRepoCheck: true } });
    const { output, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect(output as CodexAgentHandle).toMatchObject({
      status: "errored",
      outcome: "failed",
      failureMessage: "boom from the model",
      usage: null,
      cost: null,
    });
  });

  it("a non-zero exit throws, carrying the CLI's stderr", async () => {
    const block = codexAgent({ client: client("crash"), thread: { skipGitRepoCheck: true } });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBeInstanceOf(CodexAgentRunError);
    expect((error?.cause as Error).message).toContain("fatal: something");
  });

  it("a fired deadline throws promptly even while the CLI's stdout is held open", async () => {
    // The POC's finding, executed against the real SDK: the fake spawns a
    // grandchild that inherits stdout and outlives the kill, so the SDK's own
    // rejection cannot arrive until that pipe closes seconds later. A deadline
    // that waited for it would not bound what it promised — so the block races
    // its own signal, and this is the spec that holds it.
    const seen: string[] = [];
    const block = codexAgent({
      client: client("hang"),
      thread: { skipGitRepoCheck: true },
      onSession: (id) => {
        seen.push(id);
      },
    });
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
    setTimeout(() => ac.abort(), 300);

    const startedAt = Date.now();
    await expect(
      block.config.execute?.({ prompt: "hang" }, runtime.ctx as never),
    ).rejects.toBeInstanceOf(CodexAgentAbortedError);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(3_000);
    // And the id the host needs to resume the run its deadline killed is
    // already in the host's own state.
    expect(seen).toEqual(["thr_fake_1"]);
  }, 20_000);
});
