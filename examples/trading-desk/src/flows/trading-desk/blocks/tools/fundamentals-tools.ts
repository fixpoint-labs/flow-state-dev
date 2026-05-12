/**
 * Fundamentals tool handlers — balance sheet, income statement, cash flow,
 * fundamentals snapshot. Each tool is a thin handler that delegates to the
 * configured `DataSource` (fixture or live).
 *
 * The handlers read `ctx.session.state.dataSource` so a mid-run flip cannot
 * interleave fixture and live results within the same analyst's tool calls.
 */
import { handler } from "@flow-state-dev/core";
import {
  toolInputSchemas,
  toolOutputSchemas,
} from "./data-source";
import { makeDataSource } from "./make-data-source";

export const get_balance_sheet = handler({
  name: "get_balance_sheet",
  description: "Latest balance sheet for a ticker (totals only).",
  inputSchema: toolInputSchemas.get_balance_sheet,
  outputSchema: toolOutputSchemas.get_balance_sheet,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_balance_sheet(input);
  },
});

export const get_income_statement = handler({
  name: "get_income_statement",
  description: "Trailing income statement for a ticker.",
  inputSchema: toolInputSchemas.get_income_statement,
  outputSchema: toolOutputSchemas.get_income_statement,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_income_statement(input);
  },
});

export const get_cashflow = handler({
  name: "get_cashflow",
  description: "Trailing cash-flow statement for a ticker.",
  inputSchema: toolInputSchemas.get_cashflow,
  outputSchema: toolOutputSchemas.get_cashflow,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_cashflow(input);
  },
});

export const get_fundamentals = handler({
  name: "get_fundamentals",
  description: "Snapshot of valuation, growth, margins for a ticker.",
  inputSchema: toolInputSchemas.get_fundamentals,
  outputSchema: toolOutputSchemas.get_fundamentals,
  execute: async (input, ctx) => {
    const source = makeDataSource(
      (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture",
    );
    return source.get_fundamentals(input);
  },
});
