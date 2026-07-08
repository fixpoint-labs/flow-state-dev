/**
 * Unit tests for the pure portfolio CSV parser.
 *
 * These encode the real-money intent, not just behavior: a bad row must be
 * REPORTED (with the right 1-based row number) and never crash an import, a
 * bare `price` column must warn rather than silently assert it is cost, and
 * duplicate lots must collapse to a quantity-weighted average cost (the avg-cost
 * model's load-bearing arithmetic). If any of these stops holding, an import of
 * real holdings would silently corrupt cost basis or drop positions.
 */
import { describe, expect, it } from "vitest";
import { parsePortfolioCsv } from "../src/flows/portfolio/portfolio-csv";

describe("parsePortfolioCsv", () => {
  it("parses the canonical format with zero errors", () => {
    const csv = [
      "ticker,quantity,costBasis,acquiredDate",
      "NVDA,12.5,118.40,2024-03-15",
      "AAPL,40,176.10,2023-11-02",
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    const nvda = result.rows.find((r) => r.ticker === "NVDA");
    expect(nvda).toEqual({
      ticker: "NVDA",
      quantity: 12.5,
      costBasis: 118.4,
      acquiredDate: "2024-03-15",
      // CSV import is equity-only in Slice A (FIX-773); classification is later.
      assetClass: "equity",
      assetType: "equity",
      attributes: { kind: "none" },
    });
  });

  it("maps messy brokerage headers via the synonym table", () => {
    const csv = [
      "Symbol,Shares Held,Avg Cost,Date Acquired",
      "MSFT,10,300.50,2022-01-10",
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      ticker: "MSFT",
      quantity: 10,
      costBasis: 300.5,
    });
    // The mapping is surfaced for the dialog's "Detected columns" preview.
    expect(result.mapping).toMatchObject({
      Symbol: "ticker",
      "Shares Held": "quantity",
      "Avg Cost": "costBasis",
      "Date Acquired": "acquiredDate",
    });
  });

  it("maps a bare `price` column to cost basis WITH a warning (ambiguity gate)", () => {
    const csv = ["symbol,shares,price", "TSLA,5,210.00"].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.rows[0]).toMatchObject({ ticker: "TSLA", costBasis: 210 });
    expect(
      result.warnings.some((w) => w.toLowerCase().includes("price")),
    ).toBe(true);
  });

  it("strips $ and thousands separators from numbers", () => {
    const csv = ["ticker,quantity,costBasis", "BRK.B,1000,\"$1,234.56\""].join(
      "\n",
    );
    const result = parsePortfolioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      ticker: "BRK.B",
      quantity: 1000,
      costBasis: 1234.56,
    });
  });

  it("reports bad rows with the correct 1-based row number, never throwing", () => {
    const csv = [
      "ticker,quantity,costBasis", // row 1 (header)
      "NVDA,12,100", // row 2 — good
      "BADQTY,N/A,50", // row 3 — invalid quantity
      ",10,20", // row 4 — empty ticker
      "ZERO,0,15", // row 5 — zero quantity rejected
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].ticker).toBe("NVDA");
    const reasons = result.errors.map((e) => ({
      rowNumber: e.rowNumber,
      reason: e.reason,
    }));
    expect(reasons).toContainEqual({ rowNumber: 3, reason: "invalid quantity" });
    expect(reasons).toContainEqual({ rowNumber: 4, reason: "invalid ticker" });
    expect(reasons).toContainEqual({ rowNumber: 5, reason: "invalid quantity" });
  });

  it("rejects an unparseable non-empty cost basis as a row error", () => {
    const csv = ["ticker,quantity,costBasis", "AAPL,10,abc"].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toMatchObject({
      rowNumber: 2,
      reason: "invalid cost basis",
    });
  });

  it("merges duplicate tickers with a quantity-weighted average cost + warning", () => {
    // 10 @ 100 and 30 @ 200 → 40 shares, avg = (10*100 + 30*200)/40 = 175.
    const csv = [
      "ticker,quantity,costBasis",
      "NVDA,10,100",
      "NVDA,30,200",
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].quantity).toBe(40);
    expect(result.rows[0].costBasis).toBeCloseTo(175, 6);
    expect(
      result.warnings.some((w) => w.includes("merged") && w.includes("NVDA")),
    ).toBe(true);
  });

  it("treats a bad acquired date as a warning, importing the holding with null date", () => {
    const csv = [
      "ticker,quantity,costBasis,acquiredDate",
      "NVDA,12,100,not-a-date",
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      ticker: "NVDA",
      acquiredDate: null,
    });
    expect(result.warnings.some((w) => w.includes("acquired date"))).toBe(true);
  });

  it("warns (not errors) when the ticker column is unrecognizable", () => {
    const csv = ["foo,bar", "1,2"].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("classifies imported rows by symbol shape (bond CUSIP + crypto pair)", () => {
    // A bond CUSIP and a crypto pair both pass the ticker regex, so they import —
    // and now arrive TYPED, not silently flattened to equity (FIX-773 Slice B).
    const csv = [
      "ticker,quantity",
      "912828YK0,5",
      "BTC-USD,0.25",
      "AAPL,10",
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.errors).toEqual([]);
    const byTicker = new Map(result.rows.map((r) => [r.ticker, r]));
    expect(byTicker.get("912828YK0")).toMatchObject({
      assetType: "bond",
      assetClass: "fixed_income",
      attributes: { kind: "bond", cusip: "912828YK0" },
    });
    expect(byTicker.get("BTC-USD")).toMatchObject({
      assetType: "crypto",
      assetClass: "crypto",
    });
    // A plain equity with no type column infers equity.
    expect(byTicker.get("AAPL")).toMatchObject({
      assetType: "equity",
      assetClass: "equity",
      attributes: { kind: "none" },
    });
  });

  it("accepts an OCC option symbol (which the equity ticker regex rejects)", () => {
    // An OCC symbol is 18–21 chars, so the equity regex rejects it; the importer
    // must still let it through to the classifier (the PDF confirm path serializes
    // option rows through this same gate). markPrice carries the per-contract mark.
    const csv = [
      "ticker,quantity,markPrice",
      "AAPL240621C00190000,2,12.4",
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      assetType: "option",
      assetClass: "equity",
      attributes: { kind: "option", underlying: "AAPL", strike: 190, markPrice: 12.4 },
    });
  });

  it("lets an explicit `type` column override symbol-shape inference", () => {
    // GLD looks like a plain equity by shape; the type column says it's an ETF.
    const csv = ["ticker,quantity,type", "GLD,3,etf"].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      ticker: "GLD",
      assetType: "etf",
      assetClass: "equity",
    });
  });

  it("keeps the classification on a dedupe-merged row", () => {
    // A non-ETF symbol so the explicit `bond` type hint (not the known-bond-ETF
    // set, which would classify a real ETF ticker like VWOB as etf/fixed_income)
    // is what drives the classification through the dedupe merge.
    const csv = [
      "ticker,quantity,type",
      "ZBND,10,bond",
      "ZBND,30,bond",
    ].join("\n");
    const result = parsePortfolioCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      ticker: "ZBND",
      quantity: 40,
      assetType: "bond",
      assetClass: "fixed_income",
      attributes: { kind: "bond", cusip: "ZBND" },
    });
    expect(
      result.warnings.some((w) => w.includes("merged") && w.includes("ZBND")),
    ).toBe(true);
  });
});
