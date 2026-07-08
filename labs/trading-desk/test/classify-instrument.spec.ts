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
import {
  canonicalTickerKey,
  classifyInstrument,
  isOccOptionSymbol,
} from "../src/flows/portfolio/classify-instrument";
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
      markPrice: null,
    });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("classifies an XX fund at ~$1.00 as a money-market cash equivalent", () => {
    const r = classifyInstrument("SPAXX", { price: 1.0 });
    expect(r.assetClass).toBe("cash");
    expect(r.assetType).toBe("money_market");
    expect(r.attributes).toEqual({ kind: "cash_equivalent" });
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
    expect(r.attributes).toEqual({ kind: "cash_equivalent" });
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
      markPrice: null,
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
      markPrice: null,
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

describe("classifyInstrument — carries the statement mark (FIX-773 Slice C)", () => {
  it("stamps markPrice onto an inferred bond when a price is supplied", () => {
    // A bond has no live quote, so the import's carried per-unit mark is the only
    // value it ever gets — it must survive into the attributes.
    const r = classifyInstrument("912828YK0", { price: 98.5 });
    expect(r.assetType).toBe("bond");
    expect(r.attributes).toMatchObject({ kind: "bond", markPrice: 98.5 });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("leaves markPrice null on a bond when no price is supplied", () => {
    const r = classifyInstrument("912828YK0");
    expect(r.attributes).toMatchObject({ kind: "bond", markPrice: null });
  });

  it("rejects a negative or zero mark (OCR/typo) → null, never a negative value", () => {
    expect(classifyInstrument("912828YK0", { price: -98.5 }).attributes).toMatchObject({
      kind: "bond",
      markPrice: null,
    });
    expect(classifyInstrument("912828YK0", { price: 0 }).attributes).toMatchObject({
      kind: "bond",
      markPrice: null,
    });
  });

  it("stamps the mark onto a HINTED bond too", () => {
    const r = classifyInstrument("XYZ", { assetTypeHint: "bond", price: 101.25 });
    expect(r.attributes).toMatchObject({ kind: "bond", markPrice: 101.25 });
  });

  it("isOccOptionSymbol recognizes an OCC option, rejects a plain ticker/CUSIP", () => {
    expect(isOccOptionSymbol("AAPL240621C00190000")).toBe(true);
    expect(isOccOptionSymbol("AAPL  240621C00190000")).toBe(true); // padded form
    expect(isOccOptionSymbol("AAPL")).toBe(false);
    expect(isOccOptionSymbol("912828YK0")).toBe(false); // CUSIP, not an option
  });

  it("stamps markPrice onto an inferred option, keeping its parsed fields", () => {
    const r = classifyInstrument("AAPL240621C00190000", { price: 12.4 });
    expect(r.attributes).toMatchObject({
      kind: "option",
      underlying: "AAPL",
      strike: 190,
      right: "call",
      multiplier: 100,
      markPrice: 12.4,
    });
    expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
  });

  it("does not stamp a mark onto a money_market (it values at par, not a mark)", () => {
    const r = classifyInstrument("SPAXX", { price: 1.0 });
    expect(r.attributes).toEqual({ kind: "cash_equivalent" });
  });
});

describe("classifyInstrument — known bond ETFs (fixed_income, not equity)", () => {
  // A bond ETF trades like a stock (ticker-shaped, live-quoted) but its exposure
  // is fixed income. Symbol shape can't tell BND from AAPL, so a curated set is
  // the signal. The INTENT: a portfolio of bond ETFs must not read as equity —
  // else the allocation split is wrong. assetType stays `etf` so valuation keeps
  // using the live quote (a `bond` type would wrongly value off a statement mark).
  it.each(["BND", "AGG", "TLT", "LQD", "HYG"])(
    "classifies %s as fixed_income / etf",
    (ticker) => {
      const r = classifyInstrument(ticker);
      expect(r).toEqual({
        assetClass: "fixed_income",
        assetType: "etf",
        attributes: { kind: "none" },
      });
      expect(holdingAttributesSchema.safeParse(r.attributes).success).toBe(true);
    },
  );

  // Real portfolio coverage: these are the bond ETFs a QFX-imported bond sleeve
  // held that the first cut of the list missed (high-yield, floating-rate,
  // ultra-short treasury). Regression guard against under-coverage.
  it.each(["USHY", "FLRN", "GBIL", "SHYG", "SJNK", "HYLB", "FLTR"])(
    "classifies %s (previously-missed bond ETF) as fixed_income",
    (ticker) => {
      expect(classifyInstrument(ticker).assetClass).toBe("fixed_income");
    },
  );

  it("normalizes case/whitespace before matching the set", () => {
    expect(classifyInstrument("  bnd ").assetClass).toBe("fixed_income");
  });

  it("leaves a plain equity ticker as equity (control)", () => {
    expect(classifyInstrument("AAPL").assetClass).toBe("equity");
  });

  it("leaves an unknown ETF as equity (curated set is intentionally incomplete)", () => {
    // QQQ is an equity-index ETF, not in the bond set → stays equity, not
    // silently reclassified. The set's failure mode is under-coverage, not noise.
    expect(classifyInstrument("QQQ").assetClass).toBe("equity");
  });

  it("wins over a stale assetType hint (the set is authoritative for its tickers)", () => {
    // A brokerage CSV that labels BND `equity` (or `etf`) must still land
    // fixed_income — the curated set knows the class the hint can't convey.
    expect(
      classifyInstrument("BND", { assetTypeHint: "equity" }).assetClass,
    ).toBe("fixed_income");
    expect(classifyInstrument("BND", { assetTypeHint: "etf" }).assetClass).toBe(
      "fixed_income",
    );
  });
});

describe("classifyInstrument — OCC option date validation (FIX-773 review)", () => {
  it("parses a standard OCC option (valid expiry)", () => {
    const r = classifyInstrument("AAPL240621C00190000");
    expect(r.assetType).toBe("option");
    expect(r.attributes).toMatchObject({ kind: "option", expiry: "2024-06-21", strike: 190 });
  });

  it("rejects an impossible expiry (Feb 31) rather than persisting a bad date", () => {
    // `240231` → 2024-02-31, which `Date` would silently coerce to Mar 2. The
    // parser must fall through (not an option) instead of stamping a bad expiry.
    expect(isOccOptionSymbol("AAPL240231C00190000")).toBe(false);
    const r = classifyInstrument("AAPL240231C00190000");
    expect(r.assetType).not.toBe("option");
  });
});

describe("canonicalTickerKey — OCC dedup key (FIX-773 review)", () => {
  it("collapses the space-padded OCC form to the compact form", () => {
    expect(canonicalTickerKey("AAPL  240621C00190000")).toBe("AAPL240621C00190000");
    expect(canonicalTickerKey("aapl240621c00190000")).toBe("AAPL240621C00190000");
  });

  it("leaves a normal ticker / CUSIP unchanged (trim + upper only)", () => {
    expect(canonicalTickerKey(" nvda ")).toBe("NVDA");
    expect(canonicalTickerKey("912828yk0")).toBe("912828YK0");
  });
});
