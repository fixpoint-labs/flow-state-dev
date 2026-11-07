/**
 * Cursor mode's own check (`specs/issues/FIX-1917/PLAN.md` V7; BR-22, BR-23):
 * each reason this host can't run it disables the mode with that reason, the
 * missing sign-in included, and an unavailable mode registers no flow. The
 * sign-in and the runtime's process are checked over the environment the run
 * is handed, not the server's.
 *
 * Nothing is asked about a sandbox: Kitchen Sink confines no run.
 *
 * Whether Cursor is signed in is the Cursor package's answer
 * (`checkCursorReadiness`, tested there, a stored login included); the mode
 * shows its reason and remedy as written.
 *
 * Red state produced before this was trusted: report a host with no key and no
 * stored login as available, and the sign-in case fails.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCursorReadiness, type CursorReadinessOptions } from "@flow-state-dev/cursor";

import { HOST_CHECKS, cursorEnv, cursorModeCheck, cursorSessionFlow, type CursorHostChecks } from "@/lib/cursor-mode";
import { availableHarnessFlows, resetModeAvailabilityForTests } from "@/lib/harness-gate";

/** What the package reads the installed SDK as. */
type InstalledSdkVersion = ReturnType<NonNullable<CursorReadinessOptions["readInstalledSdkVersion"]>>;

const able: CursorHostChecks = {
  makeRoot: () => undefined,
  childStarts: () => null,
  readiness: async () => ({ ready: true }),
};

/** The Cursor package's own readiness, over a stated installed SDK: the mode reads its answer. */
const packageReadiness = (installed: InstalledSdkVersion) => (env: Record<string, string>) => checkCursorReadiness(env, { readInstalledSdkVersion: () => installed });

afterEach(() => {
  vi.unstubAllEnvs();
  resetModeAvailabilityForTests();
});

function check(overrides: Partial<CursorHostChecks>) {
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  return cursorModeCheck({ ...able, ...overrides })({ repository: "/repo" });
}

describe("Cursor mode's check (V7)", () => {
  it("is available on an able host", async () => {
    expect(await check({})).toEqual({ available: true });
  });

  it("is unavailable without the SDK", async () => {
    const result = await check({ readiness: packageReadiness({ kind: "absent" }) });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("not installed"), remedy: expect.stringContaining("@cursor/sdk") });
  });

  it("is unavailable with another SDK version, naming both", async () => {
    const result = await check({ readiness: packageReadiness({ kind: "version", version: "1.0.99" }) });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("1.0.99"), remedy: expect.stringContaining("@cursor/sdk") });
  });

  it("is unavailable when the SDK's version can't be read", async () => {
    const result = await check({ readiness: packageReadiness({ kind: "unreadable", reason: "a custom loader" }) });
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

  it("is unavailable when the runtime's process can't start with the run's environment (BR-23)", async () => {
    const result = await check({ childStarts: () => "spawn ENOENT" });
    expect(result).toMatchObject({ available: false, reason: expect.stringContaining("spawn ENOENT") });
  });

  it("is unavailable with no key and no stored login, with the Cursor package's reason and remedy", async () => {
    const result = await check({
      readiness: async () => ({ ready: false, reason: "Cursor has no sign-in: no stored login", remedy: "Set CURSOR_API_KEY" }),
    });
    expect(result).toEqual({ available: false, reason: "Cursor has no sign-in: no stored login", remedy: "Set CURSOR_API_KEY" });
  });

  it("checks the sign-in and starts the process over the run's environment, not the server's", async () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "x");
    vi.stubEnv("CURSOR_API_KEY", "key");
    const seen: Record<string, string>[] = [];
    await check({
      childStarts: (env) => (seen.push(env), null),
      readiness: async (env) => (seen.push(env), { ready: true }),
    });
    expect(seen).toHaveLength(2);
    for (const env of seen) {
      expect(env.CURSOR_API_KEY).toBe("key");
      expect(env.KITCHEN_SINK_PLANTED_SECRET).toBeUndefined();
    }
  });

  it("asks nothing of the host in test mode, where the scripted Cursor runs", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("KITCHEN_SINK_REAL_HARNESS", "");
    const result = await cursorModeCheck({ ...able, readiness: packageReadiness({ kind: "absent" }) })({ repository: "/repo" });
    expect(result).toEqual({ available: true });
  });

  it("an unavailable mode registers no flow", async () => {
    vi.stubEnv("VERCEL", "1");
    const factory = vi.fn(() => cursorSessionFlow());
    const flows = await availableHarnessFlows({ cursor: factory });
    expect(flows.cursor).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("Cursor mode's check, on this host's own answers", () => {
  it("finds the pinned SDK, starts a process with only the run's environment, and reads the sign-in", async () => {
    expect(HOST_CHECKS.childStarts(cursorEnv())).toBeNull();

    // A home with no stored login, so the developer's own never answers.
    const home = mkdtempSync(join(tmpdir(), "ks-cursor-home-"));
    try {
      vi.stubEnv("HOME", home);
      vi.stubEnv("CURSOR_API_KEY", "");
      expect(await HOST_CHECKS.readiness(cursorEnv())).toMatchObject({ ready: false, remedy: expect.stringContaining("CURSOR_API_KEY") });
      vi.stubEnv("CURSOR_API_KEY", "key");
      expect(await HOST_CHECKS.readiness(cursorEnv())).toEqual({ ready: true });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
