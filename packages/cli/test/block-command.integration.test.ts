import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { executeBlockCommand, type BlockExecResult } from "../src/commands/block";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

// Capture stdout writes
let stdoutOutput: string;
const originalStdoutWrite = process.stdout.write;

beforeEach(() => {
  stdoutOutput = "";
  process.stdout.write = vi.fn((chunk: any) => {
    stdoutOutput += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as any;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.exitCode = undefined;
});

describe("fsdev block integration", () => {
  it("executes a handler block with inline JSON input", async () => {
    const result = await executeBlockCommand(
      resolve(fixturesDir, "echo-handler.ts"),
      { input: '{"text": "hello"}' },
    );

    expect(result.success).toBe(true);
    expect(result.block.kind).toBe("handler");
    expect(result.block.name).toBe("echo-handler");
    expect(result.output).toEqual({ text: "hello", source: "echo-handler" });
    expect(result.execution.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.schemaValidation.input.passed).toBe(true);
    expect(result.schemaValidation.output.passed).toBe(true);

    // Verify stdout got JSON output
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
  });

  it("executes with --input-file", async () => {
    const result = await executeBlockCommand(
      resolve(fixturesDir, "echo-handler.ts"),
      { inputFile: resolve(fixturesDir, "input-data.json") },
    );

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ text: "hello from file", source: "echo-handler" });
  });

  it("reports schema validation errors for invalid input", async () => {
    const result = await executeBlockCommand(
      resolve(fixturesDir, "schema-block.ts"),
      { input: '{"name": "", "age": -5}' },
    );

    // Schema validation is non-aborting — block still runs
    expect(result.schemaValidation.input.passed).toBe(false);
    expect(result.schemaValidation.input.errors).toBeDefined();
    expect(result.schemaValidation.input.errors!.length).toBeGreaterThan(0);
  });

  it("handles block execution errors", async () => {
    const result = await executeBlockCommand(
      resolve(fixturesDir, "throwing-block.ts"),
      { input: '{"message": "test"}' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("Intentional test error");
    expect(process.exitCode).toBe(1);
  });

  it("reports durationMs in execution metadata", async () => {
    const result = await executeBlockCommand(
      resolve(fixturesDir, "echo-handler.ts"),
      { input: '{"text": "timing"}' },
    );

    expect(typeof result.execution.durationMs).toBe("number");
    expect(result.execution.durationMs).toBeGreaterThanOrEqual(0);
  });
});
