/**
 * News tool handlers used by the news analyst.
 */
import { handler } from "@flow-state-dev/core";
import {
  toolInputSchemas,
  toolOutputSchemas,
} from "./data-source";
import { makeDataSource } from "./make-data-source";

export const search_news = handler({
  name: "search_news",
  description: "Recent company-relevant news headlines for a ticker.",
  inputSchema: toolInputSchemas.search_news,
  outputSchema: toolOutputSchemas.search_news,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.search_news(input);
  },
});

export const get_macro_indicators = handler({
  name: "get_macro_indicators",
  description: "CPI, unemployment, fed-funds, 10y yield, oil — date-keyed snapshot.",
  inputSchema: toolInputSchemas.get_macro_indicators,
  outputSchema: toolOutputSchemas.get_macro_indicators,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_macro_indicators(input);
  },
});
