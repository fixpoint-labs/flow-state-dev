/**
 * Finnhub REST helpers. Each function makes one or more HTTP calls and
 * returns a payload normalized to the canonical tool output schema. Functions
 * read `FINNHUB_API_KEY` from the environment and throw on any failure (no
 * key, non-2xx, parse error) so the calling tool can fall through with a
 * single `try { ... } catch {}`.
 *
 * Tools using these helpers: get_fundamentals, get_price_history, search_news,
 * get_market_news, get_insider_transactions.
 */
import type { ToolInput, ToolOutput } from "../phase-1/tools/schemas";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function requireKey(): string {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) throw new Error("FINNHUB_API_KEY not set");
  return key;
}

export function hasFinnhubKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

/** Map canonical range strings to a calendar-day lookback. Mirrors the
 *  Yahoo service so `compute_indicators` can request `"1y"` and actually
 *  get enough bars for SMA200. */
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

/**
 * Drop Finnhub's opaque news-redirect URLs (`finnhub.io/api/news?id=…`).
 * These are undocumented redirectors that fail server-side; the canonical
 * publisher URL is not recoverable from the payload. Returns `undefined`
 * so the item is kept (headline/summary still inform the memo) but the
 * dead link is removed. See FIX-644.
 */
function canonicalNewsUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "finnhub.io" && parsed.pathname === "/api/news") return undefined;
  return url;
}

async function fetchJson<T>(
  path: string,
  params: Record<string, string | number>,
): Promise<T> {
  const url = new URL(`${FINNHUB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("token", requireKey());
  const res = await fetch(url);
  if (!res.ok) {
    // Read body as text first so a plain-text "Too Many Requests" doesn't
    // explode in JSON.parse the way `yahoo-finance2` v2 did.
    const body = await res.text().catch(() => "");
    throw new Error(`Finnhub ${path} failed: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export async function fetchFinnhubCandles(
  input: ToolInput<"get_price_history">,
): Promise<ToolOutput<"get_price_history">> {
  const to = Math.floor(new Date(input.date).getTime() / 1000);
  const from = to - rangeToLookbackDays(input.range) * 24 * 60 * 60;
  type Candle = {
    s: "ok" | "no_data" | string;
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    v?: number[];
  };
  const data = await fetchJson<Candle>("/stock/candle", {
    symbol: input.ticker,
    resolution: "D",
    from,
    to,
  });
  if (data.s !== "ok" || !data.t) {
    throw new Error(`Finnhub /stock/candle returned no data for ${input.ticker}`);
  }
  const bars = data.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: data.o?.[i] ?? 0,
    high: data.h?.[i] ?? 0,
    low: data.l?.[i] ?? 0,
    close: data.c?.[i] ?? 0,
    volume: data.v?.[i] ?? 0,
  }));
  return {
    source: "finnhub",
    ticker: input.ticker,
    range: input.range ?? "1mo",
    bars,
  };
}

export async function fetchFinnhubFundamentals(
  input: ToolInput<"get_fundamentals">,
): Promise<ToolOutput<"get_fundamentals">> {
  type Profile = { marketCapitalization?: number };
  type Metric = {
    metric?: {
      forwardPE?: number;
      peTTM?: number;
      psTTM?: number;
      roeTTM?: number;
      operatingMarginTTM?: number;
      grossMarginTTM?: number;
      dividendYieldIndicatedAnnual?: number;
    };
  };
  const [profile, metric] = await Promise.all([
    fetchJson<Profile>("/stock/profile2", { symbol: input.ticker }),
    fetchJson<Metric>("/stock/metric", { symbol: input.ticker, metric: "all" }),
  ]);
  const m = metric.metric ?? {};
  // Finnhub returns ratios as percentages for margins/ROE (e.g. 25.3 = 25.3%).
  // Normalize to fractions to match the Yahoo + fixture shape (0.253).
  const pct = (v: number | undefined) => (typeof v === "number" ? v / 100 : 0);
  // P/E fields are nullable in the schema: null is the honest signal that the
  // metric is unavailable, never a backward-looking substitute (FIX-692). A
  // zero P/E is non-physical for a going concern, so it maps to null too —
  // matching the Yahoo adapter's nullableNumberFrom.
  const num = (v: number | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;
  // Nullable percent → fraction. 0/absent → null (a non-payer is unobserved,
  // not "0% yield"); never default to 0 the way pct() does for ROE/margins.
  const nullablePct = (v: number | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) && v !== 0 ? v / 100 : null;
  return {
    source: "finnhub",
    ticker: input.ticker,
    asOf: input.date,
    // Profile gives market cap in $M; normalize to $B to match statements and fixtures.
    marketCap: (profile.marketCapitalization ?? 0) / 1_000,
    forwardPE: num(m.forwardPE),
    trailingPE: num(m.peTTM),
    priceToSales: m.psTTM ?? 0,
    returnOnEquity: pct(m.roeTTM),
    operatingMargin: pct(m.operatingMarginTTM),
    grossMargin: pct(m.grossMarginTTM),
    dividendYield: nullablePct(m.dividendYieldIndicatedAnnual),
  };
}

/**
 * Business-identity profile from Finnhub `/stock/profile2`. Returns the
 * canonical company-profile shape. Finnhub does not provide a sector field
 * or a long business description, so those map to `null` — the Yahoo
 * fallback supplies them when configured. Throws on any failure so the
 * tool handler can fall through to Yahoo.
 */
export async function fetchFinnhubCompanyProfile(
  input: ToolInput<"get_company_profile">,
): Promise<ToolOutput<"get_company_profile">> {
  type Profile = {
    name?: string;
    country?: string;
    currency?: string;
    exchange?: string;
    finnhubIndustry?: string;
    ipo?: string;
    marketCapitalization?: number;
    employeeTotal?: number;
    weburl?: string;
  };
  const data = await fetchJson<Profile>("/stock/profile2", { symbol: input.ticker });
  if (!data.name) {
    throw new Error(`Finnhub /stock/profile2 returned no profile for ${input.ticker}`);
  }
  const str = (v: string | undefined): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const num = (v: number | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const marketCapMillions = num(data.marketCapitalization);
  return {
    source: "finnhub",
    ticker: input.ticker,
    asOf: input.date,
    name: data.name,
    sector: null,
    industry: str(data.finnhubIndustry),
    country: str(data.country),
    exchange: str(data.exchange),
    currency: str(data.currency),
    businessDescription: null,
    marketCapUsd: marketCapMillions !== null ? marketCapMillions * 1_000_000 : null,
    employees: num(data.employeeTotal),
    ipoDate: str(data.ipo),
    website: str(data.weburl),
    websiteMetaDescription: null,
    searchSnippets: null,
  };
}

export async function fetchFinnhubCompanyNews(
  input: ToolInput<"search_news">,
): Promise<ToolOutput<"search_news">> {
  const to = input.date;
  const fromDate = new Date(input.date);
  fromDate.setUTCDate(fromDate.getUTCDate() - 14);
  const from = fromDate.toISOString().slice(0, 10);
  type Item = {
    datetime: number;
    headline: string;
    source: string;
    url?: string;
    category?: string;
    summary?: string;
  };
  const data = await fetchJson<Item[]>("/company-news", {
    symbol: input.ticker,
    from,
    to,
  });
  const items = (data ?? []).slice(0, 12).map((n) => ({
    date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
    headline: n.headline,
    source: n.source,
    url: canonicalNewsUrl(n.url),
    category: n.category,
    summary: n.summary ?? null,
  }));
  return {
    source: "finnhub",
    ticker: input.ticker,
    asOf: input.date,
    items,
  };
}

/**
 * Recent general market-news headlines from Finnhub `/news?category=general`.
 * Market-wide (not ticker-scoped), so the payload carries no `ticker`. Caps
 * at 12 items for prompt budget. Throws on any failure so the tool handler
 * can fall through to `emptyPayload`.
 */
export async function fetchFinnhubMarketNews(
  input: ToolInput<"get_market_news">,
): Promise<ToolOutput<"get_market_news">> {
  type Item = {
    datetime: number;
    headline: string;
    source: string;
    url?: string;
    category?: string;
    summary?: string;
  };
  const data = await fetchJson<Item[]>("/news", { category: "general" });
  const items = (data ?? []).slice(0, 12).map((n) => ({
    date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
    headline: n.headline,
    source: n.source,
    url: canonicalNewsUrl(n.url),
    category: n.category,
    summary: n.summary ?? null,
  }));
  return {
    source: "finnhub",
    asOf: input.date,
    items,
  };
}

/**
 * Macro / geopolitical news from Finnhub `/news?category=general` plus
 * `forex` (rates / FX / trade headlines). Market-wide, not ticker-scoped.
 * `forex` is best-effort: if that one category fails, the general feed alone
 * is still returned rather than discarding both. Deduped by url/headline and
 * capped at 12 items. Throws only if the general feed fails, so the tool
 * handler can fall through to `emptyPayload`.
 *
 * Distinct from `fetchFinnhubMarketNews` (general-only, framed for the Market
 * Analyst's sector/theme lane); this adds the forex/FX lane and is framed for
 * the Macro Analyst's regime read.
 */
export async function fetchFinnhubMacroNews(
  input: ToolInput<"get_macro_news">,
): Promise<ToolOutput<"get_macro_news">> {
  type Item = {
    datetime: number;
    headline: string;
    source: string;
    url?: string;
    category?: string;
    summary?: string;
  };
  const general = await fetchJson<Item[]>("/news", { category: "general" });
  let forex: Item[] = [];
  try {
    forex = await fetchJson<Item[]>("/news", { category: "forex" });
  } catch {
    // forex is a bonus macro/FX lane; the general feed alone is a valid macro read.
  }
  const seen = new Set<string>();
  const items = [...general, ...forex]
    .filter((n) => {
      const k = n.url ?? n.headline;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 12)
    .map((n) => ({
      date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
      headline: n.headline,
      source: n.source,
      url: canonicalNewsUrl(n.url),
      category: n.category,
      summary: n.summary ?? null,
    }));
  return {
    source: "finnhub",
    asOf: input.date,
    items,
  };
}

/**
 * Peer ticker list from Finnhub `/stock/peers`. Returns up to ~20 tickers
 * in the same sub-industry; callers should cap for prompt budget. Throws on
 * any failure so tool handlers can fall through to `emptyPayload`.
 */
export async function fetchFinnhubPeers(
  ticker: string,
  grouping: "subIndustry" | "industry" | "sector" = "subIndustry",
): Promise<string[]> {
  const data = await fetchJson<string[]>("/stock/peers", {
    symbol: ticker,
    grouping,
  });
  if (!Array.isArray(data)) throw new Error(`Finnhub /stock/peers returned non-array for ${ticker}`);
  return data.filter((t) => t !== ticker);
}

const INSIDER_WINDOW_DAYS = 90;

/** Subtracts `days` calendar days from a `YYYY-MM-DD` date string. */
function isoDateDaysBefore(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Recent insider Form 4 filings for a ticker, normalized to the canonical
 * `get_insider_transactions` shape. Window is fixed at 90 calendar days
 * ending on `input.date`. Caps the response at 50 rows so a busy filer
 * doesn't blow up downstream prompts. Throws on any failure (no key,
 * non-2xx, parse error) so the tool handler can fall through to
 * `emptyPayload`.
 */
export async function fetchFinnhubInsiderTransactions(
  input: ToolInput<"get_insider_transactions">,
): Promise<ToolOutput<"get_insider_transactions">> {
  const to = input.date;
  const from = isoDateDaysBefore(input.date, INSIDER_WINDOW_DAYS);
  type Row = {
    name?: string;
    share?: number;
    change?: number;
    filingDate?: string;
    transactionDate?: string;
    transactionCode?: string;
    transactionPrice?: number;
    isDerivative?: boolean;
    position?: string;
  };
  const data = await fetchJson<{ data?: Row[] }>("/stock/insider-transactions", {
    symbol: input.ticker,
    from,
    to,
  });
  const transactions = (data.data ?? []).slice(0, 50).map((r) => ({
    filingDate: r.filingDate ?? "",
    transactionDate: r.transactionDate ?? r.filingDate ?? "",
    insiderName: r.name ?? "",
    insiderTitle: r.position ?? "",
    transactionCode: r.transactionCode ?? "",
    // Finnhub returns `change` as a signed delta (negative on sells); fall
    // back to `share` if `change` is missing.
    shares: typeof r.change === "number" ? r.change : (r.share ?? 0),
    pricePerShare: r.transactionPrice ?? 0,
    isDerivative: Boolean(r.isDerivative),
  }));
  return {
    source: "finnhub",
    ticker: input.ticker,
    asOf: input.date,
    transactions,
    windowDays: INSIDER_WINDOW_DAYS,
  };
}

/** Short interest from Finnhub `/stock/short-interest`. Free endpoint.
 *  Returns the most recent settlement's short interest. */
export async function fetchFinnhubShortInterest(
  ticker: string,
): Promise<{
  shortInterest: number;
  settlementDate: string;
}> {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 3);
  const data = await fetchJson<{ data?: Array<{ shortInterest?: number; date?: string }> }>(
    "/stock/short-interest",
    {
      symbol: ticker,
      from: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    },
  );
  const entries = data.data ?? [];
  if (entries.length === 0) throw new Error(`No short interest data for ${ticker}`);
  const latest = entries[entries.length - 1];
  if (latest.shortInterest == null) throw new Error(`Missing shortInterest field for ${ticker}`);
  return {
    shortInterest: latest.shortInterest,
    settlementDate: latest.date ?? now.toISOString().slice(0, 10),
  };
}

/**
 * Institutional ownership from Finnhub `/stock/ownership` (13F-derived;
 * premium-gated on some plans). Returns the reported holders normalized to the
 * canonical `get_institutional_ownership` shape, with the accumulation /
 * distribution read derived deterministically from the summed QoQ changes
 * against a deadband of total shares held (a near-zero net move reads
 * "neutral", not a direction). Caps `topHolders` for prompt budget. Throws on
 * any failure (no key, non-2xx, empty set) so the tool handler can fall through
 * to `emptyPayload`.
 */
export async function fetchFinnhubInstitutionalOwnership(
  input: ToolInput<"get_institutional_ownership">,
): Promise<ToolOutput<"get_institutional_ownership">> {
  type Row = {
    name?: string;
    share?: number;
    change?: number;
    filingDate?: string;
  };
  const data = await fetchJson<{ ownership?: Row[] }>("/stock/ownership", {
    symbol: input.ticker,
    limit: 30,
  });
  const rows = (data.ownership ?? []).filter((r) => typeof r.share === "number");
  if (rows.length === 0) throw new Error(`No institutional ownership for ${input.ticker}`);

  const holderCount = rows.length;
  const totalSharesHeld = rows.reduce((a, r) => a + (r.share ?? 0), 0);
  const netShareChange = rows.reduce((a, r) => a + (r.change ?? 0), 0);

  // Deadband: a net move under 0.5% of total shares held is positioning noise,
  // not a directional accumulation/distribution signal.
  const deadband = Math.abs(totalSharesHeld) * 0.005;
  const flowDirection: "accumulating" | "neutral" | "distributing" =
    netShareChange > deadband
      ? "accumulating"
      : netShareChange < -deadband
        ? "distributing"
        : "neutral";

  const filingDates = rows
    .map((r) => r.filingDate)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  const reportDate = filingDates.length > 0 ? filingDates[filingDates.length - 1] : null;

  const topHolders = [...rows]
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0))
    .slice(0, 5)
    .map((r) => ({
      name: r.name ?? "",
      shares: r.share ?? 0,
      shareChange: r.change ?? 0,
    }));

  return {
    source: "finnhub",
    ticker: input.ticker,
    asOf: input.date,
    reportDate,
    holderCount,
    totalSharesHeld,
    netShareChange,
    flowDirection,
    topHolders,
  };
}

/** Recommendation trends from Finnhub `/stock/recommendation` (free endpoint).
 *  Returns the latest period's ratings distribution. Throws on any failure. */
export async function fetchFinnhubRecommendations(
  ticker: string,
): Promise<{
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
} | null> {
  type Row = {
    period?: string;
    strongBuy?: number;
    buy?: number;
    hold?: number;
    sell?: number;
    strongSell?: number;
  };
  const data = await fetchJson<Row[]>("/stock/recommendation", { symbol: ticker });
  if (!Array.isArray(data) || data.length === 0) return null;
  const latest = data[0];
  return {
    period: latest.period ?? "",
    strongBuy: latest.strongBuy ?? 0,
    buy: latest.buy ?? 0,
    hold: latest.hold ?? 0,
    sell: latest.sell ?? 0,
    strongSell: latest.strongSell ?? 0,
  };
}

/** Earnings surprises from Finnhub `/stock/earnings` (free endpoint).
 *  Returns the last ~4 quarters of actual-vs-estimate with surprise %. */
export async function fetchFinnhubEarningsSurprises(
  ticker: string,
): Promise<Array<{
  period: string;
  actual: number | null;
  estimate: number | null;
  surprisePct: number | null;
}>> {
  type Row = {
    period?: string;
    actual?: number;
    estimate?: number;
    surprisePercent?: number;
  };
  const data = await fetchJson<Row[]>("/stock/earnings", { symbol: ticker });
  if (!Array.isArray(data)) return [];
  return data.slice(0, 8).map((r) => ({
    period: r.period ?? "",
    actual: r.actual ?? null,
    estimate: r.estimate ?? null,
    surprisePct: r.surprisePercent ?? null,
  }));
}
