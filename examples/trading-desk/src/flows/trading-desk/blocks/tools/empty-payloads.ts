/**
 * Empty payloads for live-mode unavailability.
 *
 * When live mode is selected but no provider can answer a given tool, we emit
 * a schema-valid skeleton tagged `source: "unavailable"` rather than falling
 * back to fixture. The analyst sees explicit zeros / empty arrays and the
 * transcript pill marks the tool result as unavailable, which is honest about
 * the run's actual coverage. Fixture-mode behavior is unchanged.
 */
import type { ToolInput, ToolName, ToolOutput } from "./data-source";

type EmptyBuilder<T extends ToolName> = (input: ToolInput<T>) => ToolOutput<T>;

const builders: { [K in ToolName]: EmptyBuilder<K> } = {
  get_balance_sheet: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    cashAndEquivalents: 0,
    totalDebt: 0,
    unit: "USD billions",
  }),
  get_income_statement: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    revenue: 0,
    grossProfit: 0,
    operatingIncome: 0,
    netIncome: 0,
    yoyRevenueGrowth: 0,
    unit: "USD billions",
  }),
  get_cashflow: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    operating: 0,
    investing: 0,
    financing: 0,
    freeCashFlow: 0,
    unit: "USD billions",
  }),
  get_fundamentals: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    marketCap: 0,
    forwardPE: 0,
    priceToSales: 0,
    returnOnEquity: 0,
    operatingMargin: 0,
    grossMargin: 0,
  }),
  get_price_history: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    range: i.range ?? "1mo",
    bars: [],
  }),
  compute_indicators: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    rsi14: 0,
    macd: { line: 0, signal: 0, histogram: 0 },
    atr14: 0,
    trend: "flat",
    sma50: 0,
    sma200: 0,
  }),
  search_news: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    items: [],
  }),
  get_macro_indicators: (i) => ({
    source: "unavailable",
    asOf: i.date,
    cpiYoy: 0,
    unemployment: 0,
    fedFundsRate: 0,
    tenYearYield: 0,
    oilWtiUsd: 0,
  }),
  get_social_sentiment: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    score7d: 0,
    positive: 0,
    negative: 0,
    neutral: 0,
    shortInterestPct: 0,
  }),
  get_reddit_mentions: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    mentions7d: 0,
    topThreads: [],
  }),
};

export function emptyPayload<T extends ToolName>(tool: T, input: ToolInput<T>): ToolOutput<T> {
  return (builders[tool] as EmptyBuilder<T>)(input);
}
