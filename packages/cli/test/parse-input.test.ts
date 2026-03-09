import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { parseInputArg } from "../src/parse-input.js";
import { CliError } from "../src/resolve-block.js";
import { EXIT_INVALID_ARGS } from "../src/exit-codes.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("parseInputArg", () => {
  it("parses inline JSON from --input", () => {
    const result = parseInputArg({ input: '{"key": "value"}' });
    expect(result).toEqual({ key: "value" });
  });

  it("returns undefined when neither flag is provided", () => {
    const result = parseInputArg({});
    expect(result).toBeUndefined();
  });

  it("reads JSON from --input-file", () => {
    const result = parseInputArg({
      inputFile: resolve(fixturesDir, "input-data.json"),
    });
    expect(result).toEqual({ text: "hello from file" });
  });

  it("throws when both --input and --input-file are provided", () => {
    try {
      parseInputArg({ input: "{}", inputFile: "file.json" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_INVALID_ARGS);
      expect((err as CliError).message).toContain("Cannot specify both");
    }
  });

  it("throws for invalid JSON in --input", () => {
    try {
      parseInputArg({ input: "not json" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_INVALID_ARGS);
      expect((err as CliError).message).toContain("Invalid JSON");
    }
  });

  it("throws for missing --input-file path", () => {
    try {
      parseInputArg({ inputFile: "/nonexistent/path.json" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_INVALID_ARGS);
      expect((err as CliError).message).toContain("Cannot read input file");
    }
  });
});
