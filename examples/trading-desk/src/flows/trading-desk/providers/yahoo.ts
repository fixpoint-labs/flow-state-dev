/**
 * Yahoo Finance helpers via `yahoo-finance2` v3. Each function returns a
 * payload normalized to the canonical tool output schema. The Yahoo client
 * is loaded dynamically so `pnpm install` can complete in environments that
 * prune the optional dep, and instantiated once per process.
 *
 * Tools using these helpers: get_fundamentals, get_price_history,
 * get_balance_sheet, get_income_statement, get_cashflow.
 */
import type { ToolInput, ToolOutput } from "../phase-1/tools/schemas";
import {
  isEmptyTimeseries,
  mapYahooTimeseries,
  mapYahooTimeseriesHistory,
  YAHOO_TIMESERIES_TYPES,
  type YahooTimeseriesResponse,
} from "./yahoo-timeseries";
import { mapYahooShortInterest } from "./yahoo-keystats";
import type { FinancialPeriod } from "./financials-history";

type YahooClient = {
  chart: (
    ticker: string,
    opts: { period1: Date; period2: Date; interval: string },
  ) => Promise<{ quotes?: Array<Record<string, unknown>> }>;
  quoteSummary: (
    ticker: string,
    opts: { modules: string[] },
  ) => Promise<Record<string, unknown | undefined>>;
};

// Two layers of caching:
//   - `cachedClient` holds the fully-constructed instance for subsequent calls.
//   - `clientPromise` holds the in-flight construction so concurrent first
//     callers share one `await import()` + `new` cycle.
let cachedClient: YahooClient | null = null;
let clientPromise: Promise<YahooClient> | null = null;
async function getYahoo(): Promise<YahooClient> {
  if (cachedClient !== null) return cachedClient;
  if (clientPromise !== null) return clientPromise;
  clientPromise = (async () => {
    const mod = (await import("yahoo-finance2")) as unknown as {
      default: new () => YahooClient;
    };
    cachedClient = new mod.default();
    return cachedClient;
  })();
  return clientPromise;
}

/** Map canonical range strings to a calendar-day lookback window. */
function rangeToLookbackDays(range: string | undefined): number {
  switch (range) {
    case "1mo": return 45;
    case "3mo": return 100;
    case "6mo": return 200;
    case "1y": return 380;
    case "2y": return 750;
    default: return 45;
  }
}

export async function fetchYahooChart(
  input: ToolInput<"get_price_history">,
): Promise<ToolOutput<"get_price_history">> {
  const yahoo = await getYahoo();
  const period2 = new Date(input.date);
  const period1 = new Date(period2);
  period1.setUTCDate(period1.getUTCDate() - rangeToLookbackDays(input.range));
  const result = await yahoo.chart(input.ticker, {
    period1,
    period2,
    interval: "1d",
  });
  const bars = (result.quotes ?? [])
    .filter((q) => q.open != null && q.close != null)
    .map((q) => ({
      date: (q.date instanceof Date ? q.date : new Date(q.date as string))
        .toISOString()
        .slice(0, 10),
      open: Number(q.open ?? 0),
      high: Number(q.high ?? 0),
      low: Number(q.low ?? 0),
      close: Number(q.close ?? 0),
      volume: Number(q.volume ?? 0),
    }));
  return {
    source: "yahoo",
    ticker: input.ticker,
    range: input.range ?? "1mo",
    bars,
  };
}

export async function fetchYahooFundamentals(
  input: ToolInput<"get_fundamentals">,
): Promise<ToolOutput<"get_fundamentals">> {
  const yahoo = await getYahoo();
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["summaryDetail", "financialData", "defaultKeyStatistics"],
  })) as Record<string, Record<string, unknown> | undefined>;
  const detail = summary.summaryDetail ?? {};
  const fin = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: input.date,
    // Yahoo returns absolute USD; normalize to $B to match statements and fixtures.
    marketCap: numberFrom(detail.marketCap) / 1_000_000_000,
    forwardPE:
      nullableNumberFrom(stats.forwardPE) ?? nullableNumberFrom(detail.forwardPE),
    trailingPE: nullableNumberFrom(detail.trailingPE),
    priceToSales: numberFrom(detail.priceToSalesTrailing12Months),
    returnOnEquity: numberFrom(fin.returnOnEquity),
    operatingMargin: numberFrom(fin.operatingMargins),
    grossMargin: numberFrom(fin.grossMargins),
    dividendYield: nullableNumberFrom(detail.dividendYield),
  };
}

/**
 * Short interest from Yahoo `defaultKeyStatistics` — free, no key, and covers
 * ADRs (where Finnhub's short-interest endpoint is sparse). Throws when the
 * module carries no `sharesShort` so the calling tool falls through to Finnhub
 * with a single `try { ... } catch {}`, matching the provider convention.
 */
export async function fetchYahooShortInterest(
  input: ToolInput<"get_short_interest">,
): Promise<ToolOutput<"get_short_interest">> {
  const yahoo = await getYahoo();
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["defaultKeyStatistics"],
  })) as Record<string, Record<string, unknown> | undefined>;
  const stats = summary.defaultKeyStatistics ?? {};
  const out = mapYahooShortInterest(stats, input.ticker, input.date);
  if (out.shortInterest == null) {
    throw new Error(`No Yahoo short interest for ${input.ticker}`);
  }
  return out;
}

/**
 * Fetch the three statements in one call from the modern
 * `fundamentals-timeseries` endpoint and map them with `mapYahooTimeseries`.
 *
 * The legacy `*History` quoteSummary modules stopped carrying their numeric
 * fields (live runs read 0 across grossProfit / operatingIncome / the whole
 * balance sheet + cashflow — FIX-705 follow-up). This endpoint still returns
 * them as annual series. We hit the REST URL directly rather than via the
 * `yahoo-finance2` client: the client's `fundamentalsTimeSeries` transform
 * reshapes the payload opaquely, and the raw series shape is the one we can
 * pin in tests. Throws on non-2xx so callers fall through to the next
 * provider with a single `try { ... } catch {}`.
 */
const YAHOO_TIMESERIES_BASE =
  "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";

async function fetchYahooTimeseries(ticker: string): Promise<YahooTimeseriesResponse> {
  const url = new URL(`${YAHOO_TIMESERIES_BASE}/${encodeURIComponent(ticker)}`);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("type", YAHOO_TIMESERIES_TYPES.join(","));
  // Wide window so at least one annual period (plus a prior for YoY) lands.
  url.searchParams.set("period1", "1483228800"); // 2017-01-01
  url.searchParams.set("period2", "9999999999");
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Yahoo timeseries failed: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const json = (await res.json()) as YahooTimeseriesResponse;
  // Yahoo throttles the unauthenticated endpoint with a 200 that carries the
  // series rows but no data. Treat that as a failure so the tool falls through
  // to the next provider rather than returning an all-null "yahoo" payload.
  if (isEmptyTimeseries(json)) {
    throw new Error(`Yahoo timeseries empty for ${ticker} (throttled or unsupported)`);
  }
  return json;
}

export async function fetchYahooBalanceSheet(
  input: ToolInput<"get_balance_sheet">,
): Promise<ToolOutput<"get_balance_sheet">> {
  const resp = await fetchYahooTimeseries(input.ticker);
  return mapYahooTimeseries(resp, input.ticker, input.date).balanceSheet;
}

export async function fetchYahooIncomeStatement(
  input: ToolInput<"get_income_statement">,
): Promise<ToolOutput<"get_income_statement">> {
  const resp = await fetchYahooTimeseries(input.ticker);
  return mapYahooTimeseries(resp, input.ticker, input.date).incomeStatement;
}

export async function fetchYahooCashflow(
  input: ToolInput<"get_cashflow">,
): Promise<ToolOutput<"get_cashflow">> {
  const resp = await fetchYahooTimeseries(input.ticker);
  return mapYahooTimeseries(resp, input.ticker, input.date).cashflow;
}

/**
 * Business-identity profile from Yahoo `quoteSummary` with the
 * `assetProfile` and `summaryDetail` modules. Yahoo is the preferred
 * source for `sector` and `businessDescription` (Finnhub provides
 * neither). Throws on any failure so the tool handler can fall through
 * to `emptyPayload`.
 */
export async function fetchYahooCompanyProfile(
  input: ToolInput<"get_company_profile">,
): Promise<ToolOutput<"get_company_profile">> {
  const yahoo = await getYahoo();
  // `assetProfile` carries sector/industry/business-description; `summaryDetail`
  // carries marketCap/currency; `quoteType` is the canonical home for the
  // company's display name and exchange — `assetProfile` does not include
  // `longName`/`shortName`, so the name has to come from `quoteType`.
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["assetProfile", "summaryDetail", "quoteType"],
  })) as Record<string, Record<string, unknown> | undefined>;
  const profile = summary.assetProfile ?? {};
  const detail = summary.summaryDetail ?? {};
  const qt = summary.quoteType ?? {};
  const name = stringFrom(qt.longName) ?? stringFrom(qt.shortName);
  if (name === null) {
    throw new Error(`Yahoo quoteSummary returned no profile for ${input.ticker}`);
  }
  const marketCap = numberFrom(detail.marketCap);
  const employees = numberFrom(profile.fullTimeEmployees);
  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: input.date,
    name,
    sector: stringFrom(profile.sector),
    industry: stringFrom(profile.industry),
    country: stringFrom(profile.country),
    exchange: stringFrom(qt.exchange),
    currency: stringFrom(detail.currency),
    businessDescription: stringFrom(profile.longBusinessSummary),
    marketCapUsd: marketCap > 0 ? marketCap : null,
    employees: employees > 0 ? employees : null,
    ipoDate: null,
    website: stringFrom(profile.website),
    websiteMetaDescription: null,
    searchSnippets: null,
  };
}

function stringFrom(raw: unknown): string | null {
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  return null;
}

/** Yahoo nests numeric values under `{ raw }` for some modules; unwrap both shapes. */
function numberFrom(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "object" && "raw" in raw) {
    const v = (raw as { raw?: unknown }).raw;
    return typeof v === "number" ? v : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Nullable variant of `numberFrom` for P/E fields: a zero or missing P/E is
 *  non-physical for a going concern, so it maps to `null` rather than `0`.
 *  Don't generalize to ROE/margins — there `0` is a real value (FIX-692). */
function nullableNumberFrom(raw: unknown): number | null {
  const n = numberFrom(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Multi-period statement history from the modern `fundamentals-timeseries`
 * endpoint, for the composite scores. Used as the non-US-filer fallback (EDGAR
 * is primary for US filers). Returns annual `FinancialPeriod`s newest first;
 * `[]` when the core series carry no usable period (the caller then degrades).
 *
 * Replaces the legacy `*History` quoteSummary path, which carried no numeric
 * fields in current Yahoo responses (the same breakage the statement tools
 * were migrated off of).
 */
export async function fetchYahooFinancialsHistory(
  ticker: string,
): Promise<FinancialPeriod[]> {
  const resp = await fetchYahooTimeseries(ticker);
  return mapYahooTimeseriesHistory(resp);
}
