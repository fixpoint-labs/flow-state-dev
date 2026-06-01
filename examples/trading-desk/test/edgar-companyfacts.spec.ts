/**
 * Unit tests for the pure SEC EDGAR companyfacts mapper.
 *
 * EDGAR is the authoritative statements source (primary, ahead of Yahoo) for
 * the three statement tools. The mapping is non-trivial: balance-sheet facts
 * are instant (end-date only) while income/cashflow facts are duration
 * (start+end), total debt has no single tag, and revenue lives under one of
 * two tags depending on filing era. These tests pin that selection against a
 * captured live AAPL companyfacts response.
 */
import { describe, expect, it } from "vitest";
import {
  mapEdgarCompanyFacts,
  type EdgarCompanyFacts,
} from "../src/flows/trading-desk/providers/edgar-companyfacts";

import rawAapl from "./__fixtures__/edgar-companyfacts-aapl.json";

const aapl = () =>
  mapEdgarCompanyFacts(rawAapl as EdgarCompanyFacts, "AAPL", "2026-05-06");

describe("mapEdgarCompanyFacts — income statement", () => {
  it("maps revenue/grossProfit/operatingIncome/netIncome from us-gaap tags (in $B)", () => {
    const { incomeStatement } = aapl();
    expect(incomeStatement.grossProfit).toBeCloseTo(195.2, 1);
    expect(incomeStatement.operatingIncome).toBeCloseTo(133.1, 1);
    expect(incomeStatement.netIncome).toBeCloseTo(112.0, 1);
    expect(incomeStatement.source).toBe("edgar");
  });

  it("picks the most RECENT revenue across both revenue tags, not a fixed preference", () => {
    // The fixture has `Revenues` ending 2018 (stale — Apple switched tags) and
    // `RevenueFromContractWithCustomerExcludingAssessedTax` ending 2025. A naive
    // "prefer Revenues" would return the 7-year-old 265.6; the mapper must pick
    // the latest-period value (416.2).
    const { incomeStatement } = aapl();
    expect(incomeStatement.revenue).toBeCloseTo(416.2, 1);
  });
});

describe("mapEdgarCompanyFacts — balance sheet (instant facts)", () => {
  it("maps totals from the latest annual instant snapshot (in $B)", () => {
    const { balanceSheet } = aapl();
    expect(balanceSheet.totalAssets).toBeCloseTo(359.2, 1);
    expect(balanceSheet.totalLiabilities).toBeCloseTo(285.5, 1);
    expect(balanceSheet.totalEquity).toBeCloseTo(73.7, 1);
    expect(balanceSheet.cashAndEquivalents).toBeCloseTo(35.9, 1);
    expect(balanceSheet.source).toBe("edgar");
  });

  it("sums total debt from current + noncurrent long-term debt", () => {
    // EDGAR has no single total-debt tag: 78.3 (noncurrent) + 12.3 (current) = 90.7
    const { balanceSheet } = aapl();
    expect(balanceSheet.totalDebt).toBeCloseTo(90.7, 1);
  });
});

describe("mapEdgarCompanyFacts — cashflow (duration facts)", () => {
  it("maps operating cash flow and computes FCF = operating - capex (in $B)", () => {
    // EDGAR reports capex (PaymentsToAcquire...) as a positive outflow, so
    // FCF = 111.5 - 12.7 = 98.8 (Yahoo reports capex negative; the sign
    // convention differs by source and the mapper handles EDGAR's).
    const { cashflow } = aapl();
    expect(cashflow.operating).toBeCloseTo(111.5, 1);
    expect(cashflow.freeCashFlow).toBeCloseTo(98.8, 1);
    expect(cashflow.source).toBe("edgar");
  });
});

describe("mapEdgarCompanyFacts — missing tags map to null, not 0", () => {
  it("returns null for a statement field whose us-gaap tag is absent", () => {
    const sparse: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: "2025-09-27", val: 100_000_000_000, form: "10-K", fp: "FY" },
              ],
            },
          },
        },
      },
    };
    const { balanceSheet, incomeStatement, cashflow } = mapEdgarCompanyFacts(
      sparse,
      "TEST",
      "2026-05-06",
    );
    expect(balanceSheet.totalAssets).toBeCloseTo(100, 1);
    // Everything else absent → null, never 0.
    expect(balanceSheet.totalEquity).toBeNull();
    expect(balanceSheet.totalDebt).toBeNull();
    expect(incomeStatement.revenue).toBeNull();
    expect(incomeStatement.grossProfit).toBeNull();
    expect(cashflow.freeCashFlow).toBeNull();
  });
});
