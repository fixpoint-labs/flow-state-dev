/**
 * Finnhub REST helpers. Each function makes one or more HTTP calls and
 * returns a payload normalized to the canonical tool output schema. Functions
 * read `FINNHUB_API_KEY` from the environment and throw on any failure (no
 * key, non-2xx, parse error) so the calling tool can fall through with a
 * single `try { ... } catch {}`.
 *
 * Tools using these helpers: get_fundamentals, get_price_history, search_news.
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
      peTTM?: number;
      peNormalizedAnnual?: number;
      psTTM?: number;
      roeTTM?: number;
      operatingMarginTTM?: number;
      grossMarginTTM?: number;
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
  return {
    source: "finnhub",
    ticker: input.ticker,
    asOf: input.date,
    // Profile gives market cap in $M; canonicalize to absolute USD.
    marketCap: (profile.marketCapitalization ?? 0) * 1_000_000,
    forwardPE: m.peNormalizedAnnual ?? m.peTTM ?? 0,
    priceToSales: m.psTTM ?? 0,
    returnOnEquity: pct(m.roeTTM),
    operatingMargin: pct(m.operatingMarginTTM),
    grossMargin: pct(m.grossMarginTTM),
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
    url: n.url,
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
