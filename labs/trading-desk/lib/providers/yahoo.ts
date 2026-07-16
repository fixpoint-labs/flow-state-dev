/**
 * Yahoo Finance helpers via `yahoo-finance2` v3. Each function returns a
 * payload normalized to the canonical tool output schema. The Yahoo client
 * is loaded dynamically so `pnpm install` can complete in environments that
 * prune the optional dep, and instantiated once per process.
 *
 * Tools using these helpers: get_fundamentals, get_price_history,
 * get_balance_sheet, get_income_statement, get_cashflow.
 */
import type {
  PriceHistoryProviderInput,
  TickerDatedProviderInput,
} from "./types";
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
    moduleOptions?: { validateResult?: boolean },
  ) => Promise<{ quotes?: Array<Record<string, unknown>> }>;
  quoteSummary: (
    ticker: string,
    opts: { modules: string[] },
    // yahoo-finance2's third arg: `validateResult: false` returns the raw result
    // instead of throwing on a strict-schema miss (and silences the log).
    moduleOptions?: { validateResult?: boolean },
  ) => Promise<Record<string, unknown | undefined>>;
};

/**
 * Map a stored ticker to Yahoo's wire spelling.
 *
 * US class shares are stored dotted/slashed (`BRK.B` / `BRK/B`) but Yahoo
 * resolves them only with a hyphen (`BRK-B`). International symbols keep a
 * dotted *exchange* suffix (`ASML.AS`, `7203.T`) — rewriting those to hyphens
 * makes `quoteSummary` miss while the price path still works with the original
 * dotted form. Heuristic:
 *   - trailing `/X` → always a class-share spelling → hyphenate
 *   - trailing `.X` after an alphabetic base → class share → hyphenate
 *   - everything else (multi-letter exchange, numeric+exchange) → leave alone
 */
export function toYahooSymbol(ticker: string): string {
  if (/\/[A-Za-z]$/.test(ticker)) return ticker.replace(/\/([A-Za-z])$/i, "-$1");
  if (/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z]$/.test(ticker)) {
    return ticker.replace(/\./, "-");
  }
  return ticker;
}

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
  input: PriceHistoryProviderInput,
) {
  const yahoo = await getYahoo();
  const period2 = new Date(input.date);
  const period1 = new Date(period2);
  period1.setUTCDate(period1.getUTCDate() - rangeToLookbackDays(input.range));
  // `validateResult: false`: yahoo-finance2 throws on a strict-schema miss, and
  // Yahoo intermittently returns incomplete `meta` (null `currency`, absent
  // `regularMarketPrice`) — `meta` fields this function never reads. Without the
  // flag that throw discards the OHLCV bars (built by the module transform, which
  // runs before validation) over metadata we don't use. The bars are read
  // defensively below, so we take what Yahoo returned. Same posture as the
  // company-profile fetch; see that call for the full rationale.
  const result = await yahoo.chart(
    input.ticker,
    { period1, period2, interval: "1d" },
    { validateResult: false },
  );
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
    source: "yahoo" as const,
    ticker: input.ticker,
    range: input.range ?? "1mo",
    bars,
  };
}

export async function fetchYahooFundamentals(
  input: TickerDatedProviderInput,
) {
  const yahoo = await getYahoo();
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["summaryDetail", "financialData", "defaultKeyStatistics"],
  })) as Record<string, Record<string, unknown> | undefined>;
  const detail = summary.summaryDetail ?? {};
  const fin = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  return {
    source: "yahoo" as const,
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
  input: TickerDatedProviderInput,
) {
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

/** One stock split from a provider: the ex-date and the `{ numerator,
 *  denominator }` ratio — the FIX-876 `splitAttributesSchema` shape (a 10:1
 *  forward is `{ numerator: 10, denominator: 1 }`). */
export type ProviderSplit = { date: string; numerator: number; denominator: number };

/**
 * Fetch a ticker's stock-split history from Yahoo's keyless chart API over
 * `[from, to]` (ISO dates). Yahoo reports each split's numerator/denominator
 * natively, so the pair passes through unconverted. Sorted oldest-first. Throws
 * on a failed request so the caller can degrade (a split-less backfill leaves
 * realized gains as they were) rather than fabricate. Used only by the split
 * backfill — the desk's data tools don't need corporate actions.
 */
export async function fetchYahooSplits(
  ticker: string,
  from: string,
  to: string,
): Promise<ProviderSplit[]> {
  const p1 = Math.floor(new Date(from).getTime() / 1000);
  const p2 = Math.floor(new Date(to).getTime() / 1000);
  const symbol = toYahooSymbol(ticker);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("period1", String(p1));
  url.searchParams.set("period2", String(p2));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "split");
  // One retry: Yahoo's chart endpoint intermittently 404s a valid symbol under
  // load, so a single flaky response can't silently drop a real split.
  let res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 300));
    res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  }
  if (!res.ok) throw new Error(`Yahoo split fetch for ${ticker} failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        events?: { splits?: Record<string, { date?: number; numerator?: number; denominator?: number }> };
      }>;
    };
  };
  const splits = json.chart?.result?.[0]?.events?.splits ?? {};
  const out: ProviderSplit[] = [];
  for (const s of Object.values(splits)) {
    if (
      typeof s.numerator !== "number" ||
      typeof s.denominator !== "number" ||
      !(s.numerator > 0) ||
      !(s.denominator > 0) ||
      !Number.isFinite(s.numerator / s.denominator) ||
      typeof s.date !== "number"
    ) {
      continue;
    }
    out.push({
      date: new Date(s.date * 1000).toISOString().slice(0, 10),
      numerator: s.numerator,
      denominator: s.denominator,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function fetchYahooBalanceSheet(
  input: TickerDatedProviderInput,
) {
  const resp = await fetchYahooTimeseries(input.ticker);
  return mapYahooTimeseries(resp, input.ticker, input.date).balanceSheet;
}

export async function fetchYahooIncomeStatement(
  input: TickerDatedProviderInput,
) {
  const resp = await fetchYahooTimeseries(input.ticker);
  return mapYahooTimeseries(resp, input.ticker, input.date).incomeStatement;
}

export async function fetchYahooCashflow(
  input: TickerDatedProviderInput,
) {
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
  input: TickerDatedProviderInput,
) {
  const yahoo = await getYahoo();
  // Class-share hyphenation only — exchange-suffixed internationals keep their
  // dots (see `toYahooSymbol`). This fetch has no fallback provider (Yahoo is
  // the only sector source), so a wrong spelling silently never resolves —
  // unlike price refresh, which falls through to Finnhub.
  const symbol = toYahooSymbol(input.ticker);
  // `assetProfile` carries sector/industry/business-description; `summaryDetail`
  // carries marketCap/currency; `quoteType` is the canonical home for the
  // company's display name and exchange — `assetProfile` does not include
  // `longName`/`shortName`, so the name has to come from `quoteType`.
  //
  // `validateResult: false`: yahoo-finance2 validates the WHOLE result against a
  // strict schema and throws on any miss — a null `summaryDetail.currency` or a
  // `quoteType` missing its exchange/timezone metadata (both common for real
  // held tickers) would discard an otherwise-usable `assetProfile.sector`. This
  // is a best-effort identity/sector lookup and every field below is read
  // defensively (`stringFrom`/`numberFrom` tolerate missing values), so we take
  // what Yahoo returned and still throw our own honest signal on a truly empty
  // profile (below). NOT applied to the fundamentals/short-interest calls, where
  // strict validation + provider-chain fallback is the correct honest-over-wrong
  // behavior for numeric data feeding analyst reasoning.
  const summary = (await yahoo.quoteSummary(
    symbol,
    { modules: ["assetProfile", "summaryDetail", "quoteType"] },
    { validateResult: false },
  )) as Record<string, Record<string, unknown> | undefined>;
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
    source: "yahoo" as const,
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

/**
 * Yahoo's own instrument-kind discriminator (`"EQUITY"` / `"ETF"` /
 * `"MUTUALFUND"` / `"CRYPTOCURRENCY"` / `"INDEX"` / ... — the `quoteType`
 * field ON the `quoteType` module, not the module name). A minimal, separate
 * fetch (one small module) from `fetchYahooCompanyProfile` — kept apart so
 * this portfolio-only need can't reshape that function's `get_company_profile`
 * tool contract, which the analysis pipeline also depends on. Used to tell a
 * genuinely sectorless equity apart from a fund/crypto asset mistyped
 * `assetType: "equity"` at import (FIX-762 follow-up). Returns null on any
 * failure — the caller treats that as "can't tell, leave as-is".
 */
export async function fetchYahooQuoteKind(ticker: string): Promise<string | null> {
  const yahoo = await getYahoo();
  const symbol = toYahooSymbol(ticker);
  try {
    const summary = (await yahoo.quoteSummary(
      symbol,
      { modules: ["quoteType"] },
      { validateResult: false },
    )) as Record<string, Record<string, unknown> | undefined>;
    return stringFrom(summary.quoteType?.quoteType);
  } catch {
    return null;
  }
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
