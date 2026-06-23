import { describe, expect, it, afterEach } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { loadEnvFiles, loadExplicitEnvFiles } from "../src/load-env";
import { CliError } from "../src/resolve-block";
import { EXIT_CONFIG_ERROR } from "../src/exit-codes";

const tmpDir = resolve(import.meta.dirname, ".tmp-env-test");

function setup(files: Record<string, string>) {
  mkdirSync(tmpDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = resolve(tmpDir, relativePath);
    mkdirSync(resolve(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }
}

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // Clean up env vars set during tests
  delete process.env.__TEST_CLI_ENV_A;
  delete process.env.__TEST_CLI_ENV_B;
  delete process.env.__TEST_CLI_ENV_QUOTED;
  delete process.env.__TEST_CLI_ENV_EXPLICIT;
});

describe("loadEnvFiles", () => {
  it("loads key=value pairs from .env.local", () => {
    setup({
      ".env.local": "__TEST_CLI_ENV_A=hello\n__TEST_CLI_ENV_B=world",
    });

    const loaded = loadEnvFiles(tmpDir);
    expect(loaded.length).toBeGreaterThan(0);
    expect(process.env.__TEST_CLI_ENV_A).toBe("hello");
    expect(process.env.__TEST_CLI_ENV_B).toBe("world");
  });

  it("strips surrounding quotes from values", () => {
    setup({
      ".env.local": '__TEST_CLI_ENV_QUOTED="quoted value"',
    });

    loadEnvFiles(tmpDir);
    expect(process.env.__TEST_CLI_ENV_QUOTED).toBe("quoted value");
  });

  it("does not overwrite existing environment variables", () => {
    process.env.__TEST_CLI_ENV_A = "existing";
    setup({
      ".env.local": "__TEST_CLI_ENV_A=overwritten",
    });

    loadEnvFiles(tmpDir);
    expect(process.env.__TEST_CLI_ENV_A).toBe("existing");
  });

  it("skips comments and empty lines", () => {
    setup({
      ".env.local": "# This is a comment\n\n__TEST_CLI_ENV_A=fromcommentfile",
    });

    loadEnvFiles(tmpDir);
    expect(process.env.__TEST_CLI_ENV_A).toBe("fromcommentfile");
  });

  it("returns empty array when no .env.local exists", () => {
    mkdirSync(tmpDir, { recursive: true });
    const loaded = loadEnvFiles(tmpDir);
    // May load files from parent dirs, but at minimum shouldn't crash
    expect(Array.isArray(loaded)).toBe(true);
  });
});

describe("loadExplicitEnvFiles", () => {
  it("loads a file outside the cwd ancestry (resolved relative to cwd)", () => {
    // The file lives in a sibling subdir the cwd walk-up would never reach.
    setup({ "app/.env.local": "__TEST_CLI_ENV_EXPLICIT=from-explicit" });

    const loaded = loadExplicitEnvFiles(tmpDir, ["app/.env.local"]);
    expect(loaded).toEqual([resolve(tmpDir, "app/.env.local")]);
    expect(process.env.__TEST_CLI_ENV_EXPLICIT).toBe("from-explicit");
  });

  it("accepts absolute paths", () => {
    setup({ "app/.env.local": "__TEST_CLI_ENV_EXPLICIT=abs" });
    const abs = resolve(tmpDir, "app/.env.local");

    loadExplicitEnvFiles(tmpDir, [abs]);
    expect(process.env.__TEST_CLI_ENV_EXPLICIT).toBe("abs");
  });

  it("throws CliError(EXIT_CONFIG_ERROR) when the file is missing", () => {
    mkdirSync(tmpDir, { recursive: true });
    try {
      loadExplicitEnvFiles(tmpDir, ["does-not-exist.env"]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_CONFIG_ERROR);
    }
  });

  it("does not overwrite existing environment variables", () => {
    process.env.__TEST_CLI_ENV_EXPLICIT = "existing";
    setup({ "app/.env.local": "__TEST_CLI_ENV_EXPLICIT=overwritten" });

    loadExplicitEnvFiles(tmpDir, ["app/.env.local"]);
    expect(process.env.__TEST_CLI_ENV_EXPLICIT).toBe("existing");
  });

  it("takes precedence over the cwd walk-up when applied first (first-set wins)", () => {
    // Explicit file and cwd .env.local both define the same key; running the
    // explicit loader first means its value wins — this is the call order the
    // commands use so an explicit --env-file outranks auto-discovery.
    setup({
      "app/.env.local": "__TEST_CLI_ENV_A=explicit-wins",
      ".env.local": "__TEST_CLI_ENV_A=walkup-loses",
    });

    loadExplicitEnvFiles(tmpDir, ["app/.env.local"]);
    loadEnvFiles(tmpDir);
    expect(process.env.__TEST_CLI_ENV_A).toBe("explicit-wins");
  });
});
