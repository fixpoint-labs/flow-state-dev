/**
 * Unit tests for the pure Yahoo fundamentals-timeseries mapper.
 *
 * Pins the field selection against a captured live AAPL response. These guard
 * the FIX-705 follow-up bug: the legacy `*History` quoteSummary modules
 * returned zero-filled statements, so grossProfit / operatingIncome / the
 * whole balance sheet + cashflow read 0 in live mode. The fix re-maps to the
 * modern `fundamentals-timeseries` endpoint, which carries those fields. A
 * missing series must map to `null` (honest unobserved), never 0.
 */
import { describe, expect, it } from "vitest";
import {
  mapYahooTimeseries,
  isEmptyTimeseries,
  type YahooTimeseriesResponse,
} from "../src/flows/trading-desk/providers/yahoo-timeseries";

import rawAapl from "./__fixtures__/yahoo-timeseries-aapl.json";

const aapl = () =>
  mapYahooTimeseries(rawAapl as YahooTimeseriesResponse, "AAPL", "2026-05-06");

describe("mapYahooTimeseries — income statement (the regression: gross profit / operating income were 0)", () => {
  it("recovers grossProfit and operatingIncome from the modern endpoint (in $B)", () => {
    const { incomeStatement } = aapl();
    // raw 195_201_000_000 → 195.201 $B
    expect(incomeStatement.grossProfit).toBeCloseTo(195.2, 1);
    // raw 133_050_000_000 → 133.05 $B
    expect(incomeStatement.operatingIncome).toBeCloseTo(133.05, 1);
    expect(incomeStatement.revenue).toBeCloseTo(416.161, 1);
    expect(incomeStatement.netIncome).toBeCloseTo(112.01, 1);
    expect(incomeStatement.source).toBe("yahoo");
  });

  it("computes YoY revenue growth from the two latest periods", () => {
    const { incomeStatement } = aapl();
    // (416.161 - 391.035) / 391.035 = 0.0643
    expect(incomeStatement.yoyRevenueGrowth).toBeCloseTo(0.0643, 3);
  });
});

describe("mapYahooTimeseries — balance sheet (the regression: every field was 0)", () => {
  it("recovers totals from the modern endpoint (in $B)", () => {
    const { balanceSheet } = aapl();
    expect(balanceSheet.totalAssets).toBeCloseTo(359.241, 1);
    expect(balanceSheet.totalLiabilities).toBeCloseTo(285.508, 1);
    expect(balanceSheet.totalEquity).toBeCloseTo(73.733, 1);
    expect(balanceSheet.cashAndEquivalents).toBeCloseTo(35.934, 1);
    expect(balanceSheet.totalDebt).toBeCloseTo(98.657, 1);
    expect(balanceSheet.source).toBe("yahoo");
  });
});

describe("mapYahooTimeseries — cashflow (the regression: every field was 0)", () => {
  it("recovers operating + free cash flow from the modern endpoint (in $B)", () => {
    const { cashflow } = aapl();
    expect(cashflow.operating).toBeCloseTo(111.482, 1);
    expect(cashflow.freeCashFlow).toBeCloseTo(98.767, 1);
    expect(cashflow.source).toBe("yahoo");
  });
});

describe("mapYahooTimeseries — missing series map to null, not 0", () => {
  it("returns null for a field whose series is absent from the response", () => {
    // A response with only revenue present — every other field must be null.
    const sparse: YahooTimeseriesResponse = {
      timeseries: {
        result: [
          {
            meta: { type: ["annualTotalRevenue"], symbol: "AAPL" },
            annualTotalRevenue: [
              { asOfDate: "2025-09-30", reportedValue: { raw: 400_000_000_000 } },
            ],
          },
        ],
        error: null,
      },
    };
    const { incomeStatement, balanceSheet, cashflow } = mapYahooTimeseries(
      sparse,
      "AAPL",
      "2026-05-06",
    );
    expect(incomeStatement.revenue).toBeCloseTo(400, 1);
    // The bug: these used to be 0. They must now be null.
    expect(incomeStatement.grossProfit).toBeNull();
    expect(incomeStatement.operatingIncome).toBeNull();
    expect(balanceSheet.totalAssets).toBeNull();
    expect(cashflow.freeCashFlow).toBeNull();
    // YoY needs two periods; with one it is null, not 0.
    expect(incomeStatement.yoyRevenueGrowth).toBeNull();
  });
});

describe("isEmptyTimeseries — throttled responses (200 OK, rows present, no data) are detected", () => {
  it("flags a response whose result rows carry only meta (Yahoo throttle shape)", () => {
    // This is the exact shape Yahoo returns when rate-limiting: HTTP 200, the
    // requested series rows are present, but every data array is absent. The
    // tool must treat this as a failure and fall through to EDGAR, NOT return
    // an all-null payload tagged source:"yahoo" (a false "Yahoo answered").
    const throttled: YahooTimeseriesResponse = {
      timeseries: {
        result: [
          { meta: { type: ["annualTotalRevenue"], symbol: "MSFT" } },
          { meta: { type: ["annualOperatingIncome"], symbol: "MSFT" } },
        ],
        error: null,
      },
    };
    expect(isEmptyTimeseries(throttled)).toBe(true);
  });

  it("does not flag a response that carries real data", () => {
    expect(isEmptyTimeseries(rawAapl as YahooTimeseriesResponse)).toBe(false);
  });

  it("flags a response with no result rows at all", () => {
    expect(isEmptyTimeseries({ timeseries: { result: [], error: null } })).toBe(true);
    expect(isEmptyTimeseries({})).toBe(true);
  });
});
