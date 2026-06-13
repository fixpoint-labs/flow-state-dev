/**
 * Macro / geopolitical news for the Macro Analyst — a deterministic, always-on
 * headline pull from Finnhub's general + forex feeds. Unlike
 * `discover_macro_context` (cost-gated web discovery), this runs on every cost
 * preset, so the Macro memo always has a real macro/geopolitical read even when
 * FRED is unavailable or web discovery is skipped.
 *
 * Market-wide (not ticker-scoped), so the payload carries no `ticker` and the
 * fixture lives under the `_macro` sentinel directory (date-only input) — same
 * convention as `get_macro_indicators` and `get_market_news`.
 */
import { handler } from "@flow-state-dev/core";
import { analysisCache } from "../../../shared/cache-capability";
import { fetchFinnhubMacroNews, hasFinnhubKey } from "../providers/finnhub";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_macro_news = handler({
  name: "get_macro_news",
  description:
    "Recent macro/geopolitical news headlines (general + forex, market-wide). " +
    "Always on, not gated by cost preset — complements discover_macro_context.",
  inputSchema: toolInputSchemas.get_macro_news,
  outputSchema: toolOutputSchemas.get_macro_news,
  uses: [analysisCache],
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_macro_news", input);
    return ctx.cap.cache.getOrFetch("get_macro_news", input, async () => {
      if (hasFinnhubKey()) {
        try {
          return await fetchFinnhubMacroNews(input);
        } catch {}
      }
      return emptyPayload("get_macro_news", input);
    });
  },
});
