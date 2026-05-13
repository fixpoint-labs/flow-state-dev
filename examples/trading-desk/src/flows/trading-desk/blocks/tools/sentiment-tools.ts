/**
 * Social-sentiment tool handlers used by the sentiment analyst. Read-through
 * the `marketdata` cache before hitting the underlying provider chain.
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

export const get_social_sentiment = handler({
  name: "get_social_sentiment",
  description: "7-day social-sentiment score and short-interest signal.",
  inputSchema: toolInputSchemas.get_social_sentiment,
  outputSchema: toolOutputSchemas.get_social_sentiment,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_social_sentiment", input, () =>
      makeDataSource(pickMode(ctx)).get_social_sentiment(input),
    ),
});

export const get_reddit_mentions = handler({
  name: "get_reddit_mentions",
  description: "Recent Reddit mentions and top threads for a ticker.",
  inputSchema: toolInputSchemas.get_reddit_mentions,
  outputSchema: toolOutputSchemas.get_reddit_mentions,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_reddit_mentions", input, () =>
      makeDataSource(pickMode(ctx)).get_reddit_mentions(input),
    ),
});

export const get_prediction_markets = handler({
  name: "get_prediction_markets",
  description:
    "Top 10 active Polymarket prediction markets matching the ticker. Each market has a yes-side probability (0..1), liquidity, end date, and question text — real money is staked, so it's a high-signal alternative to social-media sentiment.",
  inputSchema: toolInputSchemas.get_prediction_markets,
  outputSchema: toolOutputSchemas.get_prediction_markets,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_prediction_markets", input, () =>
      makeDataSource(pickMode(ctx)).get_prediction_markets(input),
    ),
});
