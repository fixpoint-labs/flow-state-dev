/**
 * Daily OHLCV bars. Live: Finnhub `/stock/candle` preferred, Yahoo `chart`
 * fallback. Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../services/cache";
import { fetchFinnhubCandles, hasFinnhubKey } from "../../services/finnhub";
import { loadFixture } from "../../services/fixtures";
import { fetchYahooChart } from "../../services/yahoo";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_price_history = handler({
  name: "get_price_history",
  description: "Daily OHLCV bars for a ticker over the requested range.",
  inputSchema: toolInputSchemas.get_price_history,
  outputSchema: toolOutputSchemas.get_price_history,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_price_history", input);
    return getOrFetch("get_price_history", input, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubCandles(input); } catch {}
      }
      try { return await fetchYahooChart(input); } catch {}
      return emptyPayload("get_price_history", input);
    });
  },
});
