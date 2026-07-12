/**
 * Tests for the eval statistics (`src/eval/stats.ts`, FIX-790): mean/std, the
 * standard error of a difference, and ordinal-input Krippendorff's alpha —
 * including the single-item degeneracy that omits alpha (spec §4.7).
 */
import { describe, expect, it } from "vitest";
import { krippendorffAlpha, meanStd, standardError } from "../src/eval/stats";

describe("meanStd", () => {
  it("is zero-std for a constant sample", () => {
    expect(meanStd([1, 1, 1])).toEqual({ mean: 1, std: 0 });
  });
  it("uses the n−1 sample denominator", () => {
    const { mean, std } = meanStd([2, 4]);
    expect(mean).toBe(3);
    expect(std).toBeCloseTo(Math.SQRT2, 6);
  });
  it("is zero-std for a single value", () => {
    expect(meanStd([0.7])).toEqual({ mean: 0.7, std: 0 });
  });
});

describe("standardError", () => {
  it("is std / √n (the 2·SE noise band's basis)", () => {
    // std([1,2,3]) = 1, SE = 1/√3.
    expect(standardError([1, 2, 3])).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect(standardError([5])).toBe(0);
  });
});

describe("krippendorffAlpha", () => {
  it("returns null for a single usable item (degenerate denominator)", () => {
    expect(krippendorffAlpha([[1, 0]])).toBeNull();
    // Units with a single rating each contribute no within-unit pair → null.
    expect(krippendorffAlpha([[1], [0]])).toBeNull();
  });

  it("is 1 when every rater agrees within every unit", () => {
    expect(krippendorffAlpha([[1, 1, 1], [0, 0, 0]])).toBe(1);
  });

  it("is 1 when there is no variance at all", () => {
    expect(krippendorffAlpha([[0.5, 0.5], [0.5, 0.5]])).toBe(1);
  });

  it("is negative when raters systematically disagree within units", () => {
    // Each unit's raters split {1,0}; known alpha = −0.5.
    expect(krippendorffAlpha([[1, 0], [1, 0]])).toBeCloseTo(-0.5, 6);
  });
});
