import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { executeDevCommand } from "../src/commands/dev";
import { CliError } from "../src/resolve-block";
import { EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR, EXIT_CONFIG_ERROR } from "../src/exit-codes";

const appConfigDir = resolve(import.meta.dirname, "fixtures-config", "app");
const getRuntimeThrowsDir = resolve(import.meta.dirname, "fixtures-config", "getruntime-throws");

// These cases all error before `serve()` binds a port, so they exercise the
// config-vs-discovery wiring decision without starting a long-lived server
// (whose shutdown path calls process.exit and would kill the test runner).

const ENV_KEYS = [
  "FSDEV_DEBUG_ENDPOINTS",
  "FSDEV_TRACING_LEVEL",
  "FSDEV_DEV_AUTH",
  "FSD_DB_URL",
  "DATABASE_URL",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("fsdev dev with fsdev.config.ts", () => {
  it("rejects --model combined with a config and still sets the DevTool env defaults", async () => {
    const err = await executeDevCommand({ cwd: appConfigDir, model: "x", open: false }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
    // The config branch sets these before loading, so the DevTool's debug
    // surface and verbose tracing are enabled when the app's router builds.
    expect(process.env.FSDEV_DEBUG_ENDPOINTS).toBe("1");
    expect(process.env.FSDEV_TRACING_LEVEL).toBe("verbose");
  });

  it("rejects --flow-dir combined with a config", async () => {
    const err = await executeDevCommand({
      cwd: appConfigDir,
      flowDir: ["./flows"],
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
  });

  it("--no-config bypasses a present config and falls back to discovery", async () => {
    const err = await executeDevCommand({
      cwd: appConfigDir,
      config: false,
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_DISCOVERY_ERROR);
    expect(err.message).toContain("No flows found");
  });

  it("disposes the config FlowState when getRuntime() fails (no leaked pools)", async () => {
    const g = globalThis as unknown as { __fsdevDisposeCalls: number };
    g.__fsdevDisposeCalls = 0;
    const err = await executeDevCommand({ cwd: getRuntimeThrowsDir, open: false }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    // The init-failure path released the store adapter rather than leaking it.
    expect(g.__fsdevDisposeCalls).toBeGreaterThan(0);
  });
});

describe("fsdev dev --dev-auth", () => {
  it("sets the FSDEV_DEV_AUTH env default so the config's router opts in", async () => {
    // --model forces an early error after beforeConfigLoad, so we can observe
    // the env default without starting a long-lived server.
    const err = await executeDevCommand({
      cwd: appConfigDir,
      devAuth: true,
      model: "x",
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(process.env.FSDEV_DEV_AUTH).toBe("1");
  });

  it("leaves FSDEV_DEV_AUTH unset without the flag", async () => {
    const err = await executeDevCommand({
      cwd: appConfigDir,
      model: "x",
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(process.env.FSDEV_DEV_AUTH).toBeUndefined();
  });

  it("hard-refuses when DATABASE_URL is set (possible production backend)", async () => {
    process.env.DATABASE_URL = "postgres://user@remote-host:5432/prod";
    const err = await executeDevCommand({
      cwd: appConfigDir,
      devAuth: true,
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(err.message).toContain("Development auth refuses to run against a remote/production backend");
  });

  it("hard-refuses when FSD_DB_URL is set", async () => {
    process.env.FSD_DB_URL = "postgres://user@remote-host:5432/prod";
    const err = await executeDevCommand({
      cwd: appConfigDir,
      devAuth: true,
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
  });

  it("hard-refuses when a preset FSDEV_DEV_AUTH=1 activates dev-auth without the flag", async () => {
    // The engine's env fallback activates dev-auth from FSDEV_DEV_AUTH=1 even with
    // no --dev-auth flag; the refuse must key off that effective state, not the flag.
    process.env.FSDEV_DEV_AUTH = "1";
    process.env.DATABASE_URL = "postgres://user@remote-host:5432/prod";
    const err = await executeDevCommand({
      cwd: appConfigDir,
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
  });

  it("an empty FSD_DB_URL does not mask a set DATABASE_URL", async () => {
    process.env.FSD_DB_URL = "";
    process.env.DATABASE_URL = "postgres://user@remote-host:5432/prod";
    const err = await executeDevCommand({
      cwd: appConfigDir,
      devAuth: true,
      open: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
  });
});
