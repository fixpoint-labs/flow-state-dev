import { describe, expect, it } from "vitest";
import {
  EXIT_SUCCESS,
  EXIT_EXECUTION_ERROR,
  EXIT_INVALID_ARGS,
  EXIT_CONFIG_ERROR,
  EXIT_DISCOVERY_ERROR,
  EXIT_SCAFFOLD_ERROR,
  EXIT_INTERNAL_ERROR,
} from "../src/exit-codes";

describe("exit codes", () => {
  it("defines all exit codes per the spec", () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_EXECUTION_ERROR).toBe(1);
    expect(EXIT_INVALID_ARGS).toBe(2);
    expect(EXIT_CONFIG_ERROR).toBe(3);
    expect(EXIT_DISCOVERY_ERROR).toBe(4);
    expect(EXIT_SCAFFOLD_ERROR).toBe(5);
    expect(EXIT_INTERNAL_ERROR).toBe(10);
  });

  it("exit codes are distinct", () => {
    const codes = [
      EXIT_SUCCESS,
      EXIT_EXECUTION_ERROR,
      EXIT_INVALID_ARGS,
      EXIT_CONFIG_ERROR,
      EXIT_DISCOVERY_ERROR,
      EXIT_SCAFFOLD_ERROR,
      EXIT_INTERNAL_ERROR,
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});
