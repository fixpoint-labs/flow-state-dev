/**
 * What a Claude Code run's process can read out of its environment.
 *
 * Driven through the **installed Agent SDK** against a fake CLI that records
 * the environment it was started with, so the claim is about the real spawn
 * rather than about the options object the block builds. A model with a shell
 * tool can read anything that environment holds, which is why the default and
 * the allowlisted case are both pinned here: the default is what the docs
 * promise today, and the allowlist is what a host relies on to keep its own
 * secrets out of the run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { testBlock } from "@flow-state-dev/testing";
import { harnessEnv } from "@flow-state-dev/core";
import { claudeCodeAgent } from "../../src/sdk/agent";
import type { ClaudeAgentQuery, ResolveClaudeAgent } from "../../src/sdk/types";

const FAKE_CLI = resolve(import.meta.dirname, "fake-claude-env.mjs");
const SECRET = "HARNESS_ENV_SPEC_SERVER_SECRET";

/** The real SDK's `query`, pointed at the fake CLI instead of the real one. */
const realSdkWithFakeCli: ResolveClaudeAgent = async () => {
  const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as { query: ClaudeAgentQuery };
  return {
    query: (args) =>
      sdk.query({ ...args, options: { ...args.options, pathToClaudeCodeExecutable: FAKE_CLI } as never }),
  };
};

/** Run the block once in a fresh directory; return the environment its process saw. */
async function envSeenByRun(env?: Record<string, string>): Promise<Record<string, string>> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "harness-env-")));
  const block = claudeCodeAgent({
    resolveClaudeAgent: realSdkWithFakeCli,
    cwd: () => dir,
    ...(env !== undefined ? { env } : {}),
  });
  // The fake exits 1 once it has written the file, so the run fails — for that
  // reason and no other. Anything else (the SDK never reaching the spawn, a
  // missing `node`) would leave no file and must not pass as "saw nothing".
  const result = await testBlock(block, { input: { prompt: "go" } });
  expect(String(result.error?.message)).toMatch(/exited with code 1/);
  const file = join(dir, "seen-env.json");
  expect(existsSync(file)).toBe(true);
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the environment a Claude Code run's process inherits", () => {
  it("is the server's whole process.env when no env is given, secrets included", async () => {
    vi.stubEnv(SECRET, "server-only");

    const seen = await envSeenByRun();

    expect(seen[SECRET]).toBe("server-only");
    expect(seen.PATH).toBe(process.env.PATH);
  });

  it("holds only what harnessEnv names, so an unnamed server secret never reaches the run", async () => {
    vi.stubEnv(SECRET, "server-only");
    vi.stubEnv("HARNESS_ENV_SPEC_PASSED", "for-the-run");

    const seen = await envSeenByRun(harnessEnv({ pass: ["PATH", "HARNESS_ENV_SPEC_PASSED"] }));

    expect(SECRET in seen).toBe(false);
    expect(seen.HARNESS_ENV_SPEC_PASSED).toBe("for-the-run");
    // PATH is passed only because it was named; here the SDK finds `node` through it to start the fake.
    expect(seen.PATH).toBe(process.env.PATH);
    // Nothing else is carried over. The SDK sets two markers of its own on
    // every process it starts; everything beyond those is what was named.
    const sdkMarkers = ["CLAUDE_AGENT_SDK_VERSION", "CLAUDE_CODE_ENTRYPOINT"];
    expect(Object.keys(seen).filter((k) => !sdkMarkers.includes(k)).sort()).toEqual([
      "HARNESS_ENV_SPEC_PASSED",
      "PATH",
    ]);
  });
});
