/**
 * Recent general market-news headlines — market-wide, not ticker-scoped.
 * Live: Finnhub `/news?category=general`. Fixture: curated snapshot under
 * the ticker-agnostic `_macro` sentinel directory (date-only input, like
 * `get_macro_indicators`).
 *
 * Feeds the Market Analyst's "Theme & catalysts" lane. The feed is broad
 * (it includes macro/geopolitics headlines); the analyst prompt — not this
 * tool — narrows it to sector/theme-relevant signal.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { fetchFinnhubMarketNews, hasFinnhubKey } from "../../providers/finnhub";
import { loadFixture } from "../../lib/fixtures";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_market_news = handler({
  name: "get_market_news",
  description:
    "Recent general market-news headlines (market-wide, not ticker-specific).",
  inputSchema: toolInputSchemas.get_market_news,
  outputSchema: toolOutputSchemas.get_market_news,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_market_news", input);
    return getOrFetch("get_market_news", input, async () => {
      if (hasFinnhubKey()) {
        try {
          return await fetchFinnhubMarketNews(input);
        } catch {}
      }
      return emptyPayload("get_market_news", input);
    });
  },
});
