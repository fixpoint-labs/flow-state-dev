/**
 * Yahoo `fundamentals-timeseries` mapper.
 *
 * The legacy `balanceSheetHistory` / `incomeStatementHistory` /
 * `cashflowStatementHistory` quoteSummary modules stopped carrying their
 * numeric fields in current Yahoo responses: live runs returned statements
 * where grossProfit / operatingIncome and the entire balance sheet + cashflow
 * read 0 (a missing field, not a real zero — see FIX-705 follow-up). The
 * modern `fundamentals-timeseries` endpoint still returns these as annual
 * series, so the statement tools fetch it directly and map here.
 *
 * This module is the pure mapping layer — given a raw timeseries response it
 * produces the three canonical statement payloads. The HTTP fetch lives in
 * `yahoo.ts`. A series that is absent (or carries no usable period) maps to
 * `null`, never 0, preserving the honest-unobserved discipline.
 */
import type { ToolOutput } from "../phase-1/tools/schemas";
import type { FinancialPeriod } from "./financials-history";

/** One annual data point in a Yahoo timeseries series. */
type TimeseriesPoint = {
  asOfDate?: string;
  reportedValue?: { raw?: number };
};

/** One series envelope. The numeric points live under a key equal to the
 *  series type name (e.g. `annualTotalRevenue`), so the row is indexable. */
type TimeseriesRow = {
  meta?: { type?: string[]; symbol?: string };
} & Record<string, TimeseriesPoint[] | unknown>;

/** The raw `fundamentals-timeseries` response shape (only the parts we read). */
export interface YahooTimeseriesResponse {
  timeseries?: { result?: TimeseriesRow[]; error?: unknown };
}

/** The annual series this mapper requests and reads, by canonical statement. */
export const YAHOO_TIMESERIES_TYPES = [
  // income statement
  "annualTotalRevenue",
  "annualGrossProfit",
  "annualOperatingIncome",
  "annualNetIncome",
  "annualCostOfRevenue",
  // balance sheet
  "annualTotalAssets",
  "annualCurrentAssets",
  "annualCurrentLiabilities",
  "annualRetainedEarnings",
  "annualTotalLiabilitiesNetMinorityInterest",
  "annualStockholdersEquity",
  "annualCashAndCashEquivalents",
  "annualTotalDebt",
  // cashflow
  "annualOperatingCashFlow",
  "annualFreeCashFlow",
  "annualCapitalExpenditure",
] as const;

const USD_BILLION = 1_000_000_000;

/**
 * True when a response carries no usable data — either no `result` rows, or
 * rows that are present but every data array is absent. Yahoo returns the
 * latter (HTTP 200, series rows with only `meta`) when it rate-limits the
 * unauthenticated endpoint. The fetchers throw on this so the tool falls
 * through to the next provider instead of returning an all-null payload that
 * falsely claims Yahoo answered.
 */
export function isEmptyTimeseries(resp: YahooTimeseriesResponse): boolean {
  const rows = resp.timeseries?.result;
  if (!rows || rows.length === 0) return true;
  for (const row of rows) {
    const type = row.meta?.type?.[0];
    if (type == null) continue;
    const points = row[type];
    if (Array.isArray(points) && points.length > 0) return false;
  }
  return true;
}

/** Index the response by series type so each field is a direct lookup. */
function indexByType(resp: YahooTimeseriesResponse): Map<string, TimeseriesPoint[]> {
  const out = new Map<string, TimeseriesPoint[]>();
  for (const row of resp.timeseries?.result ?? []) {
    const type = row.meta?.type?.[0];
    if (type == null) continue;
    const points = row[type];
    if (Array.isArray(points)) out.set(type, points as TimeseriesPoint[]);
  }
  return out;
}

/** Latest finite reported value for a series, in $B; `null` if absent/unusable. */
function latestB(series: Map<string, TimeseriesPoint[]>, type: string): number | null {
  const points = series.get(type);
  if (!points || points.length === 0) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    const raw = points[i]?.reportedValue?.raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw / USD_BILLION;
  }
  return null;
}

/** The two latest raw values for a series (absolute dollars), newest last. */
function latestTwoRaw(series: Map<string, TimeseriesPoint[]>, type: string): number[] {
  const points = series.get(type) ?? [];
  const finite: number[] = [];
  for (const p of points) {
    const raw = p?.reportedValue?.raw;
    if (typeof raw === "number" && Number.isFinite(raw)) finite.push(raw);
  }
  return finite.slice(-2);
}

/** Period end-date of the latest income-statement point, else the requested date. */
function latestAsOf(series: Map<string, TimeseriesPoint[]>, type: string, fallback: string): string {
  const points = series.get(type);
  const last = points?.[points.length - 1];
  return last?.asOfDate ?? fallback;
}

/**
 * Map a raw `fundamentals-timeseries` response into the three canonical
 * statement payloads. Missing series → `null` fields. Monetary values are
 * normalized to USD billions to match the statement schemas and fixtures.
 */
export function mapYahooTimeseries(
  resp: YahooTimeseriesResponse,
  ticker: string,
  date: string,
): {
  balanceSheet: ToolOutput<"get_balance_sheet">;
  incomeStatement: ToolOutput<"get_income_statement">;
  cashflow: ToolOutput<"get_cashflow">;
} {
  const s = indexByType(resp);

  // YoY revenue growth needs two periods; with fewer it is unobserved (null),
  // never 0 (which the prompt would read as "flat", a different claim).
  const revPair = latestTwoRaw(s, "annualTotalRevenue");
  const yoy =
    revPair.length === 2 && revPair[0] > 0
      ? (revPair[1] - revPair[0]) / revPair[0]
      : null;

  // FCF: prefer the reported series; fall back to operating + capex (capex is
  // reported negative) when the desk only has the components.
  let freeCashFlow = latestB(s, "annualFreeCashFlow");
  if (freeCashFlow == null) {
    const op = latestB(s, "annualOperatingCashFlow");
    const capex = latestB(s, "annualCapitalExpenditure");
    if (op != null && capex != null) freeCashFlow = op + capex;
  }

  const incomeAsOf = latestAsOf(s, "annualTotalRevenue", date);
  const balanceAsOf = latestAsOf(s, "annualTotalAssets", date);
  const cashflowAsOf = latestAsOf(s, "annualOperatingCashFlow", date);

  return {
    incomeStatement: {
      source: "yahoo",
      ticker,
      asOf: incomeAsOf,
      revenue: latestB(s, "annualTotalRevenue"),
      grossProfit: latestB(s, "annualGrossProfit"),
      operatingIncome: latestB(s, "annualOperatingIncome"),
      netIncome: latestB(s, "annualNetIncome"),
      yoyRevenueGrowth: yoy,
      unit: "USD billions",
    },
    balanceSheet: {
      source: "yahoo",
      ticker,
      asOf: balanceAsOf,
      totalAssets: latestB(s, "annualTotalAssets"),
      totalLiabilities: latestB(s, "annualTotalLiabilitiesNetMinorityInterest"),
      totalEquity: latestB(s, "annualStockholdersEquity"),
      cashAndEquivalents: latestB(s, "annualCashAndCashEquivalents"),
      totalDebt: latestB(s, "annualTotalDebt"),
      unit: "USD billions",
    },
    cashflow: {
      source: "yahoo",
      ticker,
      asOf: cashflowAsOf,
      operating: latestB(s, "annualOperatingCashFlow"),
      // investing/financing are not in the timeseries set we request; they are
      // not load-bearing for any derived metric, so they read null here.
      investing: null,
      financing: null,
      freeCashFlow,
      unit: "USD billions",
    },
  };
}

/** The $B value of a series at a specific period end-date; `null` if absent. */
function valueAtB(
  series: Map<string, TimeseriesPoint[]>,
  type: string,
  asOfDate: string,
): number | null {
  const point = series.get(type)?.find((p) => p.asOfDate === asOfDate);
  const raw = point?.reportedValue?.raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw / USD_BILLION : null;
}

/**
 * Map a raw `fundamentals-timeseries` response into up to `maxPeriods` annual
 * `FinancialPeriod`s, newest first, for the composite scores. This is the
 * non-US-filer fallback (a foreign ADR with no EDGAR us-gaap data falls
 * through to here). Unlike `mapYahooTimeseries` (latest period only) it walks
 * every fiscal-year-end and surfaces the working-capital and retained-earnings
 * series Altman X1/X2 and the change-based Piotroski criteria need. A series
 * absent at a given period maps to `null`, never 0.
 */
export function mapYahooTimeseriesHistory(
  resp: YahooTimeseriesResponse,
  maxPeriods = 4,
): FinancialPeriod[] {
  const s = indexByType(resp);

  // Fiscal-year-ends present in any core series, newest first.
  const dates = new Set<string>();
  for (const type of ["annualTotalAssets", "annualTotalRevenue", "annualNetIncome"]) {
    for (const p of s.get(type) ?? []) {
      if (p.asOfDate) dates.add(p.asOfDate);
    }
  }
  const periodEnds = [...dates].sort().reverse().slice(0, maxPeriods);

  return periodEnds.map((end) => ({
    endDate: end,
    totalAssets: valueAtB(s, "annualTotalAssets", end),
    totalCurrentAssets: valueAtB(s, "annualCurrentAssets", end),
    totalCurrentLiabilities: valueAtB(s, "annualCurrentLiabilities", end),
    totalLiabilities: valueAtB(s, "annualTotalLiabilitiesNetMinorityInterest", end),
    retainedEarnings: valueAtB(s, "annualRetainedEarnings", end),
    totalEquity: valueAtB(s, "annualStockholdersEquity", end),
    totalRevenue: valueAtB(s, "annualTotalRevenue", end),
    costOfRevenue: valueAtB(s, "annualCostOfRevenue", end),
    grossProfit: valueAtB(s, "annualGrossProfit", end),
    operatingIncome: valueAtB(s, "annualOperatingIncome", end),
    netIncome: valueAtB(s, "annualNetIncome", end),
    cfo: valueAtB(s, "annualOperatingCashFlow", end),
    capitalExpenditures: valueAtB(s, "annualCapitalExpenditure", end),
  }));
}
