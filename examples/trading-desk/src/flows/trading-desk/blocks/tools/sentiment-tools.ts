/**
 * Social-sentiment tool handlers used by the sentiment analyst.
 */
import { handler } from "@flow-state-dev/core";
import {
  toolInputSchemas,
  toolOutputSchemas,
} from "./data-source";
import { makeDataSource } from "./make-data-source";

export const get_social_sentiment = handler({
  name: "get_social_sentiment",
  description: "7-day social-sentiment score and short-interest signal.",
  inputSchema: toolInputSchemas.get_social_sentiment,
  outputSchema: toolOutputSchemas.get_social_sentiment,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_social_sentiment(input);
  },
});

export const get_reddit_mentions = handler({
  name: "get_reddit_mentions",
  description: "Recent Reddit mentions and top threads for a ticker.",
  inputSchema: toolInputSchemas.get_reddit_mentions,
  outputSchema: toolOutputSchemas.get_reddit_mentions,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_reddit_mentions(input);
  },
});
