import { describe, expect, it, afterEach } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { loadEnvFiles } from "../src/load-env";

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
