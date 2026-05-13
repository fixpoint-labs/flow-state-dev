/**
 * Price-history and indicator tool handlers used by the technical analyst.
 *
 * `get_price_history` is a thin read-through wrapper over the provider chain.
 *
 * `compute_indicators` is the interesting one: indicators are not *fetched*,
 * they're derived from OHLC bars. In live mode the handler pulls a 1-year
 * price history (via the same cache, so the technical analyst's prior
 * `get_price_history` call is reused when its range was already `1y`) and
 * computes RSI/MACD/ATR/SMA locally. In fixture mode it loads the curated
 * indicator fixture so the curated story stays consistent.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "./cache";
import {
  toolInputSchemas,
  toolOutputSchemas,
} from "./data-source";
import { FixtureDataSource } from "./fixture-data-source";
import { makeDataSource } from "./make-data-source";
import { marketDataResources } from "./market-data-resource";
import { computeIndicators, type Bar } from "./indicators-math";

function pickMode(ctx: { session: { state: Record<string, unknown> } }): "fixture" | "live" {
  return (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture";
}

export const get_price_history = handler({
  name: "get_price_history",
  description: "Daily OHLCV bars for a ticker over the requested range.",
  inputSchema: toolInputSchemas.get_price_history,
  outputSchema: toolOutputSchemas.get_price_history,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_price_history", input, () =>
      makeDataSource(pickMode(ctx)).get_price_history(input),
    ),
});

export const compute_indicators = handler({
  name: "compute_indicators",
  description: "RSI, MACD, ATR, SMA50/200, and trend label for a ticker.",
  inputSchema: toolInputSchemas.compute_indicators,
  outputSchema: toolOutputSchemas.compute_indicators,
  resources: marketDataResources,
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    if (mode === "fixture") {
      return getOrFetch(ctx, "compute_indicators", input, () =>
        new FixtureDataSource().compute_indicators(input),
      );
    }
    // Live mode: pull a 1-year price history (enough for SMA200) and compute
    // indicators locally. The cache key encodes the range, so this is a
    // distinct entry from any 1-month price-history call the technical
    // analyst may have already made.
    const priceInput = { ticker: input.ticker, date: input.date, range: "1y" as const };
    const prices = await getOrFetch(ctx, "get_price_history", priceInput, () =>
      makeDataSource(mode).get_price_history(priceInput),
    );
    // Cache the computed indicators separately so a second analyst that asks
    // for indicators doesn't redo the math (cheap, but cleaner).
    return getOrFetch(ctx, "compute_indicators", input, async () => {
      const computed = computeIndicators(prices.bars as Bar[]);
      // Inherit the provenance of the underlying bars so the transcript pill
      // tells the truth about where the signal ultimately came from.
      return {
        source: prices.source,
        ticker: input.ticker,
        asOf: input.date,
        ...computed,
      };
    });
  },
});
