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
  CANONICAL_NEXT_STEPS,
  renderNextSteps,
  assertCanonicalNextSteps,
} from "../src";

describe("@flow-state-dev/fsdev", () => {
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

  it("exports the next-steps block, its renderer and its comparison", () => {
    // The package boundary FIX-548's `create-flow-state` reaches through: it embeds
    // CANONICAL_NEXT_STEPS in its own source and calls assertCanonicalNextSteps on that copy
    // from its own test suite. Anything short of a public export leaves it reimplementing the
    // normalization, which is the drift a single owner exists to prevent.
    expect(CANONICAL_NEXT_STEPS).toContain("Next steps");
    expect(typeof renderNextSteps).toBe("function");
    expect(() => assertCanonicalNextSteps(CANONICAL_NEXT_STEPS)).not.toThrow();
  });
});
