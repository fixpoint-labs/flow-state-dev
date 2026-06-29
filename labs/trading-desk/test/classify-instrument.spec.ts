/**
 * Unit tests for the pure instrument classifier.
 *
 * These encode the real-money intent, not just behavior: an import is a
 * CLASSIFIER, not a filter. Every symbol resolves to a typed asset (an unknown
 * symbol becomes a VISIBLE `other`/`alternative` row, never a dropped position),
 * the priority order is fixed (OCC-option before CUSIP, both contain digits), and
 * an explicit type hint WINS over symbol-shape inference. Every classification
 * must produce a `HoldingAttributes` shape valid against the domain schema — an
 * invalid attributes shape would corrupt the holdings table.
 */
import { describe, expect, it } from "vitest";
import { classifyInstrument } from "../src/flows/portfolio/classify-instrument";
import { holdingAttributesSchema } from "../src/flows/portfolio/portfolio-schema";

describe("classifyInstrument — symbol-shape inference (one case per rule)", () => {
  it("classifies a plain equity ticker", () => {
    const r = classifyInstrument("AAPL");
    expect(r).toEqual({
      assetClass: "equity",
      assetType: "equity",
      attributes: { kind: "none" },
    });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("classifies a crypto USD pair", () => {
    const r = classifyInstrument("BTC-USD");
    expect(r).toEqual({
      assetClass: "crypto",
      assetType: "crypto",
      attributes: { kind: "none" },
    });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("classifies a CUSIP as a bond", () => {
    const r = classifyInstrument("912828YK0");
    expect(r.assetClass).toBe("fixed_income");
    expect(r.assetType).toBe("bond");
    expect(r.attributes).toEqual({
      kind: "bond",
      cusip: "912828YK0",
      coupon: null,
      maturity: null,
      yield: null,
    });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("classifies an XX fund at ~$1.00 as a money-market cash equivalent", () => {
    const r = classifyInstrument("SPAXX", { price: 1.0 });
    expect(r.assetClass).toBe("cash");
    expect(r.assetType).toBe("money_market");
    expect(r.attributes).toEqual({ kind: "cash_equivalent", yield: null });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("falls through to equity for an XX symbol with no price (suffix alone is not enough)", () => {
    const r = classifyInstrument("SPAXX");
    expect(r.assetClass).toBe("equity");
    expect(r.assetType).toBe("equity");
    expect(r.attributes).toEqual({ kind: "none" });
  });

  it("classifies a literal CASH line as a money-market cash equivalent", () => {
    const r = classifyInstrument("CASH");
    expect(r.assetClass).toBe("cash");
    expect(r.assetType).toBe("money_market");
    expect(r.attributes).toEqual({ kind: "cash_equivalent", yield: null });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("classifies an OCC option symbol (space-padded form)", () => {
    const r = classifyInstrument("AAPL  240621C00190000");
    expect(r.assetClass).toBe("equity");
    expect(r.assetType).toBe("option");
    expect(r.attributes).toEqual({
      kind: "option",
      underlying: "AAPL",
      strike: 190,
      expiry: "2024-06-21",
      right: "call",
      multiplier: 100,
    });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("classifies an OCC option symbol (compact form)", () => {
    const r = classifyInstrument("AAPL240621C00190000");
    expect(r.assetType).toBe("option");
    expect(r.attributes).toMatchObject({
      kind: "option",
      underlying: "AAPL",
      strike: 190,
      expiry: "2024-06-21",
      right: "call",
    });
  });

  it("classifies garbage as a visible other/alternative row (never dropped)", () => {
    const r = classifyInstrument("@@@");
    expect(r.assetClass).toBe("alternative");
    expect(r.assetType).toBe("other");
    expect(r.attributes).toEqual({ kind: "none" });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });
});

describe("classifyInstrument — assetTypeHint overrides symbol shape", () => {
  it("treats a plain symbol as a bond when hinted", () => {
    const r = classifyInstrument("XYZ", { assetTypeHint: "bond" });
    expect(r.assetClass).toBe("fixed_income");
    expect(r.assetType).toBe("bond");
    expect(r.attributes).toEqual({
      kind: "bond",
      cusip: "XYZ",
      coupon: null,
      maturity: null,
      yield: null,
    });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("uses a non-structured hint (etf) without forcing attributes", () => {
    const r = classifyInstrument("VOO", { assetTypeHint: "etf" });
    expect(r.assetType).toBe("etf");
    expect(r.assetClass).toBe("equity");
    expect(r.attributes).toEqual({ kind: "none" });
  });

  it("falls back to symbol-shape inference when a hinted option is not OCC-parseable", () => {
    // Hint says option but the symbol can't supply option attributes — never emit
    // an invalid `{ kind: "option" }` without its required fields.
    const r = classifyInstrument("AAPL", { assetTypeHint: "option" });
    expect(r.assetType).toBe("equity");
    expect(r.attributes).toEqual({ kind: "none" });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });
});
