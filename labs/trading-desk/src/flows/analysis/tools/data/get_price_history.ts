/**
 * Daily OHLCV bars. Live: Finnhub `/stock/candle` preferred, Yahoo `chart`
 * fallback. Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { fetchFinnhubCandles, hasFinnhubKey } from "../providers/finnhub";
import { loadFixture } from "../runtime/fixtures";
import { fetchYahooChart } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import { technicalDataResource, SUMMARY_PRICE_RANGE } from "../../technical-data-resource";

export const get_price_history = handler({
  name: "get_price_history",
  description: "Daily OHLCV bars for a ticker over the requested range.",
  inputSchema: toolInputSchemas.get_price_history,
  outputSchema: toolOutputSchemas.get_price_history,
  resources: { technicalData: technicalDataResource },
  // Mirror ONLY the subject's canonical summary-range series to the session
  // technical spine — that's the series `store-price-history` reads. Every other
  // (ticker, range) — the internal 1-year windows `compute_indicators` /
  // `get_factor_ranks` pull, and peer/benchmark charts — is args-keyed and stays
  // on the process cache; a single named spine field can't hold them all.
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    const loadPriceBars = async () => {
      if (mode === "fixture") return loadFixture("get_price_history", input);
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubCandles(input); } catch {}
      }
      try { return await fetchYahooChart(input); } catch {}
      return emptyPayload("get_price_history", input);
    };
    const isSubject = input.ticker === (ctx.session.state as { ticker?: string }).ticker;
    if (!isSubject || input.range !== SUMMARY_PRICE_RANGE) {
      return getOrFetch("get_price_history", input, loadPriceBars);
    }
    return (await ctx.resources.technicalData.getOrPatchState("priceBars", loadPriceBars))!;
  },
});
