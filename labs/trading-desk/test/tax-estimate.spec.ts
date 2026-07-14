/**
 * Unit tests for the upper-bound tax estimate (`estimateTaxLiability`, FIX-874).
 *
 * Intent encoded — the estimate is a deliberate upper bound (OQ #7), so these pin
 * the rules that materially move the number and the real-money honesty gates:
 *   1. Marginal rates apply directly to each bucket (percent → fraction).
 *   2. A net capital LOSS never offsets qualified dividends; excess loss is capped
 *      at $3,000 ($1,500 MFS) against ordinary income + carries forward.
 *   3. Per-bucket income floors: a same-year dividend reversal can't erase a gain.
 *   4. State rate applies to the FULL taxable bucket.
 *   5. A null profile returns zeros, never throws.
 */
import { describe, expect, it } from "vitest";
import { estimateTaxLiability } from "@/domain/portfolio/math/tax-estimate";
import type { TaxProfileInput } from "@/domain/portfolio/schema/tax-schema";

const profile: TaxProfileInput = {
  filingStatus: "single",
  marginalOrdinaryRatePct: 24,
  ltcgRatePct: 15,
  stateRatePct: null,
};

function base(overrides: Partial<Parameters<typeof estimateTaxLiability>[0]> = {}) {
  return estimateTaxLiability({
    profile,
    year: 2026,
    shortGains: 0,
    longGains: 0,
    dividends: 0,
    interest: 0,
    basisUnknownProceeds: 0,
    basisUnknownCount: 0,
    proceedsUnknownCount: 0,
    ...overrides,
  });
}

describe("estimateTaxLiability — upper bound", () => {
  it("applies the marginal ordinary rate to short gains + interest", () => {
    const e = base({ shortGains: 1000, interest: 500 });
    expect(e.ordinaryTaxable).toBe(1500);
    expect(e.estimatedFederal).toBeCloseTo(1500 * 0.24);
    expect(e.estimatedTotal).toBeCloseTo(360);
  });

  it("applies the LTCG rate to long gains + (assumed-qualified) dividends", () => {
    const e = base({ longGains: 2000, dividends: 1000 });
    expect(e.ltcgTaxable).toBe(3000);
    expect(e.estimatedFederal).toBeCloseTo(3000 * 0.15);
  });

  it("treats the rate as a percent (24 → 0.24×), not a multiplier", () => {
    const e = base({ shortGains: 100 });
    expect(e.effectiveOrdinaryRate).toBe(0.24);
    expect(e.estimatedFederal).toBeCloseTo(24);
  });

  it("caps a net capital loss at $3,000 against ordinary income and carries the rest", () => {
    // $50k long loss, no other capital gain, $10k interest.
    const e = base({ longGains: -50000, interest: 10000 });
    expect(e.deductibleLossThisYear).toBe(3000);
    expect(e.lossCarryforward).toBe(47000);
    // Ordinary bucket = max(0, 0 + 10000 − 3000) = 7000.
    expect(e.ordinaryTaxable).toBe(7000);
    expect(e.estimatedTotal).toBeGreaterThanOrEqual(0);
  });

  it("uses the $1,500 cap for MFS", () => {
    const mfs: TaxProfileInput = { ...profile, filingStatus: "mfs" };
    const e = estimateTaxLiability({
      profile: mfs,
      year: 2026,
      shortGains: 0,
      longGains: -10000,
      dividends: 0,
      interest: 5000,
      basisUnknownProceeds: 0,
      basisUnknownCount: 0,
      proceedsUnknownCount: 0,
    });
    expect(e.deductibleLossThisYear).toBe(1500);
  });

  it("never lets a capital loss offset qualified dividends", () => {
    // A big long-term loss + dividends: dividends stay taxed at the LTCG rate.
    const e = base({ longGains: -20000, dividends: 5000 });
    expect(e.ltcgTaxable).toBe(5000);
    expect(e.estimatedFederal).toBeCloseTo(5000 * 0.15);
  });

  it("floors a same-year dividend reversal so it can't erase a long gain", () => {
    // A −$10k dividend correction must not cancel a real $10k LT gain.
    const e = base({ longGains: 10000, dividends: -10000 });
    expect(e.ltcgTaxable).toBe(10000);
  });

  it("cross-nets a short loss into a long gain, keeping the character LT", () => {
    const e = base({ shortGains: -2000, longGains: 5000 });
    expect(e.ordinaryTaxable).toBe(0);
    expect(e.ltcgTaxable).toBe(3000); // 5000 − 2000
  });

  it("applies a flat state rate to the full taxable bucket", () => {
    const withState: TaxProfileInput = { ...profile, stateRatePct: 5 };
    const e = estimateTaxLiability({
      profile: withState,
      year: 2026,
      shortGains: 1000,
      longGains: 2000,
      dividends: 0,
      interest: 0,
      basisUnknownProceeds: 0,
      basisUnknownCount: 0,
      proceedsUnknownCount: 0,
    });
    // ordinary 1000 + ltcg 2000 = 3000 taxable; state = 3000 × 0.05 = 150.
    expect(e.estimatedState).toBeCloseTo(150);
  });

  it("returns zeros and a caveat (never throws) for a null profile", () => {
    const e = estimateTaxLiability({
      profile: null,
      year: 2026,
      shortGains: 5000,
      longGains: 5000,
      dividends: 100,
      interest: 100,
      basisUnknownProceeds: 0,
      basisUnknownCount: 0,
      proceedsUnknownCount: 0,
    });
    expect(e.estimatedTotal).toBe(0);
    expect(e.assumptions[0]).toMatch(/No tax profile/);
  });

  it("surfaces basis-unknown proceeds as an excluded-from-estimate caveat", () => {
    const e = base({ basisUnknownProceeds: 4200, basisUnknownCount: 2 });
    expect(e.assumptions.some((a) => a.includes("2 disposal"))).toBe(true);
    expect(e.assumptions.some((a) => a.includes("$4,200"))).toBe(true);
  });

  it("never reports a proceeds-unknown disposal as ≈ $0 excluded", () => {
    // All excluded disposals have unknown proceeds → no fabricated $0 figure.
    const allUnknown = base({ basisUnknownCount: 2, proceedsUnknownCount: 2 });
    const note = allUnknown.assumptions.find((a) => a.includes("2 disposal"));
    expect(note).toContain("proceeds not yet reported");
    expect(note).not.toContain("$0");

    // Mixed: one priced, one proceeds-unknown → known $ is qualified, not total.
    const mixed = base({
      basisUnknownProceeds: 900,
      basisUnknownCount: 2,
      proceedsUnknownCount: 1,
    });
    const mixedNote = mixed.assumptions.find((a) => a.includes("2 disposal"));
    expect(mixedNote).toContain("$900 known proceeds");
    expect(mixedNote).toContain("1 with proceeds not yet reported");
  });
});
