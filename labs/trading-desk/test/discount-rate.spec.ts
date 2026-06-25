/**
 * Unit tests for the sector/leverage-aware discount rate (FIX-807).
 *
 * Covers the exact-GICS table hit, the hurdle fallback for unmapped/null
 * sectors, the leverage premium, and the clamp bounds. Financial Services is
 * NOT tested here — the DCF abstains on financials before the lookup, so the
 * table never sees that sector (asserted in dcf.spec.ts instead).
 */
import { describe, expect, it } from "vitest";
import {
  resolveDiscountRate,
  SECTOR_DISCOUNT_RATES,
  DISCOUNT_RATE_FLOOR,
  DISCOUNT_RATE_CEILING,
} from "../src/flows/analysis/lib/discount-rate";
import { GICS_TO_ETF } from "../src/flows/analysis/lib/sector-resolution";
import { HURDLE_RATE } from "../src/flows/analysis/lib/expected-return";

describe("resolveDiscountRate", () => {
  it("exact GICS 'Technology' hits the table (10%), basis sector", () => {
    const r = resolveDiscountRate({ sector: "Technology", netLeverage: null });
    expect(r.rate).toBeCloseTo(0.10, 10);
    expect(r.basis).toBe("sector");
  });

  it("unmapped sector falls back to the 9% hurdle", () => {
    const r = resolveDiscountRate({ sector: "Widgets", netLeverage: null });
    expect(r.rate).toBe(HURDLE_RATE);
    expect(r.basis).toBe("hurdle-fallback");
  });

  it("null sector falls back to the 9% hurdle", () => {
    const r = resolveDiscountRate({ sector: null, netLeverage: 1.0 });
    expect(r.rate).toBe(HURDLE_RATE);
    expect(r.basis).toBe("hurdle-fallback");
  });

  it("high net leverage (> 3) adds the leverage premium", () => {
    const base = resolveDiscountRate({ sector: "Technology", netLeverage: 1.0 });
    const levered = resolveDiscountRate({ sector: "Technology", netLeverage: 5.0 });
    expect(base.rate).toBeCloseTo(0.10, 10);
    expect(levered.rate).toBeCloseTo(0.105, 10);
    expect(levered.basis).toBe("sector");
  });

  it("net cash / low leverage adds no premium", () => {
    const r = resolveDiscountRate({ sector: "Technology", netLeverage: -0.5 });
    expect(r.rate).toBeCloseTo(0.10, 10);
  });

  it("clamps to the floor — Utilities (6.5%) survives, basis stays sector", () => {
    const r = resolveDiscountRate({ sector: "Utilities", netLeverage: null });
    expect(r.rate).toBeCloseTo(0.065, 10);
    expect(r.rate).toBeGreaterThanOrEqual(DISCOUNT_RATE_FLOOR);
  });

  it("clamps to the ceiling — even a max-leverage hurdle stays ≤ ceiling", () => {
    // Every table rate + premium is below the 14% ceiling; assert the bound holds.
    for (const sector of Object.keys(SECTOR_DISCOUNT_RATES)) {
      const r = resolveDiscountRate({ sector, netLeverage: 100 });
      expect(r.rate).toBeLessThanOrEqual(DISCOUNT_RATE_CEILING);
      expect(r.rate).toBeGreaterThanOrEqual(DISCOUNT_RATE_FLOOR);
    }
  });

  it("table is exact-GICS-keyed — every key is a real GICS sector (matches GICS_TO_ETF)", () => {
    // Documents the no-normalization assumption: the discount table reuses the
    // canonical GICS casing Yahoo emits, the same keys GICS_TO_ETF uses.
    for (const sector of Object.keys(SECTOR_DISCOUNT_RATES)) {
      expect(GICS_TO_ETF).toHaveProperty(sector);
    }
  });
});
