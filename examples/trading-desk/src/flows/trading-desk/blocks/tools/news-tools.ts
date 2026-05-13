/**
 * News tool handlers used by the news analyst. Read-through the `marketdata`
 * cache before hitting the underlying provider chain.
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

export const search_news = handler({
  name: "search_news",
  description: "Recent company-relevant news headlines for a ticker.",
  inputSchema: toolInputSchemas.search_news,
  outputSchema: toolOutputSchemas.search_news,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "search_news", input, () =>
      makeDataSource(pickMode(ctx)).search_news(input),
    ),
});

export const get_macro_indicators = handler({
  name: "get_macro_indicators",
  description: "CPI, unemployment, fed-funds, 10y yield, oil — date-keyed snapshot.",
  inputSchema: toolInputSchemas.get_macro_indicators,
  outputSchema: toolOutputSchemas.get_macro_indicators,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_macro_indicators", input, () =>
      makeDataSource(pickMode(ctx)).get_macro_indicators(input),
    ),
});
