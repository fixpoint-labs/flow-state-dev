/**
 * SEC EDGAR REST helpers — the authoritative statements source.
 *
 * EDGAR is free, needs no API key, and is the primary regulatory filing that
 * Yahoo/Finnhub are themselves derived from. SEC asks only for a descriptive
 * `User-Agent`. Each function makes one or more HTTP calls and returns a
 * payload normalized to the canonical statement schema, throwing on any
 * failure (non-2xx, parse error, unknown ticker) so the calling tool can fall
 * through to the next provider with a single `try { ... } catch {}`.
 *
 * The single-period statement helpers read `us-gaap` only, so non-US tickers
 * throw here and fall through to Yahoo — the same honest degradation the rest
 * of the desk uses. The multi-period `fetchEdgarFinancialsHistory` (for the
 * composite scores) additionally reads `ifrs-full`, so foreign private issuers
 * that file a 20-F with a USD convenience translation (e.g. TSM) resolve from
 * EDGAR directly rather than depending on Yahoo.
 *
 * Tools using these helpers: get_balance_sheet, get_income_statement,
 * get_cashflow, get_quant_composites.
 */
import type { TickerDatedProviderInput } from "./types";
import {
  mapEdgarCompanyFacts,
  mapEdgarFinancialsHistory,
  type EdgarCompanyFacts,
} from "./edgar-companyfacts";
import type { FinancialPeriod } from "./financials-history";

// SEC requires a descriptive User-Agent identifying the caller.
export const USER_AGENT = "flow-state-dev-example (flow-state@fixpointlabs.co)";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const COMPANYFACTS_BASE = "https://data.sec.gov/api/xbrl/companyfacts";
const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";

/** GET an EDGAR URL with the required User-Agent, throwing on any non-2xx so
 *  callers fall through with a single `try/catch`. Shared by the filings and
 *  registration providers (one copy, not three). An optional `signal` lets a
 *  caller (recovery on a cancelled run) abort the in-flight request. */
export async function edgarFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal });
  if (!res.ok) throw new Error(`EDGAR ${url} failed: HTTP ${res.status}`);
  return res;
}

/** The `filings.recent` arrays the filings + registration providers read. */
export type RecentSubmissions = {
  form?: string[];
  filingDate?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
  items?: string[];
};

export type SubmissionsData = { cik: number; name: string; recent: RecentSubmissions };

// Short-TTL submissions cache, keyed by padded CIK. The full recent-filings
// list is date-independent, so both the disclosure list (get_sec_filings) and
// registration recovery project their own shape from ONE fetch instead of
// hitting SEC twice for the same issuer within a run. A short TTL (not the
// permanent ticker→CIK idiom) bounds staleness: on a long-lived server a newly
// posted 424B/8-K/10-K becomes visible within minutes rather than at restart.
const SUBMISSIONS_TTL_MS = 5 * 60 * 1000;
const submissionsCache = new Map<string, { expires: number; data: Promise<SubmissionsData> }>();

/** One entry in SEC's `company_tickers.json` map. */
type TickerEntry = { cik_str: number; ticker: string; title: string };

// Process-wide ticker→CIK cache. The SEC map is ~10k entries and stable
// within a session; fetch it once and reuse. Mirrors the dynamic-import +
// cached-promise pattern the Yahoo client uses.
let cikMap: Map<string, number> | null = null;
let cikMapPromise: Promise<Map<string, number>> | null = null;

async function getCikMap(): Promise<Map<string, number>> {
  if (cikMap !== null) return cikMap;
  if (cikMapPromise !== null) return cikMapPromise;
  cikMapPromise = (async () => {
    const res = await fetch(TICKERS_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`SEC company_tickers failed: HTTP ${res.status}`);
    const raw = (await res.json()) as Record<string, TickerEntry>;
    const map = new Map<string, number>();
    for (const entry of Object.values(raw)) {
      if (entry?.ticker && typeof entry.cik_str === "number") {
        map.set(entry.ticker.toUpperCase(), entry.cik_str);
      }
    }
    cikMap = map;
    return map;
  })();
  return cikMapPromise;
}

/** Resolve a ticker to its zero-padded 10-digit CIK, or throw if unknown
 *  (non-US / not an SEC filer — the caller falls through to Yahoo). */
export async function resolveCik(ticker: string): Promise<string> {
  const map = await getCikMap();
  const cik = map.get(ticker.toUpperCase());
  if (cik == null) throw new Error(`No SEC CIK for ticker ${ticker} (non-US filer?)`);
  return String(cik).padStart(10, "0");
}

/**
 * Fetch the raw submissions (`{ cik, name, recent }`) for a ticker, cached per
 * CIK for the process (a failed fetch is evicted so a retry re-fetches). The
 * filings provider and the registration-recovery provider both project from
 * this one payload — one SEC round-trip per issuer per run, not two.
 */
export async function fetchRecentSubmissions(
  ticker: string,
  signal?: AbortSignal,
): Promise<SubmissionsData> {
  const cik = await resolveCik(ticker);
  const cached = submissionsCache.get(cik);
  if (cached && cached.expires > Date.now()) return cached.data;
  const pending = (async () => {
    const res = await edgarFetch(`${SUBMISSIONS_BASE}/CIK${cik}.json`, signal);
    const data = (await res.json()) as {
      cik?: number;
      name?: string;
      filings?: { recent?: RecentSubmissions };
    };
    return {
      cik: data.cik ?? Number(cik),
      name: data.name ?? "",
      recent: data.filings?.recent ?? {},
    };
  })();
  submissionsCache.set(cik, { expires: Date.now() + SUBMISSIONS_TTL_MS, data: pending });
  pending.catch(() => submissionsCache.delete(cik));
  return pending;
}

/** Fetch + cache the raw companyfacts payload for a ticker (one HTTP call). */
async function fetchCompanyFacts(ticker: string): Promise<EdgarCompanyFacts> {
  const cik = await resolveCik(ticker);
  const res = await fetch(`${COMPANYFACTS_BASE}/CIK${cik}.json`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`EDGAR companyfacts failed for ${ticker}: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return (await res.json()) as EdgarCompanyFacts;
}

export async function fetchEdgarBalanceSheet(
  input: TickerDatedProviderInput,
) {
  const facts = await fetchCompanyFacts(input.ticker);
  return mapEdgarCompanyFacts(facts, input.ticker, input.date).balanceSheet;
}

export async function fetchEdgarIncomeStatement(
  input: TickerDatedProviderInput,
) {
  const facts = await fetchCompanyFacts(input.ticker);
  return mapEdgarCompanyFacts(facts, input.ticker, input.date).incomeStatement;
}

export async function fetchEdgarCashflow(
  input: TickerDatedProviderInput,
) {
  const facts = await fetchCompanyFacts(input.ticker);
  return mapEdgarCompanyFacts(facts, input.ticker, input.date).cashflow;
}

/**
 * Multi-period statement history for the composite scores. Returns the annual
 * `FinancialPeriod`s EDGAR has on file (newest first), throwing when none are
 * present (non-US filer, or an EDGAR miss) so the caller falls through to
 * Yahoo. US filers get the full working-capital + retained-earnings inputs
 * Altman X1/X2 need, plus a prior period for the change-based Piotroski tests.
 */
export async function fetchEdgarFinancialsHistory(
  ticker: string,
): Promise<FinancialPeriod[]> {
  const facts = await fetchCompanyFacts(ticker);
  const periods = mapEdgarFinancialsHistory(facts);
  if (periods.length === 0) throw new Error(`No EDGAR financial history for ${ticker}`);
  return periods;
}
