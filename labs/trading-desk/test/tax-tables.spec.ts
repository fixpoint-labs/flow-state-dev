/**
 * Unit tests for the 2026 flat bracket lookups (FIX-874, `tax-tables.ts`).
 *
 * Intent encoded: these are FLAT single-bracket lookups — an income in band k
 * returns band k's rate, and a boundary income picks the correct side (`upTo` is
 * inclusive). We assert the LOOKUP LOGIC across representative incomes and the
 * published band ceilings, NOT a precise bracket walk (there is none — stacking
 * is a deliberate Non-Goal, decision 7a).
 */
import { describe, expect, it } from "vitest";
import {
  marginalOrdinaryRate,
  ltcgRate,
  TAX_YEAR,
  TAX_TABLE_SOURCE,
} from "../src/flows/portfolio/tax-tables";

describe("marginalOrdinaryRate", () => {
  it("returns the band's rate for a representative income in each single band", () => {
    expect(marginalOrdinaryRate("single", 5_000)).toBe(0.1);
    expect(marginalOrdinaryRate("single", 30_000)).toBe(0.12);
    expect(marginalOrdinaryRate("single", 80_000)).toBe(0.22);
    expect(marginalOrdinaryRate("single", 150_000)).toBe(0.24);
    expect(marginalOrdinaryRate("single", 230_000)).toBe(0.32);
    expect(marginalOrdinaryRate("single", 400_000)).toBe(0.35);
    expect(marginalOrdinaryRate("single", 1_000_000)).toBe(0.37);
  });

  it("treats the published band ceiling as inclusive and the next dollar as the next band", () => {
    // Single 10% band ends at $12,400; $12,401 is the first 12% dollar.
    expect(marginalOrdinaryRate("single", 12_400)).toBe(0.1);
    expect(marginalOrdinaryRate("single", 12_401)).toBe(0.12);
  });

  it("keys off filing status — mfj/hoh/mfs have their own bands", () => {
    // $22,000 is the 12% band for single/mfs but still the 10% band for mfj.
    expect(marginalOrdinaryRate("single", 22_000)).toBe(0.12);
    expect(marginalOrdinaryRate("mfj", 22_000)).toBe(0.1);
    // hoh's 12% band reaches further than single's.
    expect(marginalOrdinaryRate("hoh", 60_000)).toBe(0.12);
    expect(marginalOrdinaryRate("single", 60_000)).toBe(0.22);
    // mfs tops out at 37% earlier than single (35% ceiling $384,350).
    expect(marginalOrdinaryRate("mfs", 400_000)).toBe(0.37);
    expect(marginalOrdinaryRate("single", 400_000)).toBe(0.35);
  });

  it("floors a zero or negative baseline to the lowest band", () => {
    expect(marginalOrdinaryRate("single", 0)).toBe(0.1);
    expect(marginalOrdinaryRate("single", -100)).toBe(0.1);
  });
});

describe("ltcgRate", () => {
  it("returns 0/15/20 across the LTCG thresholds for each status", () => {
    // Single: 0% up to $49,450, 15% up to $545,500, 20% above.
    expect(ltcgRate("single", 40_000)).toBe(0);
    expect(ltcgRate("single", 200_000)).toBe(0.15);
    expect(ltcgRate("single", 600_000)).toBe(0.2);
    // MFJ 0% band is wider ($98,900), so $80k is still 0%.
    expect(ltcgRate("mfj", 80_000)).toBe(0);
    expect(ltcgRate("single", 80_000)).toBe(0.15);
    // HoH and MFS resolve into their own bands.
    expect(ltcgRate("hoh", 66_200)).toBe(0);
    expect(ltcgRate("hoh", 66_201)).toBe(0.15);
    expect(ltcgRate("mfs", 306_850)).toBe(0.15);
    expect(ltcgRate("mfs", 306_851)).toBe(0.2);
  });

  it("treats the 0% ceiling as inclusive", () => {
    expect(ltcgRate("single", 49_450)).toBe(0);
    expect(ltcgRate("single", 49_451)).toBe(0.15);
  });
});

describe("table metadata", () => {
  it("versions the figures by year and cites the source", () => {
    expect(TAX_YEAR).toBe(2026);
    expect(TAX_TABLE_SOURCE).toBe("Rev. Proc. 2025-32");
  });
});
