/**
 * Unit tests for the scenario-derived reward-to-risk metric (FIX-752).
 *
 * Pure-math seam (the `valuation-spine.spec.ts` shape): synthetic scenario
 * distributions exercise the gain/loss ratio, the loss-aversion scaling, and the
 * honest edge cases (no downside, all loss, empty, thin evidence).
 */
import { describe, expect, it } from "vitest";
import { computeRewardToRisk } from "../src/flows/analysis/lib/reward-to-risk";

describe("computeRewardToRisk", () => {
  it("computes EV / gain / loss / GLR over a mixed distribution", () => {
    const r = computeRewardToRisk({
      scenarios: [
        { probability: 0.5, expectedReturnPct: 20 },
        { probability: 0.3, expectedReturnPct: -10 },
        { probability: 0.2, expectedReturnPct: 0 },
      ],
      lossAversion: 2,
    });
    expect(r.expectedValuePct).toBeCloseTo(7, 6); // 10 - 3 + 0
    expect(r.expectedGainPct).toBeCloseTo(10, 6);
    expect(r.expectedLossPct).toBeCloseTo(3, 6);
    expect(r.glr).toBeCloseTo(10 / 3, 6);
    expect(r.lossAdjustedGlr).toBeCloseTo(10 / 6, 6); // λ=2 doubles the loss term
    expect(r.worstCaseReturnPct).toBe(-10);
    expect(r.probGain).toBeCloseTo(0.5, 6);
    expect(r.noDownside).toBe(false);
    expect(r.evidenceBasis).toBe("sufficient");
  });

  it("λ scales only the loss side", () => {
    const dist = [
      { probability: 0.5, expectedReturnPct: 20 },
      { probability: 0.3, expectedReturnPct: -10 },
      { probability: 0.2, expectedReturnPct: 0 },
    ];
    const neutral = computeRewardToRisk({ scenarios: dist, lossAversion: 1 });
    const cautious = computeRewardToRisk({ scenarios: dist, lossAversion: 2.5 });
    expect(neutral.lossAdjustedGlr).toBeCloseTo(10 / 3, 6); // λ=1 collapses to GLR
    expect(neutral.glr).toBeCloseTo(neutral.lossAdjustedGlr!, 6);
    expect(cautious.lossAdjustedGlr).toBeCloseTo(10 / (2.5 * 3), 6);
    expect(cautious.glr).toBeCloseTo(10 / 3, 6); // raw GLR is λ-independent
  });

  it("flags no-downside distributions (GLR undefined, floor treated as cleared)", () => {
    const r = computeRewardToRisk({
      scenarios: [
        { probability: 0.6, expectedReturnPct: 10 },
        { probability: 0.4, expectedReturnPct: 5 },
      ],
      lossAversion: 2,
    });
    expect(r.noDownside).toBe(true);
    expect(r.glr).toBeNull();
    expect(r.lossAdjustedGlr).toBeNull();
    expect(r.expectedLossPct).toBe(0);
    expect(r.expectedValuePct).toBeCloseTo(8, 6);
    expect(r.worstCaseReturnPct).toBe(5);
    expect(r.evidenceBasis).toBe("thin"); // < 3 buckets
  });

  it("returns GLR 0 for an all-loss distribution", () => {
    const r = computeRewardToRisk({
      scenarios: [
        { probability: 0.5, expectedReturnPct: -10 },
        { probability: 0.3, expectedReturnPct: -5 },
        { probability: 0.2, expectedReturnPct: -20 },
      ],
      lossAversion: 2,
    });
    expect(r.noDownside).toBe(false);
    expect(r.glr).toBe(0);
    expect(r.lossAdjustedGlr).toBe(0);
    expect(r.expectedLossPct).toBeCloseTo(10.5, 6);
    expect(r.worstCaseReturnPct).toBe(-20);
    expect(r.probGain).toBe(0);
  });

  it("degrades to all-null / thin on an empty distribution", () => {
    const r = computeRewardToRisk({ scenarios: [], lossAversion: 2 });
    expect(r.expectedValuePct).toBeNull();
    expect(r.glr).toBeNull();
    expect(r.lossAdjustedGlr).toBeNull();
    expect(r.worstCaseReturnPct).toBeNull();
    expect(r.probGain).toBeNull();
    expect(r.noDownside).toBe(false);
    expect(r.evidenceBasis).toBe("thin");
  });

  it("marks thin evidence when fewer than three buckets", () => {
    const r = computeRewardToRisk({
      scenarios: [
        { probability: 0.6, expectedReturnPct: 12 },
        { probability: 0.4, expectedReturnPct: -8 },
      ],
      lossAversion: 2,
    });
    expect(r.evidenceBasis).toBe("thin");
    expect(r.glr).toBeCloseTo((0.6 * 12) / (0.4 * 8), 6);
  });

  it("treats a non-positive λ as 1 (well-defined ratio)", () => {
    const dist = [
      { probability: 0.5, expectedReturnPct: 20 },
      { probability: 0.5, expectedReturnPct: -10 },
    ];
    const r = computeRewardToRisk({ scenarios: dist, lossAversion: 0 });
    expect(r.lossAdjustedGlr).toBeCloseTo(r.glr!, 6);
  });
});
