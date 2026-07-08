/**
 * Unit tests for the upper-bound tax estimate (FIX-874, `tax-estimate.ts`).
 *
 * Intent encoded: the estimate is a deliberately-rough CEILING, not a filing
 * calculation. The tests pin the load-bearing rules that keep it honest and
 * upper-bound: rate overrides are 0..100 (divided by 100, never applied 22×);
 * every character/income bucket floors at 0 INDIVIDUALLY (a loss or a negative
 * correction contributes 0 and never cancels a differently-charactered gain); a
 * null profile is zeros + a prompt, never a throw; the upper-bound caveat is
 * always present.
 */
import { describe, expect, it } from "vitest";
import { estimateTaxLiability, type TaxEstimateInput } from "../src/flows/portfolio/tax-estimate";
import type { TaxProfileInput } from "../src/flows/portfolio/tax-schema";
import { TAX_YEAR } from "../src/flows/portfolio/tax-tables";

/** A profile with explicit rate overrides, so tests don't depend on lookup values. */
const overrideProfile = (over: Partial<TaxProfileInput> = {}): TaxProfileInput => ({
  filingStatus: "single",
  taxableIncome: null,
  marginalOrdinaryRatePct: 22,
  ltcgRatePct: 15,
  stateRatePct: null,
  ...over,
});

const baseInput = (over: Partial<TaxEstimateInput> = {}): TaxEstimateInput => ({
  profile: overrideProfile(),
  year: TAX_YEAR,
  shortGains: 0,
  longGains: 0,
  dividends: 0,
  interest: 0,
  basisUnknownProceeds: 0,
  basisUnknownCount: 0,
  ...over,
});

describe("estimateTaxLiability — rate overrides", () => {
  it("applies a 22/15 override as 0.22/0.15, not 22×/15×", () => {
    const est = estimateTaxLiability(
      baseInput({ shortGains: 1_000, longGains: 1_000 }),
    );
    expect(est.effectiveOrdinaryRate).toBe(0.22);
    expect(est.effectiveLtcgRate).toBe(0.15);
    // 1000 × 0.22 + 1000 × 0.15 = 370, NOT 1000×22 + 1000×15.
    expect(est.estimatedFederal).toBe(370);
    expect(est.estimatedTotal).toBe(370);
  });
});

describe("estimateTaxLiability — buckets floor at 0 independently", () => {
  it("a net short-term loss contributes 0 ordinary gains and a non-negative estimate", () => {
    const est = estimateTaxLiability(baseInput({ shortGains: -5_000 }));
    expect(est.ordinaryGains).toBe(0);
    expect(est.estimatedFederal).toBe(0);
    expect(est.estimatedTotal).toBeGreaterThanOrEqual(0);
  });

  it("a negative dividend correction does NOT reduce long-gain tax (buckets independent)", () => {
    // longGains 1000 (taxed) + dividends -400 (floored to 0, must not net down).
    const est = estimateTaxLiability(
      baseInput({ longGains: 1_000, dividends: -400 }),
    );
    expect(est.preferentialGains).toBe(1_000);
    expect(est.estimatedFederal).toBe(150); // 1000 × 0.15, not (1000-400)×0.15
  });

  it("a short-term loss does not cancel a long-term gain (no cross-netting)", () => {
    const est = estimateTaxLiability(
      baseInput({ shortGains: -10_000, longGains: 2_000 }),
    );
    expect(est.ordinaryGains).toBe(0);
    expect(est.preferentialGains).toBe(2_000);
    expect(est.estimatedFederal).toBe(300); // only the LT gain is taxed
  });

  it("sums interest into ordinary and dividends into preferential", () => {
    const est = estimateTaxLiability(
      baseInput({ shortGains: 500, interest: 500, longGains: 100, dividends: 100 }),
    );
    expect(est.ordinaryGains).toBe(1_000);
    expect(est.preferentialGains).toBe(200);
  });
});

describe("estimateTaxLiability — null profile", () => {
  it("returns zeros with a set-a-profile assumption and never throws", () => {
    const est = estimateTaxLiability(
      baseInput({ profile: null, shortGains: 9_999, longGains: 9_999 }),
    );
    expect(est.effectiveOrdinaryRate).toBe(0);
    expect(est.effectiveLtcgRate).toBe(0);
    expect(est.estimatedFederal).toBe(0);
    expect(est.estimatedState).toBe(0);
    expect(est.estimatedTotal).toBe(0);
    expect(est.assumptions).toEqual([
      "No tax profile set — enter filing status and income for an estimate.",
    ]);
  });
});

describe("estimateTaxLiability — state rate", () => {
  it("applies the flat state rate to the full gain+income sum", () => {
    const est = estimateTaxLiability(
      baseInput({ shortGains: 1_000, longGains: 1_000, profile: overrideProfile({ stateRatePct: 5 }) }),
    );
    // state = (1000 + 1000) × 0.05 = 100
    expect(est.estimatedState).toBe(100);
    expect(est.estimatedTotal).toBe(est.estimatedFederal + 100);
  });
});

describe("estimateTaxLiability — lookup fallback", () => {
  it("looks up rates from baseline income when no override is given", () => {
    const est = estimateTaxLiability(
      baseInput({
        shortGains: 1_000,
        longGains: 1_000,
        profile: {
          filingStatus: "single",
          taxableIncome: 80_000, // single: 22% ordinary, 15% LTCG
          marginalOrdinaryRatePct: null,
          ltcgRatePct: null,
          stateRatePct: null,
        },
      }),
    );
    expect(est.effectiveOrdinaryRate).toBe(0.22);
    expect(est.effectiveLtcgRate).toBe(0.15);
  });
});

describe("estimateTaxLiability — assumptions & passthrough", () => {
  it("always includes the upper-bound caveat", () => {
    const est = estimateTaxLiability(baseInput());
    expect(est.assumptions.some((a) => a.includes("upper-bound"))).toBe(true);
    expect(est.assumptions.some((a) => a.includes("Not tax advice"))).toBe(true);
  });

  it("adds a brackets note when the run year differs from the table year", () => {
    const est = estimateTaxLiability(baseInput({ year: TAX_YEAR - 1 }));
    expect(est.assumptions.some((a) => a.includes(`Using ${TAX_YEAR} brackets.`))).toBe(true);
  });

  it("does not add the brackets note when the year matches", () => {
    const est = estimateTaxLiability(baseInput({ year: TAX_YEAR }));
    expect(est.assumptions.some((a) => a.includes("brackets."))).toBe(false);
  });

  it("passes basis-unknown honesty fields straight through", () => {
    const est = estimateTaxLiability(
      baseInput({ basisUnknownProceeds: 1_234, basisUnknownCount: 3 }),
    );
    expect(est.basisUnknownProceeds).toBe(1_234);
    expect(est.basisUnknownCount).toBe(3);
    expect(est.year).toBe(TAX_YEAR);
    expect(est.tableSource).toBe("Rev. Proc. 2025-32");
  });
});
