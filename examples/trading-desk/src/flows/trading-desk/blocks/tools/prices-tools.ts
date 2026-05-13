/**
 * Price-history and indicator tool handlers used by the technical analyst.
 * Read-through the `marketdata` cache before hitting the underlying provider
 * chain. See `cache.ts` for the layering rationale.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "./cache";
import {
  toolInputSchemas,
  toolOutputSchemas,
} from "./data-source";
import { makeDataSource } from "./make-data-source";
import { marketDataResources } from "./market-data-resource";

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
  execute: async (input, ctx) =>
    getOrFetch(ctx, "compute_indicators", input, () =>
      makeDataSource(pickMode(ctx)).compute_indicators(input),
    ),
});
