import { describe, expect, it } from "vitest";
import { program, resolveBlock, parseInputArg, formatOutput, EXIT_SUCCESS, EXIT_EXECUTION_ERROR, EXIT_INVALID_ARGS } from "../src";

describe("@flow-state-dev/cli", () => {
  it("exports the commander program", () => {
    expect(program).toBeDefined();
    expect(program.name()).toBe("fsdev");
  });

  it("exports shared infrastructure", () => {
    expect(typeof resolveBlock).toBe("function");
    expect(typeof parseInputArg).toBe("function");
    expect(typeof formatOutput).toBe("function");
  });

  it("exports exit codes", () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_EXECUTION_ERROR).toBe(1);
    expect(EXIT_INVALID_ARGS).toBe(2);
  });
});
