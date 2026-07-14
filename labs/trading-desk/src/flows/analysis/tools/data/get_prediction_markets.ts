/**
 * Two-tier Polymarket prediction markets for the ticker (FIX-681).
 *
 * Polymarket is the only live provider for this tool — used by no other tool
 * — so the Gamma API plumbing lives inline. A single query flattens markets
 * across events from the `public-search` endpoint, drops closed/inactive
 * markets, and sorts by liquidity (depth of conviction). The tool runs that
 * query twice:
 *
 *   1. `tickerMarkets`   — `q=<TICKER>`. The primary signal; feeds the
 *                          sentiment analyst's numeric aggregates.
 *   2. `backdropMarkets` — one query per sector/macro theme resolved from the
 *                          company's `sector`, merged and deduped by slug.
 *                          Regime framing only — never numeric aggregates.
 *
 * `coverageQuality` is computed deterministically from `tickerMarkets` so the
 * sentiment prompt can gate its market metrics on thin/absent coverage rather
 * than inventing numbers. The analyst still decides which markets are
 * relevant from the question text; we don't classify "bullish vs. bearish".
 *
 * Sector resolution happens inside the tool because the sentiment analyst (which
 * owns this tool) and the company-profile analyst run in parallel — the profile
 * memo isn't committed yet, so the tool can't read it. In live mode it does a
 * soft, best-effort Yahoo profile fetch for the sector and falls back to the
 * default macro themes on any failure. Fixture mode reads a curated payload
 * that already carries both tiers.
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchYahooCompanyProfile } from "@/src/providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import {
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "../schemas";

const POLY_SEARCH = "https://gamma-api.polymarket.com/public-search";
const DEFAULT_TOP_N = 10;
/** How many merged backdrop markets to keep after dedupe. Backdrop is context,
 *  not the primary signal, so a tight cap avoids drowning the ticker reads. */
const BACKDROP_TOP_N = 3;
/** `rich` coverage floors: at least this many ticker markets AND this much
 *  aggregate liquidity. Below either floor (with ≥1 market) is `thin`. */
const RICH_MIN_MARKETS = 3;
const RICH_MIN_LIQUIDITY_USD = 100_000;

type Market = ToolOutput<"get_prediction_markets">["tickerMarkets"][number];

/**
 * Sector → backdrop-theme map. Each theme becomes one Polymarket query whose
 * top results form the sector/macro backdrop. `_default` covers tickers whose
 * sector is unknown or unmapped. Extend as new sectors need coverage.
 */
const SECTOR_THEME_MAP: Record<string, string[]> = {
  Technology: ["AI capex", "data center", "AI chips"],
  Semiconductors: ["AI chips", "data center", "AI capex"],
  "Financial Services": ["Fed cuts 2026", "recession 2026", "bank deposits"],
  Energy: ["oil price 2026", "energy crisis"],
  Healthcare: ["FDA approval 2026", "drug pricing"],
  _default: ["S&P 500 2026", "recession 2026", "Fed cuts 2026"],
};

/** Resolve the backdrop themes for a company `sector` — an exact map hit, or
 *  the default macro themes for an unknown/unmapped/null sector. Provider
 *  `sector` fields are flat labels (e.g. `"Technology"`), so an exact lookup
 *  is enough; no fuzzy matching needed. */
export function themesForSector(sector: string | null | undefined): string[] {
  if (sector != null && SECTOR_THEME_MAP[sector] !== undefined) {
    return SECTOR_THEME_MAP[sector];
  }
  return SECTOR_THEME_MAP._default;
}

/** Coverage tier from the ticker markets alone — backdrop never counts. */
export function computeCoverageQuality(tickerMarkets: Market[]): "rich" | "thin" | "absent" {
  if (tickerMarkets.length === 0) return "absent";
  const liquidity = tickerMarkets.reduce((sum, m) => sum + m.liquidityUsd, 0);
  if (tickerMarkets.length >= RICH_MIN_MARKETS && liquidity >= RICH_MIN_LIQUIDITY_USD) {
    return "rich";
  }
  return "thin";
}

type RawMarket = {
  question?: string;
  slug?: string;
  outcomePrices?: string;
  outcomes?: string;
  lastTradePrice?: number;
  volume?: string | number;
  liquidity?: string | number;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
};

type RawEvent = { title?: string; markets?: RawMarket[] };

type SearchResponse = { events?: RawEvent[] };

/** Yes-side probability — prefer `outcomePrices[0]` (current bid-ask consensus)
 *  over `lastTradePrice` (which can be a stale single fill). */
function yesProb(m: RawMarket): number {
  if (typeof m.outcomePrices === "string") {
    try {
      const parsed = JSON.parse(m.outcomePrices) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const yes = Number(parsed[0]);
        if (Number.isFinite(yes)) return yes;
      }
    } catch {
      // fall through
    }
  }
  return typeof m.lastTradePrice === "number" ? m.lastTradePrice : 0;
}

function numberFrom(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function byLiquidityThenVolume(a: Market, b: Market): number {
  return b.liquidityUsd !== a.liquidityUsd
    ? b.liquidityUsd - a.liquidityUsd
    : b.volumeUsd - a.volumeUsd;
}

/** Run one Polymarket search, normalize, drop closed/inactive markets, and
 *  sort by liquidity (depth of conviction) desc with volume as tiebreak.
 *  Throws on a non-OK response so callers can decide whether to fail soft. */
async function queryMarkets(query: string): Promise<Market[]> {
  const url = new URL(POLY_SEARCH);
  url.searchParams.set("q", query);
  // Pull a fat upstream batch so we have headroom to filter and sort.
  url.searchParams.set("limit_per_type", "50");
  url.searchParams.set("events_status", "active");
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Polymarket: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as SearchResponse;

  const flat: Market[] = [];
  for (const event of data.events ?? []) {
    for (const m of event.markets ?? []) {
      if (m.active === false || m.closed === true) continue;
      if (!m.question || !m.slug || !m.endDate) continue;
      flat.push({
        question: m.question,
        eventTitle: event.title ?? null,
        yesProbability: yesProb(m),
        volumeUsd: numberFrom(m.volume),
        liquidityUsd: numberFrom(m.liquidity),
        endDate: m.endDate,
        slug: m.slug,
      });
    }
  }
  flat.sort(byLiquidityThenVolume);
  return flat;
}

/**
 * Fetch both coverage tiers. The ticker query is the primary signal and
 * propagates its error (so the handler can fall back to the empty payload);
 * backdrop theme queries fail soft (a single dead theme query shouldn't sink
 * the whole tool). Backdrop markets are merged across themes, deduped by slug,
 * and never include a slug already present in `tickerMarkets`.
 */
export async function fetchPolymarketTop(
  input: ToolInput<"get_prediction_markets">,
  themes: string[] = [],
  topN = DEFAULT_TOP_N,
): Promise<ToolOutput<"get_prediction_markets">> {
  const tickerMarkets = (await queryMarkets(input.ticker)).slice(0, topN);

  const backdropResults = await Promise.allSettled(
    themes.map((theme) => queryMarkets(theme)),
  );
  const seen = new Set(tickerMarkets.map((m) => m.slug));
  const merged: Market[] = [];
  for (const result of backdropResults) {
    if (result.status !== "fulfilled") continue;
    for (const market of result.value) {
      if (seen.has(market.slug)) continue;
      seen.add(market.slug);
      merged.push(market);
    }
  }
  merged.sort(byLiquidityThenVolume);

  return {
    source: "polymarket",
    ticker: input.ticker,
    asOf: input.date,
    tickerMarkets,
    backdropMarkets: merged.slice(0, BACKDROP_TOP_N),
    backdropTheme: themes.join(", "),
    coverageQuality: computeCoverageQuality(tickerMarkets),
  };
}

/** Best-effort sector → themes for live mode. A soft Yahoo profile fetch (it
 *  carries `sector`); any failure falls back to the default macro themes. */
async function resolveBackdropThemes(
  input: ToolInput<"get_prediction_markets">,
): Promise<string[]> {
  try {
    const profile = await fetchYahooCompanyProfile(input);
    return themesForSector(profile.sector);
  } catch {
    return themesForSector(null);
  }
}

export const get_prediction_markets = handler({
  name: "get_prediction_markets",
  description:
    "Two-tier Polymarket prediction markets for the ticker: direct ticker markets plus a sector/macro backdrop, each with a yes-side probability (0..1), liquidity, end date, and question text. Carries a deterministic coverageQuality tag (rich | thin | absent) so thin coverage degrades gracefully instead of manufacturing precision.",
  inputSchema: toolInputSchemas.get_prediction_markets,
  outputSchema: toolOutputSchemas.get_prediction_markets,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_prediction_markets", input, ctx, async () => {
      const themes = await resolveBackdropThemes(input);
      try {
        return await fetchPolymarketTop(input, themes);
      } catch {
        return emptyPayload("get_prediction_markets", input);
      }
    });
  },
});
