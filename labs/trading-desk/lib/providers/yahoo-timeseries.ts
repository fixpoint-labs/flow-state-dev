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
 *
 * PERIOD SELECTION IS NOT THIS MODULE'S (FIX-1113). Every figure is read at the
 * ONE anchor chosen by `financial-period.ts` — the period-keyed read this file's
 * multi-year path already used, now the rule everywhere. The latest-value and
 * latest-date-per-series selectors are GONE. The trap they left: the date came
 * from the last POINT while the value came from the last FINITE point, so a
 * payload published a date its own figure did not come from as soon as the
 * newest point was unreported.
 */
import type { FinancialPeriod } from "./financials-history";
import {
  chooseAnchorPeriodEnd,
  consecutivePeriodPair,
  samePeriod,
} from "./financial-period";

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

/** The series behind each ANCHOR-DISCOVERY field (`financial-period.ts`).
 *  Every annual period end any of them reports is an anchor candidate. */
const ANCHOR_SERIES = [
  "annualTotalRevenue",
  "annualOperatingIncome",
  "annualNetIncome",
  "annualOperatingCashFlow",
  "annualFreeCashFlow",
  "annualTotalAssets",
  "annualStockholdersEquity",
  "annualCashAndCashEquivalents",
  "annualTotalDebt",
] as const;

/** Every annual period end any core series reports. Built ONCE per response and
 *  fed to both the single-period statements and the multi-period rows —
 *  deriving it per path is how per-series sorting comes back under a new name.
 *  A point with no usable value is not evidence that its period exists, which
 *  is what kept the old date/value divergence alive. */
function anchorCandidates(series: Map<string, TimeseriesPoint[]>): string[] {
  const ends: string[] = [];
  for (const type of ANCHOR_SERIES) {
    for (const p of series.get(type) ?? []) {
      const raw = p?.reportedValue?.raw;
      if (p.asOfDate && typeof raw === "number" && Number.isFinite(raw)) {
        ends.push(p.asOfDate);
      }
    }
  }
  return ends;
}

/**
 * Map a raw `fundamentals-timeseries` response into the three canonical
 * statement payloads, every figure read at ONE anchor period end. A series the
 * anchor does not carry is `null`; one absent figure never blanks its
 * statement. Monetary values are normalized to USD billions to match the
 * statement schemas and fixtures.
 *
 * `date` (the requested analysis date) is retained only as the legacy `asOf`
 * fallback for a response with no annual period at all. `periodEnd` is NEVER
 * given that fallback — an empty period is the honest answer there.
 */
export function mapYahooTimeseries(
  resp: YahooTimeseriesResponse,
  ticker: string,
  date: string,
) {
  const s = indexByType(resp);
  const candidates = anchorCandidates(s);
  const anchor = chooseAnchorPeriodEnd(candidates);
  const at = (type: string) => valueAtB(s, type, anchor);

  // YoY revenue growth pairs the anchor with the period immediately BEFORE it,
  // and publishes nothing when those two are not consecutive — a gap-year filer
  // gets no growth figure rather than a two-year change called one year's.
  // Unobserved is null, never 0 (which the prompt would read as "flat").
  const pair = consecutivePeriodPair(candidates);
  const revNow = pair ? valueAtB(s, "annualTotalRevenue", pair.anchor) : null;
  const revPrior = pair ? valueAtB(s, "annualTotalRevenue", pair.prior) : null;
  const yoy =
    revNow != null && revPrior != null && revPrior > 0
      ? (revNow - revPrior) / revPrior
      : null;

  // FCF: prefer the reported series; fall back to operating + capex (capex is
  // reported negative) when the desk only has the components. Both legs read at
  // the anchor, so the fallback cannot mix two years.
  let freeCashFlow = at("annualFreeCashFlow");
  if (freeCashFlow == null) {
    const op = at("annualOperatingCashFlow");
    const capex = at("annualCapitalExpenditure");
    if (op != null && capex != null) freeCashFlow = op + capex;
  }

  const asOf = anchor ?? date;

  return {
    incomeStatement: {
      source: "yahoo" as const,
      ticker,
      asOf,
      periodEnd: anchor,
      revenue: at("annualTotalRevenue"),
      grossProfit: at("annualGrossProfit"),
      operatingIncome: at("annualOperatingIncome"),
      netIncome: at("annualNetIncome"),
      yoyRevenueGrowth: yoy,
      unit: "USD billions",
    },
    balanceSheet: {
      source: "yahoo" as const,
      ticker,
      asOf,
      periodEnd: anchor,
      totalAssets: at("annualTotalAssets"),
      totalLiabilities: at("annualTotalLiabilitiesNetMinorityInterest"),
      totalEquity: at("annualStockholdersEquity"),
      cashAndEquivalents: at("annualCashAndCashEquivalents"),
      totalDebt: at("annualTotalDebt"),
      unit: "USD billions",
    },
    cashflow: {
      source: "yahoo" as const,
      ticker,
      asOf,
      periodEnd: anchor,
      operating: at("annualOperatingCashFlow"),
      // investing/financing are not in the timeseries set we request; they are
      // not load-bearing for any derived metric, so they read null here.
      investing: null,
      financing: null,
      freeCashFlow,
      unit: "USD billions",
    },
  };
}

/**
 * The $B value of a series AT a period end; `null` when the series does not
 * carry that period. The whole fix in one function: read AT a period, never
 * "the most recent value". Matched by `samePeriod` rather than string equality
 * so the same fiscal year dated days apart still resolves.
 */
function valueAtB(
  series: Map<string, TimeseriesPoint[]>,
  type: string,
  periodEnd: string | null,
): number | null {
  if (!periodEnd) return null;
  const point = series.get(type)?.find((p) => samePeriod(p.asOfDate ?? null, periodEnd));
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

  // The SAME candidate pool the anchor comes from, newest first, with ends that
  // describe one period collapsed so a provider dating a year days apart cannot
  // yield two rows for it.
  const ends = [...new Set(anchorCandidates(s))].sort(
    (a, b) => Date.parse(b) - Date.parse(a),
  );
  const periodEnds: string[] = [];
  for (const e of ends) {
    if (!periodEnds.some((kept) => samePeriod(kept, e))) periodEnds.push(e);
  }
  periodEnds.splice(maxPeriods);

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
