/**
 * Empty schema-valid payloads tagged `source: "unavailable"`.
 *
 * Returned by tools in live mode when no provider can answer (either because
 * none is wired or because every wired provider failed). The analyst sees
 * explicit zeros / empty arrays and the transcript pill marks the result as
 * unavailable — honest about coverage, no false fixture data masquerading as
 * live data.
 */
import type { ToolInput, ToolName, ToolOutput } from "./schemas";

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
    bollinger: { upper: 0, middle: 0, lower: 0 },
    vwma20: 0,
    stoch: { k: 0, d: 0 },
    kdj: { k: 0, d: 0, j: 0 },
    obv: 0,
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
    shortInterestPct: null,
    posts: [],
  }),
  get_reddit_mentions: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    mentions7d: 0,
    topThreads: [],
  }),
  get_prediction_markets: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    tickerMarkets: [],
    backdropMarkets: [],
    backdropTheme: "",
    coverageQuality: "absent",
  }),
  get_insider_transactions: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    transactions: [],
    windowDays: 90,
  }),
  get_company_profile: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    name: "",
    sector: null,
    industry: null,
    country: null,
    exchange: null,
    currency: null,
    businessDescription: null,
    marketCapUsd: null,
    employees: null,
    ipoDate: null,
    website: null,
    websiteMetaDescription: null,
    searchSnippets: null,
  }),
  discover_fundamentals_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    query: "",
    items: [],
  }),
  discover_sentiment_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    query: "",
    items: [],
  }),
  discover_technical_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    query: "",
    items: [],
  }),
  discover_profile_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    query: "",
    items: [],
  }),
};

export function emptyPayload<T extends ToolName>(tool: T, input: ToolInput<T>): ToolOutput<T> {
  return (builders[tool] as EmptyBuilder<T>)(input);
}

/**
 * Discovery-only cost-gated form: an empty discovery payload tagged
 * `source: "skipped"` rather than `"unavailable"`. Used by the four
 * `discover_*_context` tools when `costPreset !== "full"` to communicate to
 * downstream analysts that investigation was deliberately not run on this
 * preset, distinct from "tried and failed".
 */
type DiscoveryTool =
  | "discover_fundamentals_context"
  | "discover_sentiment_context"
  | "discover_technical_context"
  | "discover_profile_context";

export function skippedDiscoveryPayload<T extends DiscoveryTool>(
  tool: T,
  input: ToolInput<T>,
): ToolOutput<T> {
  return { ...emptyPayload(tool, input), source: "skipped" } as ToolOutput<T>;
}
