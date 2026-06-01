/**
 * Shared discovery helper for Phase 1 investigative analysts.
 *
 * Wraps the `@flow-state-dev/tools/search` resolver, formats the response
 * into the trading-desk `DiscoveryPayload` shape, numbers items so the
 * analyst LLM can reference them when populating citations, and tags
 * every item with the search provider that produced it.
 *
 * Provider auto-detection follows the resolver's priority order
 * (Tavily → Exa → Perplexity → Serper → Brave → Perplexity-Sonar); the
 * first provider with a configured env var wins. When no provider is
 * configured, `resolveProvider` throws — since this function is `async`,
 * that becomes a promise rejection and the caller's try/catch handles it
 * (the per-tool body returns `emptyPayload(...)` tagged `"unavailable"`,
 * per BP-020).
 *
 * Reference implementation for the same call pattern lives at
 * `providers/web.ts:searchCompanyWeb` (used by the Company Profile
 * analyst's web-enrichment backstop).
 */
import { resolveProvider } from "@flow-state-dev/tools/search";
import type { DiscoveryPayload } from "../phase-1/tools/schemas";

const MAX_ITEMS = 5;

/** Per-role query templates. Each one composes a generic web-search query
 *  appropriate to what the analyst is most likely to need investigative
 *  context for. Kept as a small inlined set rather than a strategy
 *  pattern — per-analyst tool files are the seam where provider-specific
 *  endpoints (SEC EDGAR, Finnhub extended news, etc.) can drop in later. */
export const FUNDAMENTALS_QUERY = (ticker: string): string =>
  `${ticker} earnings guidance management commentary business mix segment`;

export const SENTIMENT_QUERY = (ticker: string): string =>
  `${ticker} retail investor sentiment forum stocktwits seekingalpha`;

export const TECHNICAL_QUERY = (ticker: string): string =>
  `${ticker} technical analysis chart breakout support resistance`;

export const PROFILE_QUERY = (ticker: string): string =>
  `${ticker} recent strategic announcement product launch regulatory filing`;

export const MARKET_QUERY = (ticker: string): string =>
  `${ticker} sector outlook peer earnings rotation theme regulatory supply chain`;

export const MACRO_QUERY = (ticker: string): string =>
  `${ticker} macro economic outlook rates inflation geopolitical risk tariff trade policy central bank`;

export const QUANT_QUERY = (ticker: string): string =>
  `${ticker} factor momentum short interest options implied volatility quant signal beta`;

export type DiscoverWebArgs = {
  ticker: string;
  date: string;
  queryTemplate: (ticker: string) => string;
};

/**
 * Run a single web-search call and shape the response into a
 * `DiscoveryPayload`. Returns `source: "web"` even when the search yields
 * zero results — the analyst-side handling for empty `items` is the same
 * as for `"skipped"`, so the distinction is preserved for the audit trail.
 */
export async function discoverWeb(args: DiscoverWebArgs): Promise<DiscoveryPayload> {
  const { adapter, apiKey } = resolveProvider({});
  const query = args.queryTemplate(args.ticker);
  const output = await adapter.search(query, {
    maxResults: MAX_ITEMS,
    searchDepth: "basic",
    topic: "general",
    apiKey,
  });
  return {
    source: "web",
    ticker: args.ticker,
    asOf: args.date,
    query,
    items: output.results.slice(0, MAX_ITEMS).map((r, i) => ({
      id: String(i + 1),
      url: r.url,
      title: r.title,
      // `searchResultSchema.snippet` is required upstream, but coerce any
      // falsy slip-through to empty string to keep our schema clean.
      snippet: r.snippet ?? "",
      publisher: extractDomain(r.url),
      provider: r.source,
    })),
  };
}

/** Best-effort domain extraction. Returns null on URL parse failure so
 *  malformed entries don't poison the analyst's view of the source list. */
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
