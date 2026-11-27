/**
 * `FSD_CLAUDE_CODE_AUTH`: whether a server's `ANTHROPIC_API_KEY` reaches a
 * Claude Code process. Claude Code takes a key over a sign-in whenever it sees
 * one, so holding the key back is the only way a server that keeps a key for
 * direct model calls can run the harness on its `claude` sign-in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyClaudeCodeAuthPreference,
  readClaudeCodeAuthPreference,
  resetClaudeCodeAuthPreferenceCache,
} from "../../src/sdk/auth-preference";

const WITH_KEY = { PATH: "/bin", HOME: "/home/u", ANTHROPIC_API_KEY: "sk-direct" };
const WITHOUT_KEY = { PATH: "/bin", HOME: "/home/u" };

beforeEach(() => resetClaudeCodeAuthPreferenceCache());

describe("readClaudeCodeAuthPreference", () => {
  it("is api-key when unset, so a server that never sets it keeps today's behaviour", () => {
    expect(readClaudeCodeAuthPreference({})).toBe("api-key");
    expect(readClaudeCodeAuthPreference({ FSD_CLAUDE_CODE_AUTH: " " })).toBe("api-key");
  });

  it("refuses an unknown value, so a typo never silently bills the key", () => {
    expect(() => readClaudeCodeAuthPreference({ FSD_CLAUDE_CODE_AUTH: "prefer_login" })).toThrow(/not one of/);
  });
});

describe("applyClaudeCodeAuthPreference", () => {
  it("api-key passes the key through", async () => {
    expect(await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "api-key" })).toEqual(WITH_KEY);
  });

  it("login-only never passes the key, even with no sign-in to fall back on", async () => {
    const hasLogin = vi.fn(async () => false);
    expect(await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "login-only", hasLogin })).toEqual(WITHOUT_KEY);
    expect(hasLogin).not.toHaveBeenCalled();
  });

  it("prefer-login drops the key when Claude Code finds a sign-in without it", async () => {
    const hasLogin = vi.fn(async () => true);
    expect(await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "prefer-login", hasLogin })).toEqual(WITHOUT_KEY);
    // It asked about the environment the run would have without the key.
    expect(hasLogin).toHaveBeenCalledWith(WITHOUT_KEY);
  });

  it("prefer-login keeps the key when there is no sign-in, so the run can still start", async () => {
    expect(await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "prefer-login", hasLogin: async () => false })).toEqual(WITH_KEY);
  });

  it("prefer-login keeps the key when the probe could not tell, and asks again next time", async () => {
    const hasLogin = vi.fn(async () => undefined);
    expect(await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "prefer-login", hasLogin })).toEqual(WITH_KEY);
    await Promise.resolve();
    await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "prefer-login", hasLogin });
    expect(hasLogin).toHaveBeenCalledTimes(2);
  });

  it("prefer-login asks once per environment, not once per run", async () => {
    const hasLogin = vi.fn(async () => true);
    await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "prefer-login", hasLogin });
    await applyClaudeCodeAuthPreference(WITH_KEY, { preference: "prefer-login", hasLogin });
    expect(hasLogin).toHaveBeenCalledTimes(1);
  });

  it("leaves an environment with no key alone, whatever the preference", async () => {
    const hasLogin = vi.fn(async () => true);
    expect(await applyClaudeCodeAuthPreference(WITHOUT_KEY, { preference: "prefer-login", hasLogin })).toBe(WITHOUT_KEY);
    expect(hasLogin).not.toHaveBeenCalled();
  });
});
