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
import { fetchFinnhubMarketNews, hasFinnhubKey } from "@/lib/providers/finnhub";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_market_news = handler({
  name: "get_market_news",
  description:
    "Recent general market-news headlines (market-wide, not ticker-specific).",
  inputSchema: toolInputSchemas.get_market_news,
  outputSchema: toolOutputSchemas.get_market_news,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_market_news", input, ctx, async () => {
      if (hasFinnhubKey()) {
        try {
          return await fetchFinnhubMarketNews(input);
        } catch {}
      }
      return emptyPayload("get_market_news", input);
    });
  },
});
