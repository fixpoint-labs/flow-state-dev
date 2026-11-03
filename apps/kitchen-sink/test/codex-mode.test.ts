/**
 * Codex mode's own check (`specs/issues/FIX-1916/PLAN.md` V4; BR-15 to BR-18):
 * each reason this host can't run it disables the mode with that reason, an
 * SDK at another version leaves the server up with both versions named, and an
 * unavailable mode registers no flow. Sign-in is checked over the environment
 * the run is handed, not the server's. Nothing is asked about a sandbox:
 * Kitchen Sink confines no run.
 *
 * Whether Codex is ready is the Codex package's answer (`checkCodexReadiness`,
 * tested there); these hold the mode to reading it over the run's environment
 * and showing its reason and remedy as written.
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
  readiness: async () => ({ ready: true }),
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

  it("is unavailable with the package's reason and remedy when Codex isn't signed in (BR-17)", async () => {
    const result = await check({
      readiness: async () => ({ ready: false, reason: "Codex has no credential: Not logged in", remedy: "Run `codex login`, or set CODEX_API_KEY." }),
    });
    expect(result).toEqual({ available: false, reason: "Codex has no credential: Not logged in", remedy: "Run `codex login`, or set CODEX_API_KEY." });
  });

  it("offers no remedy when Codex didn't answer, so its sign-in is unknown", async () => {
    const result = await check({
      readiness: async () => ({ ready: false, reason: "Codex did not answer within 30 s, so Codex's sign-in is unknown", unanswered: true }),
    });
    expect(result).toEqual({ available: false, reason: "Codex did not answer within 30 s, so Codex's sign-in is unknown" });
  });

  it("a key in the run's environment makes it ready, through the Codex package's own check", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    vi.stubEnv("CODEX_API_KEY", "sk-key");
    // The real check: a key answers before Codex is started, so nothing runs here.
    const result = await codexModeCheck({ ...able, readiness: HOST_CHECKS.readiness })({ repository: "/repo" });
    expect(result).toEqual({ available: true });
  });

  it("checks readiness over the run's environment, not the server's", async () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "x");
    vi.stubEnv("CODEX_HOME", "/codex-home");
    const seen: Array<Record<string, string>> = [];
    await check({ readiness: async (env) => (seen.push(env), { ready: true }) });
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
  it("finds the pinned SDK, and reads Codex's own sign-in answer without a run, with what to run", async () => {
    expect(HOST_CHECKS.sdk()).toEqual({ kind: "version", version: TESTED_SDK_VERSION });

    // A home with no stored login, so the developer's own never answers.
    const home = mkdtempSync(join(tmpdir(), "ks-codex-home-"));
    try {
      vi.stubEnv("HOME", home);
      vi.stubEnv("CODEX_HOME", home);
      // Codex's own answer, not a failure to ask.
      const readiness = await HOST_CHECKS.readiness(codexEnv());
      expect(readiness).toMatchObject({ ready: false, remedy: expect.stringContaining("codex login") });
      expect(readiness).not.toHaveProperty("unanswered");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
