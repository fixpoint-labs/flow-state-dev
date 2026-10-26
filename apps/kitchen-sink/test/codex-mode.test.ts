/**
 * Codex mode's own check (`specs/issues/FIX-1916/PLAN.md` V4; BR-15 to BR-18):
 * each reason this host can't run it disables the mode with that reason, an
 * SDK at another version leaves the server up with both versions named, and an
 * unavailable mode registers no flow. Sign-in is checked over the environment
 * the run is handed, not the server's. Nothing is asked about a sandbox:
 * Kitchen Sink confines no run.
 *
 * Red states produced before these were trusted:
 *   - count only `codex login status` as signed in: the key-only case reads unavailable.
 *   - build the block when the flow list is made, whatever the check said: the
 *     no-flow case calls the factory, which is where another SDK version throws.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TESTED_SDK_VERSION } from "@flow-state-dev/codex";

import { HOST_CHECKS, codexEnv, codexModeCheck, codexSessionFlow, type CodexHostChecks } from "@/lib/codex-mode";
import { availableHarnessFlows, resetModeAvailabilityForTests } from "@/lib/harness-gate";

const able: CodexHostChecks = {
  sdk: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
  makeRoot: () => "/worktrees",
  loggedIn: async () => true,
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetModeAvailabilityForTests();
});

function check(overrides: Partial<CodexHostChecks>) {
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("CODEX_API_KEY", "");
  return codexModeCheck({ ...able, ...overrides })({ repository: "/repo" });
}

describe("Codex mode's check (V4)", () => {
  it("is available on an able host", async () => {
    expect(await check({})).toEqual({ available: true });
  });

  it("is unavailable without the SDK (BR-15)", async () => {
    const result = await check({ sdk: () => ({ kind: "absent" }) });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("SDK is not installed") });
    expect(result).toMatchObject({ reason: expect.stringContaining(TESTED_SDK_VERSION) });
  });

  it("is unavailable with another SDK version, naming both, through the Codex package's own refusal (BR-16)", async () => {
    const result = await check({ sdk: () => ({ kind: "version", version: "0.999.0" }) });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("0.999.0") });
    expect(result).toMatchObject({ reason: expect.stringContaining(TESTED_SDK_VERSION) });
  });

  it("is unavailable when the SDK's version can't be read", async () => {
    const result = await check({ sdk: () => ({ kind: "unreadable", reason: "a custom loader" }) });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("a custom loader") });
  });

  it("is unavailable when the worktree folder can't be made", async () => {
    const made = await check({
      makeRoot: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(made).toMatchObject({ available: false, reason: expect.stringContaining("EACCES") });
  });

  it("is unavailable when `codex login status` fails and there is no key (BR-17)", async () => {
    const result = await check({ loggedIn: async () => false });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("not signed in") });
  });

  it("a key in the run's environment signs it in, though `codex login status` fails", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    vi.stubEnv("CODEX_API_KEY", "sk-key");
    const result = await codexModeCheck({ ...able, loggedIn: async () => false })({ repository: "/repo" });
    expect(result).toEqual({ available: true });
  });

  it("probes the sign-in over the run's environment, not the server's", async () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "x");
    vi.stubEnv("CODEX_HOME", "/codex-home");
    const seen: Array<Record<string, string>> = [];
    await check({ loggedIn: async (env) => (seen.push(env), true) });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.CODEX_HOME).toBe("/codex-home");
    expect(seen[0]!.KITCHEN_SINK_PLANTED_SECRET).toBeUndefined();
  });

  it("asks nothing of the host in test mode, where the scripted Codex runs", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("KITCHEN_SINK_REAL_HARNESS", "");
    const result = await codexModeCheck({ ...able, sdk: () => ({ kind: "absent" }) })({ repository: "/repo" });
    expect(result).toEqual({ available: true });
  });

  it("an unavailable mode registers no flow, and never builds its block", async () => {
    vi.stubEnv("VERCEL", "1");
    const factory = vi.fn(() => codexSessionFlow());
    const flows = await availableHarnessFlows({ codex: factory });
    expect(flows.codex).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("Codex mode's check, on this host's own answers", () => {
  it("finds the pinned SDK, and reads Codex's own sign-in answer without a run", async () => {
    expect(HOST_CHECKS.sdk()).toEqual({ kind: "version", version: TESTED_SDK_VERSION });

    // A home with no stored login, so the developer's own never answers.
    const home = mkdtempSync(join(tmpdir(), "ks-codex-home-"));
    try {
      vi.stubEnv("HOME", home);
      vi.stubEnv("CODEX_HOME", home);
      expect(await HOST_CHECKS.loggedIn(codexEnv())).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
