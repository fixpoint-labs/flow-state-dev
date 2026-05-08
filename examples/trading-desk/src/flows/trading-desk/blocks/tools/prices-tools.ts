/**
 * Price-history and indicator tool handlers used by the technical analyst.
 */
import { handler } from "@flow-state-dev/core";
import {
  toolInputSchemas,
  toolOutputSchemas,
} from "./data-source";
import { makeDataSource } from "./make-data-source";

export const get_price_history = handler({
  name: "get_price_history",
  description: "Daily OHLCV bars for a ticker over the requested range.",
  inputSchema: toolInputSchemas.get_price_history,
  outputSchema: toolOutputSchemas.get_price_history,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_price_history(input);
  },
});

export const compute_indicators = handler({
  name: "compute_indicators",
  description: "RSI, MACD, ATR, SMA50/200, and trend label for a ticker.",
  inputSchema: toolInputSchemas.compute_indicators,
  outputSchema: toolOutputSchemas.compute_indicators,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.compute_indicators(input);
  },
});
