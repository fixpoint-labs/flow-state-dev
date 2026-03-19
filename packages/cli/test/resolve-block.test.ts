import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { resolveBlock, isBlockDefinition, CliError } from "../src/resolve-block";
import { EXIT_DISCOVERY_ERROR } from "../src/exit-codes";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("isBlockDefinition", () => {
  it("returns true for a valid block definition", async () => {
    const mod = await import("./fixtures/valid-block");
    expect(isBlockDefinition(mod.default)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isBlockDefinition(null)).toBe(false);
  });

  it("returns false for an object missing run", () => {
    expect(isBlockDefinition({ kind: "handler", name: "test" })).toBe(false);
  });

  it("returns false for an object with invalid kind", () => {
    expect(isBlockDefinition({ kind: "unknown", name: "test", run: () => {} })).toBe(false);
  });
});

describe("resolveBlock", () => {
  it("resolves a valid block file", async () => {
    const block = await resolveBlock(resolve(fixturesDir, "valid-block.ts"));
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("echo-block");
    expect(typeof block.run).toBe("function");
  });

  it("throws CliError for missing file", async () => {
    try {
      await resolveBlock(resolve(fixturesDir, "nonexistent.ts"));
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
      expect((err as CliError).message).toContain("not found");
    }
  });

  it("throws CliError for file with no default export", async () => {
    try {
      await resolveBlock(resolve(fixturesDir, "no-default-export.ts"));
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
      expect((err as CliError).message).toContain("no default export");
    }
  });

  it("throws CliError for invalid default export", async () => {
    try {
      await resolveBlock(resolve(fixturesDir, "invalid-export.ts"));
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
      expect((err as CliError).message).toContain("not a valid BlockDefinition");
    }
  });
});
