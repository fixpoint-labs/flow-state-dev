/**
 * Deterministic lens-convergence math — the FIX-655 honesty guarantee under
 * test. These are INTENT-ENCODING tests (BP-005): the classification
 * boundaries, the netLean sign, the majority-stance tie-break, and the
 * dissenter list are business rules, so a test must change if the rule changes.
 *
 * `computeConvergence` is pure (no runtime), so it is tested directly on
 * hand-built verdict records. The convergence resource is written by the
 * `computeAndStoreConvergence` tap, which delegates the math to this function;
 * the tap's resource read/write is exercised by the phase-2b wiring in the flow
 * e2e, not here — here we lock the arithmetic.
 */
import { describe, expect, it } from "vitest";
import { computeConvergence } from "../flows/analysis/agents/lenses/convergence-math";
import { LENS_PACK } from "../flows/analysis/agents/lenses/lenses";
import { LENS_IDS } from "../flows/analysis/registry";
import type { LensVerdictRecord } from "../flows/analysis/agents/lenses/lens-convergence-resource";

/** Minimal verdict record builder — only the fields the math reads matter. */
function verdict(
  lensId: string,
  stance: "bullish" | "neutral" | "bearish",
  conviction: number,
): LensVerdictRecord {
  return {
    lensId,
    label: lensId,
    attribution: "",
    glyph: "",
    stance,
    conviction,
    verdict: "",
    keyDriver: "",
    dataGap: "",
    missingData: [],
  };
}

describe("computeConvergence — classification boundaries", () => {
  it("4/4 on one stance → convergent (agreementScore 1.0 ≥ 0.8)", () => {
    const out = computeConvergence([
      verdict("a", "bullish", 0.8),
      verdict("b", "bullish", 0.6),
      verdict("c", "bullish", 0.7),
      verdict("d", "bullish", 0.5),
    ]);
    expect(out.agreementScore).toBe(1);
    expect(out.classification).toBe("convergent");
    expect(out.majorityStance).toBe("bullish");
    expect(out.dissenters).toEqual([]);
    expect(out.netLean).toBeGreaterThan(0);
  });

  it("3/4 on one stance → mixed at exactly 0.75 (< 0.8, ≥ 0.5)", () => {
    const out = computeConvergence([
      verdict("a", "bullish", 0.8),
      verdict("b", "bullish", 0.6),
      verdict("c", "bullish", 0.7),
      verdict("d", "bearish", 0.9),
    ]);
    expect(out.agreementScore).toBe(0.75);
    expect(out.classification).toBe("mixed");
    expect(out.majorityStance).toBe("bullish");
    expect(out.dissenters).toEqual(["d"]);
  });

  it("agreementScore exactly 0.8 → convergent (≥ 0.8 is inclusive)", () => {
    // 4 of 5 agree → 0.8 exactly.
    const out = computeConvergence([
      verdict("a", "bullish", 0.5),
      verdict("b", "bullish", 0.5),
      verdict("c", "bullish", 0.5),
      verdict("d", "bullish", 0.5),
      verdict("e", "bearish", 0.5),
    ]);
    expect(out.agreementScore).toBeCloseTo(0.8);
    expect(out.classification).toBe("convergent");
  });

  it("agreementScore exactly 0.5 → mixed (≥ 0.5 is inclusive, not divergent)", () => {
    // 2 of 4 agree on bullish → 0.5 exactly.
    const out = computeConvergence([
      verdict("a", "bullish", 0.5),
      verdict("b", "bullish", 0.5),
      verdict("c", "bearish", 0.5),
      verdict("d", "neutral", 0.5),
    ]);
    expect(out.agreementScore).toBe(0.5);
    expect(out.classification).toBe("mixed");
  });

  it("evenly split 2 bull / 2 bear → divergent via the tie-break", () => {
    // counts: bullish 2, bearish 2, neutral 0 → tie → majorityStance neutral →
    // agreementScore = neutral count / N = 0 / 4 = 0 → divergent.
    const out = computeConvergence([
      verdict("a", "bullish", 0.7),
      verdict("b", "bullish", 0.6),
      verdict("c", "bearish", 0.7),
      verdict("d", "bearish", 0.6),
    ]);
    expect(out.majorityStance).toBe("neutral"); // tie → neutral
    expect(out.agreementScore).toBe(0);
    expect(out.classification).toBe("divergent");
    // netLean ≈ (0.7+0.6 − 0.7 − 0.6)/4 = 0
    expect(out.netLean).toBeCloseTo(0);
  });
});

describe("computeConvergence — netLean sign", () => {
  it("bullish-leaning verdicts give a positive netLean", () => {
    const out = computeConvergence([
      verdict("a", "bullish", 0.9),
      verdict("b", "bullish", 0.8),
      verdict("c", "neutral", 0.5),
      verdict("d", "bearish", 0.2),
    ]);
    // (0.9 + 0.8 + 0 − 0.2) / 4 = 0.375
    expect(out.netLean).toBeCloseTo(0.375);
    expect(out.netLean).toBeGreaterThan(0);
  });

  it("bearish-leaning verdicts give a negative netLean", () => {
    const out = computeConvergence([
      verdict("a", "bearish", 0.9),
      verdict("b", "bearish", 0.8),
      verdict("c", "neutral", 0.5),
      verdict("d", "bullish", 0.2),
    ]);
    // (−0.9 − 0.8 + 0 + 0.2) / 4 = −0.375
    expect(out.netLean).toBeCloseTo(-0.375);
    expect(out.netLean).toBeLessThan(0);
  });
});

describe("computeConvergence — majorityStance ties + dissenters", () => {
  it("a clear modal stance wins and lists the dissenters", () => {
    const out = computeConvergence([
      verdict("a", "bearish", 0.8),
      verdict("b", "bearish", 0.7),
      verdict("c", "bearish", 0.6),
      verdict("d", "bullish", 0.9),
    ]);
    expect(out.majorityStance).toBe("bearish");
    expect(out.dissenters).toEqual(["d"]);
  });

  it("a three-way tie resolves to neutral (never invents a direction)", () => {
    const out = computeConvergence([
      verdict("a", "bullish", 0.5),
      verdict("b", "bearish", 0.5),
      verdict("c", "neutral", 0.5),
    ]);
    expect(out.majorityStance).toBe("neutral");
    // dissenters are the non-neutral lenses.
    expect(out.dissenters.sort()).toEqual(["a", "b"]);
  });

  it("zero verdicts (all lenses errored) → neutral/divergent shell, no throw", () => {
    const out = computeConvergence([]);
    expect(out.verdicts).toEqual([]);
    expect(out.classification).toBe("divergent");
    expect(out.majorityStance).toBe("neutral");
    expect(out.netLean).toBe(0);
    expect(out.agreementScore).toBe(0);
    expect(out.dissenters).toEqual([]);
  });
});

describe("lens pack wiring", () => {
  it("LENS_PACK ids exactly match LENS_IDS (same order)", () => {
    expect(LENS_PACK.map((l) => l.id)).toEqual([...LENS_IDS]);
  });

  it("the v1 pack is exactly the 4 ruled lenses (no deep-value / GARP)", () => {
    expect(LENS_PACK).toHaveLength(4);
    expect(LENS_PACK.map((l) => l.id)).toEqual([
      "quality-value",
      "cycle-risk",
      "macro-reflexive",
      "forensic-skeptic",
    ]);
  });
});
