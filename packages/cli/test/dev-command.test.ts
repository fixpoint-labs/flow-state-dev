import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { executeDevCommand } from "../src/commands/dev";
import { CliError } from "../src/resolve-block";
import { EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR } from "../src/exit-codes";

const appConfigDir = resolve(import.meta.dirname, "fixtures-config", "app");

// These cases all error before `serve()` binds a port, so they exercise the
// config-vs-discovery wiring decision without starting a long-lived server
// (whose shutdown path calls process.exit and would kill the test runner).

let savedDebug: string | undefined;
let savedTracing: string | undefined;

beforeEach(() => {
  savedDebug = process.env.FSDEV_DEBUG_ENDPOINTS;
  savedTracing = process.env.FSDEV_TRACING_LEVEL;
  delete process.env.FSDEV_DEBUG_ENDPOINTS;
  delete process.env.FSDEV_TRACING_LEVEL;
});

afterEach(() => {
  if (savedDebug === undefined) delete process.env.FSDEV_DEBUG_ENDPOINTS;
  else process.env.FSDEV_DEBUG_ENDPOINTS = savedDebug;
  if (savedTracing === undefined) delete process.env.FSDEV_TRACING_LEVEL;
  else process.env.FSDEV_TRACING_LEVEL = savedTracing;
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
});
