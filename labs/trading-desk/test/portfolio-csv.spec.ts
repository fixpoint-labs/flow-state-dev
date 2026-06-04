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
import { parsePortfolioCsv } from "../src/flows/trading-desk/portfolio/portfolio-csv";

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
});
