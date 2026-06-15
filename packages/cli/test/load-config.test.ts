import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isFlowState } from "@flow-state-dev/server";
import { loadFsdevConfig } from "../src/load-config";
import { CliError } from "../src/resolve-block";
import { EXIT_CONFIG_ERROR } from "../src/exit-codes";

const configFixtures = resolve(import.meta.dirname, "fixtures-config");

let stderrLines: string[];
const originalStderrWrite = process.stderr.write;

beforeEach(() => {
  stderrLines = [];
  process.stderr.write = vi.fn((chunk: any) => {
    stderrLines.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as any;
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
});

describe("loadFsdevConfig", () => {
  it("loads a valid config and returns the FlowState plus path", async () => {
    const loaded = await loadFsdevConfig({ cwd: resolve(configFixtures, "valid") });
    expect(loaded).toBeDefined();
    expect(isFlowState(loaded!.flowState)).toBe(true);
    expect(loaded!.path).toContain("fsdev.config.ts");
    expect(loaded!.flowState.meta.flowKeys).toContain("echo");
  });

  it("returns undefined when no config file exists", async () => {
    const empty = mkdtempSync(resolve(tmpdir(), "fsdev-noconfig-"));
    try {
      const loaded = await loadFsdevConfig({ cwd: empty });
      expect(loaded).toBeUndefined();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("throws EXIT_CONFIG_ERROR when an explicit --config path does not exist", async () => {
    await expect(
      loadFsdevConfig({ cwd: configFixtures, configPath: "does-not-exist.ts" }),
    ).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });
  });

  it("loads an explicit --config path that exists", async () => {
    const loaded = await loadFsdevConfig({
      cwd: configFixtures,
      configPath: resolve(configFixtures, "valid", "fsdev.config.ts"),
    });
    expect(loaded).toBeDefined();
    expect(isFlowState(loaded!.flowState)).toBe(true);
  });

  it("rejects a config with no default export", async () => {
    const err = await loadFsdevConfig({ cwd: resolve(configFixtures, "no-default") }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("must default-export a FlowState");
  });

  it("rejects a config whose default export is not a FlowState", async () => {
    const err = await loadFsdevConfig({ cwd: resolve(configFixtures, "not-flowstate") }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("must default-export a FlowState");
  });

  it("surfaces the underlying error when the config throws at import", async () => {
    const err = await loadFsdevConfig({ cwd: resolve(configFixtures, "throwing") }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("boom during config import");
  });

  it("uses the TS-first precedence winner and warns about shadowed files", async () => {
    const loaded = await loadFsdevConfig({ cwd: resolve(configFixtures, "shadowed") });
    expect(loaded!.path).toContain("fsdev.config.ts");
    const warning = stderrLines.join("");
    expect(warning).toContain("multiple fsdev config files");
    expect(warning).toContain("fsdev.config.mjs");
  });

  it("returns a fresh FlowState instance on each load (cache-busting)", async () => {
    const cwd = resolve(configFixtures, "valid");
    const first = await loadFsdevConfig({ cwd });
    const second = await loadFsdevConfig({ cwd });
    expect(first!.flowState).not.toBe(second!.flowState);
  });
});
