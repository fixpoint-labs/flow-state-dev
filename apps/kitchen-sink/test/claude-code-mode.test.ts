/**
 * Claude Code mode's own check (`specs/issues/FIX-1915/PLAN.md` V9; BR-23):
 * each reason this host can't run it disables the mode with that reason, the
 * missing sign-in included, and the sign-in is probed over the environment the
 * run is handed.
 *
 * Red state produced before this was trusted: report a host with no sign-in
 * as available, and the sign-in case fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { claudeCodeModeCheck, type ClaudeCodeHostChecks } from "@/lib/claude-code-mode";

const able: ClaudeCodeHostChecks = {
  isRoot: () => false,
  sandboxMissing: () => null,
  probe: async () => ({ status: "signed-in", account: { email: "a@b" } }) as never,
  makeRoot: () => undefined,
};

afterEach(() => vi.unstubAllEnvs());

function check(overrides: Partial<ClaudeCodeHostChecks>) {
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  return claudeCodeModeCheck({ ...able, ...overrides })({ repository: "/repo" });
}

describe("Claude Code mode's check (V9)", () => {
  it("is available on an able host", async () => {
    expect(await check({})).toEqual({ available: true });
  });

  it("is unavailable as root", async () => {
    expect(await check({ isRoot: () => true })).toMatchObject({ available: false, reason: expect.stringContaining("root") });
  });

  it("is unavailable without the sandbox, with its reason and the opt-out", async () => {
    const reason = "Claude Code's sandbox is not available: install bwrap.";
    const result = await check({ sandboxMissing: () => reason });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining(reason) });
    expect(result).toMatchObject({ reason: expect.stringContaining("KITCHEN_SINK_HARNESS_UNSANDBOXED=1") });
  });

  it("with KITCHEN_SINK_HARNESS_UNSANDBOXED=1, doesn't ask about the sandbox and says the run is unsandboxed", async () => {
    vi.stubEnv("KITCHEN_SINK_HARNESS_UNSANDBOXED", "1");
    const sandboxMissing = vi.fn(() => "no sandbox here");
    const result = await check({ sandboxMissing });
    expect(sandboxMissing).not.toHaveBeenCalled();
    expect(result).toMatchObject({ available: true, note: expect.stringContaining("not confined") });
  });

  it("is unavailable when the worktree folder can't be made", async () => {
    const made = await check({
      makeRoot: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(made).toMatchObject({ available: false, reason: expect.stringContaining("EACCES") });
  });

  it("is unavailable without the SDK", async () => {
    const result = await check({ probe: async () => ({ status: "sdk-missing", reason: "not found" }) as never });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("SDK is not installed") });
  });

  it("is unavailable when Claude Code is not signed in", async () => {
    const result = await check({ probe: async () => ({ status: "none", reason: "no credential" }) as never });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("not signed in") });
  });

  it("probes the sign-in over the environment the run is handed", async () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "x");
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    const seen: Record<string, string>[] = [];
    await check({
      probe: async (env) => {
        seen.push(env);
        return { status: "signed-in" } as never;
      },
    });
    expect(seen[0]?.ANTHROPIC_API_KEY).toBe("key");
    expect(seen[0]?.KITCHEN_SINK_PLANTED_SECRET).toBeUndefined();
  });

  it("asks nothing of the host in test mode, where the scripted Claude Code runs", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("KITCHEN_SINK_REAL_HARNESS", "");
    const result = await claudeCodeModeCheck({ ...able, isRoot: () => true })({ repository: "/repo" });
    expect(result).toEqual({ available: true });
  });
});
