/**
 * Daily OHLCV bars. Live: Finnhub `/stock/candle` preferred, Yahoo `chart`
 * fallback. Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { analysisCache } from "../../../shared/cache-capability";
import { fetchFinnhubCandles, hasFinnhubKey } from "../providers/finnhub";
import { loadFixture } from "../runtime/fixtures";
import { fetchYahooChart } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_price_history = handler({
  name: "get_price_history",
  description: "Daily OHLCV bars for a ticker over the requested range.",
  inputSchema: toolInputSchemas.get_price_history,
  outputSchema: toolOutputSchemas.get_price_history,
  uses: [analysisCache],
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_price_history", input);
    return ctx.cap.cache.getOrFetch("get_price_history", input, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubCandles(input); } catch {}
      }
      try { return await fetchYahooChart(input); } catch {}
      return emptyPayload("get_price_history", input);
    });
  },
});
