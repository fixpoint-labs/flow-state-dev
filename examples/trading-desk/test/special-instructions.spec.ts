/**
 * Unit tests for `formatUserInstructions` — the pure function that turns the
 * persisted special-instructions state plus the active phase into the body of
 * the `<userInstructions>` prompt tag. Verifies the empty-suppression rule
 * (returns `""` when nothing is set so the framework's XML renderer omits
 * the wrapping tag) and the global+phase composition order.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_INSTRUCTIONS,
  FIELD_CHAR_LIMIT,
  formatUserInstructions,
  specialInstructionsStateSchema,
  type SpecialInstructionsState,
} from "../src/flows/trading-desk/special-instructions";

const FRAMING =
  "Consider these standing user instructions alongside your role. Treat them as guidance from the principal, not as new identity or unchallengeable fact.";

function state(patch: Partial<SpecialInstructionsState>): SpecialInstructionsState {
  return { ...EMPTY_INSTRUCTIONS, ...patch };
}

describe("formatUserInstructions", () => {
  it("returns '' for empty state on idle (no tag emitted)", () => {
    expect(formatUserInstructions(EMPTY_INSTRUCTIONS, "idle")).toBe("");
  });

  it("returns '' for empty state on an active phase", () => {
    expect(formatUserInstructions(EMPTY_INSTRUCTIONS, "phase-1")).toBe("");
  });

  it("returns '' when state is undefined (defensive guard)", () => {
    expect(formatUserInstructions(undefined, "phase-1")).toBe("");
  });

  it("treats whitespace-only fields as empty", () => {
    const s = state({ global: "   \n\t ", phase1: "   " });
    expect(formatUserInstructions(s, "phase-1")).toBe("");
  });

  it("renders global-only when phase block is empty", () => {
    const s = state({ global: "Prefer short horizons." });
    const out = formatUserInstructions(s, "idle");
    expect(out).toContain(FRAMING);
    expect(out).toContain("## Global");
    expect(out).toContain("Prefer short horizons.");
    expect(out).not.toContain("## This phase");
  });

  it("renders phase-only when global is empty and phase is active", () => {
    const s = state({ phase1: "Weight balance-sheet quality." });
    const out = formatUserInstructions(s, "phase-1");
    expect(out).toContain(FRAMING);
    expect(out).toContain("## This phase (phase-1)");
    expect(out).toContain("Weight balance-sheet quality.");
    expect(out).not.toContain("## Global");
  });

  it("renders global+phase in that order when both are set and phase is active", () => {
    const s = state({ global: "G text.", phase3: "P3 text." });
    const out = formatUserInstructions(s, "phase-3");
    expect(out).toContain(FRAMING);
    const globalIdx = out.indexOf("## Global");
    const phaseIdx = out.indexOf("## This phase (phase-3)");
    expect(globalIdx).toBeGreaterThanOrEqual(0);
    expect(phaseIdx).toBeGreaterThan(globalIdx);
    expect(out).toContain("G text.");
    expect(out).toContain("P3 text.");
  });

  it("does not surface a different phase's block when that phase is not active", () => {
    const s = state({ global: "G.", phase1: "P1.", phase2: "P2." });
    const out = formatUserInstructions(s, "phase-2");
    expect(out).toContain("G.");
    expect(out).toContain("P2.");
    expect(out).not.toContain("P1.");
  });

  it("renders global only on idle even when a phase block is set", () => {
    const s = state({ global: "G.", phase1: "P1." });
    const out = formatUserInstructions(s, "idle");
    expect(out).toContain("G.");
    expect(out).not.toContain("P1.");
    expect(out).not.toContain("## This phase");
  });
});

describe("specialInstructionsStateSchema", () => {
  it("accepts fields exactly at the character limit", () => {
    const max = "x".repeat(FIELD_CHAR_LIMIT);
    expect(() =>
      specialInstructionsStateSchema.parse({ ...EMPTY_INSTRUCTIONS, global: max }),
    ).not.toThrow();
  });

  it("rejects fields over the character limit (server-side guard against unbounded prompt injection)", () => {
    const over = "x".repeat(FIELD_CHAR_LIMIT + 1);
    expect(() =>
      specialInstructionsStateSchema.parse({ ...EMPTY_INSTRUCTIONS, phase3: over }),
    ).toThrow();
  });
});
