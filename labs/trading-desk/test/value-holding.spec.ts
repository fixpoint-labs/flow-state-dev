/**
 * Unit tests for `resolveHoldingPrice` + `holdingMarketValue` — the ONE place the
 * per-type valuation rule lives (FIX-773 Slice C), shared by the holdings table
 * and the analysis-context builder.
 *
 * These encode the real-money intent: a majority-bond/MMF book values honestly
 * (bonds at their carried statement mark, cash/MMF at par $1.00, equity via live
 * quote) and NEVER fabricates a price — a type with no resolvable price → null
 * value → the "—" gate downstream.
 */
import { describe, expect, it } from "vitest";
import {
  resolveHoldingPrice,
  holdingMarketValue,
  holdingUnrealizedPL,
} from "../src/flows/portfolio/value-holding";
import type { Holding } from "../src/flows/portfolio/portfolio-schema";

function holding(over: Partial<Holding> = {}): Holding {
  return {
    ticker: "NVDA",
    quantity: 10,
    costBasis: 100,
    acquiredDate: null,
    assetClass: "equity",
    assetType: "equity",
    attributes: { kind: "none" },
    dataQuality: null,
    ...over,
  };
}

describe("resolveHoldingPrice — per-type valuation rule", () => {
  it("values equity/etf/mutual_fund/crypto via the live quote", () => {
    for (const assetType of ["equity", "etf", "mutual_fund", "crypto"] as const) {
      const r = resolveHoldingPrice(holding({ assetType }), { price: 200 });
      // No `asOf` on the quote → `asOf: null`, but still quote-sourced.
      expect(r).toEqual({ price: 200, priceSource: "quote", asOf: null });
    }
  });

  it("threads the quote's own as-of onto a quote-sourced price (FIX-823 per-holding staleness)", () => {
    const r = resolveHoldingPrice(holding(), { price: 200, asOf: "2026-07-08T00:00:00.000Z" });
    expect(r).toEqual({ price: 200, priceSource: "quote", asOf: "2026-07-08T00:00:00.000Z" });
  });

  it("degrades equity to unavailable when there is no quote", () => {
    expect(resolveHoldingPrice(holding(), undefined)).toEqual({
      price: null,
      priceSource: "unavailable",
      asOf: null,
    });
    expect(resolveHoldingPrice(holding(), { price: null })).toEqual({
      price: null,
      priceSource: "unavailable",
      asOf: null,
    });
  });

  it("values a money_market at par $1.00 regardless of quote (par is timeless → asOf null)", () => {
    const h = holding({
      assetType: "money_market",
      assetClass: "cash",
      attributes: { kind: "cash_equivalent" },
    });
    expect(resolveHoldingPrice(h, undefined)).toEqual({ price: 1, priceSource: "par", asOf: null });
  });

  it("values any cash-class holding at par", () => {
    const h = holding({ assetType: "other", assetClass: "cash", attributes: { kind: "none" } });
    expect(resolveHoldingPrice(h, undefined)).toEqual({ price: 1, priceSource: "par", asOf: null });
  });

  it("values a bond at its carried statement mark (bare mark → asOf null in v1)", () => {
    const h = holding({
      assetType: "bond",
      assetClass: "fixed_income",
      attributes: { kind: "bond", cusip: "X", markPrice: 98.5 },
    });
    expect(resolveHoldingPrice(h, undefined)).toEqual({
      price: 98.5,
      priceSource: "statement",
      asOf: null,
    });
  });

  it("degrades an unpriced bond to unavailable (no fabricated price)", () => {
    const h = holding({
      assetType: "bond",
      assetClass: "fixed_income",
      attributes: { kind: "bond", cusip: "X", markPrice: null },
    });
    expect(resolveHoldingPrice(h, undefined)).toEqual({
      price: null,
      priceSource: "unavailable",
      asOf: null,
    });
  });

  it("values an option at its carried mark", () => {
    const h = holding({
      assetType: "option",
      assetClass: "equity",
      attributes: { kind: "option", underlying: "AAPL", strike: 190, expiry: "2026-06-21", right: "call", multiplier: 100, markPrice: 12.4 },
    });
    expect(resolveHoldingPrice(h, undefined)).toEqual({
      price: 12.4,
      priceSource: "statement",
      asOf: null,
    });
  });

  it("values `other` as unavailable", () => {
    const h = holding({ assetType: "other", assetClass: "alternative", attributes: { kind: "none" } });
    expect(resolveHoldingPrice(h, { price: 50 })).toEqual({
      price: null,
      priceSource: "unavailable",
      asOf: null,
    });
  });
});

describe("holdingMarketValue — type-resolved value (uniform quantity × price)", () => {
  it("equity value = quantity × price", () => {
    expect(holdingMarketValue(holding({ quantity: 10 }), { price: 200 })).toBe(2000);
  });

  it("money_market value = quantity × par", () => {
    const h = holding({ quantity: 1500, assetType: "money_market", assetClass: "cash", attributes: { kind: "cash_equivalent" } });
    expect(holdingMarketValue(h, undefined)).toBe(1500);
  });

  it("bond value = quantity × mark", () => {
    const h = holding({ quantity: 5, assetType: "bond", assetClass: "fixed_income", attributes: { kind: "bond", cusip: "X", markPrice: 98.5 } });
    expect(holdingMarketValue(h, undefined)).toBe(492.5);
  });

  it("option value = quantity × mark (mark is the per-unit statement value; multiplier is descriptive, never re-applied)", () => {
    const h = holding({ quantity: 2, assetType: "option", assetClass: "equity", attributes: { kind: "option", underlying: "AAPL", strike: 190, expiry: "2026-06-21", right: "call", multiplier: 100, markPrice: 12.4 } });
    // 2 × 12.4 = 24.8 — the mark is ALREADY the per-contract value, so we do NOT
    // multiply by the 100 contract multiplier again (it is baked into the mark).
    expect(holdingMarketValue(h, undefined)).toBe(24.8);
  });

  it("null price → null value (the real-money gate)", () => {
    expect(holdingMarketValue(holding(), undefined)).toBeNull();
  });
});

describe("holdingUnrealizedPL — type-aware P/L", () => {
  it("equity uP/L = (price − cost) × quantity", () => {
    const h = holding({ quantity: 10, costBasis: 100 });
    expect(holdingUnrealizedPL(h, { price: 120 })).toBe(200);
  });

  it("option uP/L = (mark − cost) × quantity, consistent with its value (no multiplier re-applied)", () => {
    const h = holding({
      quantity: 2,
      costBasis: 5.2,
      assetType: "option",
      assetClass: "equity",
      attributes: { kind: "option", underlying: "AAPL", strike: 190, expiry: "2026-06-21", right: "call", multiplier: 100, markPrice: 12.4 },
    });
    // (12.4 − 5.2) × 2 = 14.4 — the mark and the cost basis are both per-unit
    // statement values, so uP/L never re-applies the contract multiplier (it stays
    // consistent with holdingMarketValue's quantity × mark).
    expect(holdingUnrealizedPL(h, undefined)).toBeCloseTo(14.4, 6);
  });

  it("null cost basis → null uP/L (never fabricated)", () => {
    const h = holding({ costBasis: null });
    expect(holdingUnrealizedPL(h, { price: 120 })).toBeNull();
  });
});
