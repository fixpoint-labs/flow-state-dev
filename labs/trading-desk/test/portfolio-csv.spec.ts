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
import { parsePortfolioCsv } from "../domain/portfolio/parsers/portfolio-csv";

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

  it("soft-warns when a tax-lot CSV is mis-uploaded here, pointing at Import transactions (FIX-895)", () => {
    // A tax-lot unrealized export (per-lot total costBasis + unitCost + openDate)
    // would have its lot total misread as a per-share holding cost. The parser
    // must warn and redirect, never silently reinterpret it.
    const csv = ["symbol,quantity,costBasis,unitCost,openDate", "AAPL,10,1500,150,2026-01-10"].join(
      "\n",
    );
    const result = parsePortfolioCsv(csv);
    expect(
      result.warnings.some(
        (w) => /tax-lot/i.test(w) && /import transactions/i.test(w),
      ),
    ).toBe(true);
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

describe("parsePortfolioCsv — FIX-773 review fixes", () => {
  it("detects a money-market fund from a plain price column (no markPrice column)", () => {
    // A raw brokerage export: SPAXX at $1.00 in the standard `price` column (which
    // maps to costBasis). With no `markPrice` column, the ~$1.00 must still drive
    // money-market detection so the row values at par and joins the cash guard —
    // not stored as equity and sent through the live-quote path.
    const csv = "ticker,quantity,price\nSPAXX,1500,1.00";
    const { rows } = parsePortfolioCsv(csv);
    const spaxx = rows.find((r) => r.ticker === "SPAXX");
    expect(spaxx?.assetClass).toBe("cash");
    expect(spaxx?.assetType).toBe("money_market");
    expect(spaxx?.attributes).toEqual({ kind: "cash_equivalent" });
  });

  it("never stores a bond's cost basis as its carried mark", () => {
    // A bond CUSIP with a cost column but no markPrice column: the cost must NOT
    // masquerade as a current mark (the mark stays null → the row shows "—").
    const csv = "ticker,quantity,costBasis\n912828YK0,10,98.5";
    const { rows } = parsePortfolioCsv(csv);
    const bond = rows.find((r) => r.ticker === "912828YK0");
    expect(bond?.assetType).toBe("bond");
    expect(bond?.attributes).toMatchObject({ kind: "bond", markPrice: null });
    expect(bond?.costBasis).toBe(98.5);
  });

  it("keys an OCC option to one holding across compact and space-padded spellings", () => {
    // The SAME contract in both spellings must merge to one holding, or NAV and
    // position counts double-count it.
    const csv =
      "ticker,quantity,markPrice\n" +
      "AAPL240621C00190000,2,12.40\n" +
      "AAPL  240621C00190000,3,12.40";
    const { rows, warnings } = parsePortfolioCsv(csv);
    const opts = rows.filter((r) => r.assetType === "option");
    expect(opts).toHaveLength(1);
    expect(opts[0].ticker).toBe("AAPL240621C00190000");
    expect(opts[0].quantity).toBe(5);
    expect(warnings.some((w) => w.includes("merged"))).toBe(true);
  });

  it("quantity-weights the carried mark when merging duplicate bond lots", () => {
    // Two lots of the same CUSIP with slightly different marks: the merged mark is
    // quantity-weighted so `mergedQty × mark` reconstructs the summed value.
    // (10 × 98) + (30 × 99) = 3950 over 40 units → 98.75.
    const csv =
      "ticker,quantity,markPrice\n912828YK0,10,98\n912828YK0,30,99";
    const { rows } = parsePortfolioCsv(csv);
    const bond = rows.find((r) => r.ticker === "912828YK0");
    expect(bond?.quantity).toBe(40);
    expect(bond?.attributes).toMatchObject({ kind: "bond", markPrice: 98.75 });
  });
});
