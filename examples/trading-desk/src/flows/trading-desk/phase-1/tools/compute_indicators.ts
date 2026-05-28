/**
 * Technical indicators (RSI, MACD, ATR, SMA50/200, trend label).
 *
 * Not fetched — derived locally from OHLC bars. In live mode the handler
 * pulls a 1-year price history (cache-keyed by range, so it doesn't collide
 * with any 30-day fetch the technical analyst already made) and runs the
 * math. In fixture mode it loads the curated indicator fixture.
 *
 * Source tag inherits the provenance of the underlying bars so the
 * transcript pill tells the truth about where the signal ultimately came
 * from.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { loadFixture } from "../../lib/fixtures";
import { fetchYahooChart } from "../../providers/yahoo";
import { fetchFinnhubCandles, hasFinnhubKey } from "../../providers/finnhub";
import { emptyPayload } from "./empty-payloads";
import { computeIndicators, type Bar } from "./indicators-math";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const compute_indicators = handler({
  name: "compute_indicators",
  description: "RSI, MACD, ATR, SMA50/200, and trend label for a ticker.",
  inputSchema: toolInputSchemas.compute_indicators,
  outputSchema: toolOutputSchemas.compute_indicators,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("compute_indicators", input);
    return getOrFetch("compute_indicators", input, async () => {
      const priceInput = { ticker: input.ticker, date: input.date, range: "1y" as const };
      const prices = await getOrFetch("get_price_history", priceInput, async () => {
        if (hasFinnhubKey()) {
          try { return await fetchFinnhubCandles(priceInput); } catch {}
        }
        try { return await fetchYahooChart(priceInput); } catch {}
        return emptyPayload("get_price_history", priceInput);
      });
      const computed = computeIndicators(prices.bars as Bar[]);
      return {
        source: prices.source,
        ticker: input.ticker,
        asOf: input.date,
        ...computed,
      };
    });
  },
});
