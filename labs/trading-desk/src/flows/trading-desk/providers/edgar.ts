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
import type { ToolInput, ToolOutput } from "../phase-1/tools/schemas";
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
  input: ToolInput<"get_balance_sheet">,
): Promise<ToolOutput<"get_balance_sheet">> {
  const facts = await fetchCompanyFacts(input.ticker);
  return mapEdgarCompanyFacts(facts, input.ticker, input.date).balanceSheet;
}

export async function fetchEdgarIncomeStatement(
  input: ToolInput<"get_income_statement">,
): Promise<ToolOutput<"get_income_statement">> {
  const facts = await fetchCompanyFacts(input.ticker);
  return mapEdgarCompanyFacts(facts, input.ticker, input.date).incomeStatement;
}

export async function fetchEdgarCashflow(
  input: ToolInput<"get_cashflow">,
): Promise<ToolOutput<"get_cashflow">> {
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
