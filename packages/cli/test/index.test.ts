import { describe, expect, it } from "vitest";
import {
  program,
  resolveBlock,
  parseInputArg,
  formatOutput,
  EXIT_SUCCESS,
  EXIT_EXECUTION_ERROR,
  EXIT_INVALID_ARGS,
  EXIT_CONFIG_ERROR,
  EXIT_DISCOVERY_ERROR,
  EXIT_SCAFFOLD_ERROR,
  EXIT_INTERNAL_ERROR,
} from "../src";

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

  it("exports all exit codes with correct values", () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_EXECUTION_ERROR).toBe(1);
    expect(EXIT_INVALID_ARGS).toBe(2);
    expect(EXIT_CONFIG_ERROR).toBe(3);
    expect(EXIT_DISCOVERY_ERROR).toBe(4);
    expect(EXIT_SCAFFOLD_ERROR).toBe(5);
    expect(EXIT_INTERNAL_ERROR).toBe(10);
  });
});
