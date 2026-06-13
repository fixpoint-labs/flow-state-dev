/**
 * Daily OHLCV bars. Live: Finnhub `/stock/candle` preferred, Yahoo `chart`
 * fallback. Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { fetchFinnhubCandles, hasFinnhubKey } from "../providers/finnhub";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchYahooChart } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_price_history = handler({
  name: "get_price_history",
  description: "Daily OHLCV bars for a ticker over the requested range.",
  inputSchema: toolInputSchemas.get_price_history,
  outputSchema: toolOutputSchemas.get_price_history,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_price_history", input, ctx, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubCandles(input); } catch {}
      }
      try { return await fetchYahooChart(input); } catch {}
      return emptyPayload("get_price_history", input);
    });
  },
});
