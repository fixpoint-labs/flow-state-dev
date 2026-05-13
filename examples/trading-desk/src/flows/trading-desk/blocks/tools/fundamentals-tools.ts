/**
 * Fundamentals tool handlers — balance sheet, income statement, cash flow,
 * fundamentals snapshot. Each tool is a thin handler that reads through the
 * `marketdata` resource cache (so the four analysts dedupe overlapping
 * requests), then delegates to the configured `DataSource` (fixture-only or
 * Finnhub→Yahoo→Fixture chain) on a miss.
 *
 * Handlers read `ctx.session.state.dataSource` so a mid-run flip cannot
 * interleave fixture and live results within the same analyst's tool calls.
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

export const get_balance_sheet = handler({
  name: "get_balance_sheet",
  description: "Latest balance sheet for a ticker (totals only).",
  inputSchema: toolInputSchemas.get_balance_sheet,
  outputSchema: toolOutputSchemas.get_balance_sheet,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_balance_sheet", input, () =>
      makeDataSource(pickMode(ctx)).get_balance_sheet(input),
    ),
});

export const get_income_statement = handler({
  name: "get_income_statement",
  description: "Trailing income statement for a ticker.",
  inputSchema: toolInputSchemas.get_income_statement,
  outputSchema: toolOutputSchemas.get_income_statement,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_income_statement", input, () =>
      makeDataSource(pickMode(ctx)).get_income_statement(input),
    ),
});

export const get_cashflow = handler({
  name: "get_cashflow",
  description: "Trailing cash-flow statement for a ticker.",
  inputSchema: toolInputSchemas.get_cashflow,
  outputSchema: toolOutputSchemas.get_cashflow,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_cashflow", input, () =>
      makeDataSource(pickMode(ctx)).get_cashflow(input),
    ),
});

export const get_fundamentals = handler({
  name: "get_fundamentals",
  description: "Snapshot of valuation, growth, margins for a ticker.",
  inputSchema: toolInputSchemas.get_fundamentals,
  outputSchema: toolOutputSchemas.get_fundamentals,
  resources: marketDataResources,
  execute: async (input, ctx) =>
    getOrFetch(ctx, "get_fundamentals", input, () =>
      makeDataSource(pickMode(ctx)).get_fundamentals(input),
    ),
});
