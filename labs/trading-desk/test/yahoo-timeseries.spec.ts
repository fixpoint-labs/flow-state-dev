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
  mapYahooTimeseriesHistory,
  isEmptyTimeseries,
  YAHOO_TIMESERIES_TYPES,
  type YahooTimeseriesResponse,
} from "../lib/providers/yahoo-timeseries";

import { statementSetDisclosure } from "../flows/analysis/lib/statement-set-period";

import rawAapl from "./__fixtures__/yahoo-timeseries-aapl.json";

/** Build a single-series row in the raw timeseries shape. */
function row(type: string, points: Array<{ asOfDate: string; raw: number }>) {
  return {
    meta: { type: [type], symbol: "TSM" },
    [type]: points.map((p) => ({ asOfDate: p.asOfDate, reportedValue: { raw: p.raw } })),
  };
}

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

describe("mapYahooTimeseries — periodEnd only stamps a statement that actually carries figures (Codex review, FIX-1113)", () => {
  it("THE BUG: a response with balance-sheet figures but no income series at all leaves incomeStatement.periodEnd null", () => {
    const anchor = "2024-09-28";
    const resp: YahooTimeseriesResponse = {
      timeseries: {
        result: [
          row("annualTotalAssets", [{ asOfDate: anchor, raw: 400_000_000_000 }]),
        ],
        error: null,
      },
    };
    const { incomeStatement, balanceSheet, cashflow } = mapYahooTimeseries(
      resp,
      "TEST",
      "2026-05-06",
    );
    expect(balanceSheet.periodEnd).toBe(anchor);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
    // The anchor is still chosen response-wide (from the balance-sheet
    // figure) and still governs what date any figure would be READ at — it
    // is only the LABEL that must not attach to a statement with nothing to
    // attach it to.
    expect(incomeStatement.periodEnd).toBeNull();
    // No cashflow series at all either in this response.
    expect(cashflow.periodEnd).toBeNull();
  });

  it("control: a fully-populated response still stamps all three statements", () => {
    const { incomeStatement, balanceSheet, cashflow } = aapl();
    expect(incomeStatement.periodEnd).not.toBeNull();
    expect(balanceSheet.periodEnd).not.toBeNull();
    expect(cashflow.periodEnd).not.toBeNull();
  });

  it("control: a statement whose figures are all explicitly zero still gets stamped — zero is not absent", () => {
    const anchor = "2024-09-28";
    const resp: YahooTimeseriesResponse = {
      timeseries: {
        result: [row("annualTotalRevenue", [{ asOfDate: anchor, raw: 0 }])],
        error: null,
      },
    };
    const { incomeStatement } = mapYahooTimeseries(resp, "TEST", "2026-05-06");
    expect(incomeStatement.periodEnd).toBe(anchor);
    expect(incomeStatement.revenue).toBe(0);
  });

  it("control: fixture-mode reading of this mapper's output (no ladder observations) still reports coherent, not stale", () => {
    // Same nuance as the EDGAR sibling test (see its comment): fixture mode
    // never populates `observedNewest`, so this cannot reproduce the ladder
    // trap Codex traced — `financial-period.spec.ts`'s "the ladder trap
    // this fix removes" does that. This confirms only that the ordinary
    // fixture-mode path is undisturbed by the fix.
    const anchor = "2024-09-28";
    const resp: YahooTimeseriesResponse = {
      timeseries: {
        result: [
          row("annualTotalRevenue", [{ asOfDate: anchor, raw: 391_000_000_000 }]),
          row("annualTotalAssets", [{ asOfDate: anchor, raw: 364_000_000_000 }]),
          // No cashflow series at all — genuinely absent, not stale.
        ],
        error: null,
      },
    };
    const mapped = mapYahooTimeseries(resp, "TEST", "2026-05-06");
    const disclosure = statementSetDisclosure({
      incomeStatement: mapped.incomeStatement,
      balanceSheet: mapped.balanceSheet,
      cashflow: mapped.cashflow,
      incomeStatementPeriodObservation: undefined,
      balanceSheetPeriodObservation: undefined,
      cashflowPeriodObservation: undefined,
    });
    expect(disclosure).toBeNull();
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

describe("mapYahooTimeseriesHistory — multi-period for composites (the ADR fallback)", () => {
  it("requests the working-capital + retained-earnings series the composites need", () => {
    // Without these, Altman X1/X2 are uncomputable for every ticker.
    expect(YAHOO_TIMESERIES_TYPES).toContain("annualCurrentAssets");
    expect(YAHOO_TIMESERIES_TYPES).toContain("annualCurrentLiabilities");
    expect(YAHOO_TIMESERIES_TYPES).toContain("annualRetainedEarnings");
  });

  it("returns one period per fiscal-year-end, newest first, with current assets/liabilities + retained earnings", () => {
    const resp: YahooTimeseriesResponse = {
      timeseries: {
        result: [
          row("annualTotalAssets", [
            { asOfDate: "2023-12-31", raw: 130e9 },
            { asOfDate: "2024-12-31", raw: 145e9 },
          ]),
          row("annualCurrentAssets", [
            { asOfDate: "2023-12-31", raw: 60e9 },
            { asOfDate: "2024-12-31", raw: 70e9 },
          ]),
          row("annualCurrentLiabilities", [
            { asOfDate: "2023-12-31", raw: 35e9 },
            { asOfDate: "2024-12-31", raw: 40e9 },
          ]),
          row("annualRetainedEarnings", [
            { asOfDate: "2023-12-31", raw: 80e9 },
            { asOfDate: "2024-12-31", raw: 95e9 },
          ]),
          row("annualTotalRevenue", [
            { asOfDate: "2023-12-31", raw: 70e9 },
            { asOfDate: "2024-12-31", raw: 88e9 },
          ]),
          row("annualNetIncome", [
            { asOfDate: "2023-12-31", raw: 26e9 },
            { asOfDate: "2024-12-31", raw: 36e9 },
          ]),
        ],
        error: null,
      },
    };
    const periods = mapYahooTimeseriesHistory(resp);
    expect(periods).toHaveLength(2);
    expect(periods[0].endDate).toBe("2024-12-31");
    expect(periods[0].totalAssets).toBeCloseTo(145, 0);
    expect(periods[0].totalCurrentAssets).toBeCloseTo(70, 0);
    expect(periods[0].totalCurrentLiabilities).toBeCloseTo(40, 0);
    expect(periods[0].retainedEarnings).toBeCloseTo(95, 0);
    expect(periods[0].netIncome).toBeCloseTo(36, 0);
    expect(periods[1].endDate).toBe("2023-12-31");
    expect(periods[1].totalAssets).toBeCloseTo(130, 0);
  });

  it("maps an absent series to null, never 0", () => {
    const resp: YahooTimeseriesResponse = {
      timeseries: {
        result: [row("annualTotalAssets", [{ asOfDate: "2024-12-31", raw: 100e9 }])],
        error: null,
      },
    };
    const periods = mapYahooTimeseriesHistory(resp);
    expect(periods).toHaveLength(1);
    expect(periods[0].totalAssets).toBeCloseTo(100, 0);
    expect(periods[0].retainedEarnings).toBeNull();
    expect(periods[0].netIncome).toBeNull();
  });
});
