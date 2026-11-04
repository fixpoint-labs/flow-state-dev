/**
 * Claude Code mode's own check (`specs/issues/FIX-1915/PLAN.md` V9; BR-23):
 * each reason this host can't run it disables the mode with that reason, the
 * missing sign-in included (the Claude Code package's readiness check, its
 * reason and remedy shown as written), checked over the environment the run
 * is handed.
 *
 * Red state produced before this was trusted: report a host with no sign-in
 * as available, and the sign-in case fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { claudeCodeModeCheck, type ClaudeCodeHostChecks } from "@/lib/claude-code-mode";

const able: ClaudeCodeHostChecks = {
  isRoot: () => false,
  readiness: async () => ({ ready: true }),
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

  it("is unavailable when the worktree folder can't be made", async () => {
    const made = await check({
      makeRoot: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(made).toMatchObject({ available: false, reason: expect.stringContaining("EACCES") });
  });

  // The sign-in leg is the Claude Code package's readiness check (asking again
  // when Claude Code is slow is tested there): the mode shows its answer as written.
  it("is unavailable with the package's reason and remedy when Claude Code isn't ready", async () => {
    const result = await check({
      readiness: async () => ({ ready: false, reason: "Claude Code has no credential: none", remedy: "Run `claude` and sign in" }),
    });
    expect(result).toEqual({ available: false, reason: "Claude Code has no credential: none", remedy: "Run `claude` and sign in" });
  });

  it("offers no remedy when Claude Code didn't answer, so its sign-in is unknown", async () => {
    const result = await check({
      readiness: async () => ({ ready: false, reason: "Claude Code did not report an account, so Claude Code's sign-in is unknown", unanswered: true }),
    });
    expect(result).toEqual({ available: false, reason: "Claude Code did not report an account, so Claude Code's sign-in is unknown" });
  });

  it("checks readiness over the environment the run is handed", async () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "x");
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    const seen: Record<string, string>[] = [];
    await check({
      readiness: async (env) => {
        seen.push(env);
        return { ready: true };
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
