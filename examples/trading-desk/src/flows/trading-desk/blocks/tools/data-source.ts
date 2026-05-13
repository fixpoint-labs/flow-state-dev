/**
 * `DataSource` interface and per-tool schemas.
 *
 * The interface is the seam between the analyst tool blocks and the actual
 * data: a hand-curated `FixtureDataSource`, a `YahooDataSource` wrapping
 * `yahoo-finance2` v3, and a `FinnhubDataSource` hitting the Finnhub REST
 * API. A `MultiSourceDataSource` chains them as Finnhub → Yahoo → Fixture
 * (fixture is the always-succeeds floor). Each tool returns canonical-shape
 * JSON plus a `source: "fixture" | "yahoo" | "finnhub"` tag identifying the
 * concrete provider that answered.
 */
import { z } from "zod";

export type DataSourceMode = "fixture" | "live";

export class FixtureMissingError extends Error {
  readonly ticker: string;
  readonly date: string;
  readonly tool: string;
  constructor(tool: string, ticker: string, date: string) {
    super(`Missing fixture for ${tool} (ticker=${ticker}, date=${date})`);
    this.name = "FixtureMissingError";
    this.tool = tool;
    this.ticker = ticker;
    this.date = date;
  }
}

/**
 * Provenance tag stamped on every tool output. Distinct from the session-state
 * `dataSource` enum (`"fixture" | "live"`) — that picks the upstream *strategy*,
 * while this tag identifies the *concrete provider* that answered.
 *
 *   - `"fixture"`     — only emitted in fixture mode.
 *   - `"finnhub"`     — live mode, Finnhub answered.
 *   - `"yahoo"`       — live mode, Yahoo answered (Finnhub absent or failed).
 *   - `"fred"`        — live mode, FRED API answered (macro indicators).
 *   - `"polymarket"`  — live mode, Polymarket Gamma API answered (prediction
 *                       markets).
 *   - `"unavailable"` — live mode, no provider could answer; payload is an
 *                       empty/zeroed schema-valid skeleton. **Never falls
 *                       back to fixture data in live mode** — serving stale
 *                       fixture as if it were live is worse than no data.
 */
const sourceTag = z.enum([
  "fixture",
  "yahoo",
  "finnhub",
  "fred",
  "polymarket",
  "unavailable",
]);
export type SourceTag = z.infer<typeof sourceTag>;

const periodInput = z.object({
  ticker: z.string().min(1),
  date: z.string().min(1),
});

export const balanceSheetSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  totalAssets: z.number(),
  totalLiabilities: z.number(),
  totalEquity: z.number(),
  cashAndEquivalents: z.number(),
  totalDebt: z.number(),
  unit: z.string().default("USD billions"),
});

export const incomeStatementSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  revenue: z.number(),
  grossProfit: z.number(),
  operatingIncome: z.number(),
  netIncome: z.number(),
  yoyRevenueGrowth: z.number(),
  unit: z.string().default("USD billions"),
});

export const cashflowSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  operating: z.number(),
  investing: z.number(),
  financing: z.number(),
  freeCashFlow: z.number(),
  unit: z.string().default("USD billions"),
});

export const fundamentalsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  marketCap: z.number(),
  forwardPE: z.number(),
  priceToSales: z.number(),
  returnOnEquity: z.number(),
  operatingMargin: z.number(),
  grossMargin: z.number(),
});

const priceBar = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export const priceHistorySchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  range: z.string(),
  bars: z.array(priceBar),
});

export const indicatorsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  rsi14: z.number(),
  macd: z.object({ line: z.number(), signal: z.number(), histogram: z.number() }),
  atr14: z.number(),
  trend: z.enum(["up", "down", "flat"]),
  sma50: z.number(),
  sma200: z.number(),
});

const newsItem = z.object({
  date: z.string(),
  headline: z.string(),
  source: z.string(),
  url: z.string().optional(),
  category: z.string().optional(),
});

export const companyNewsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  items: z.array(newsItem),
});

export const macroIndicatorsSchema = z.object({
  source: sourceTag,
  asOf: z.string(),
  cpiYoy: z.number(),
  unemployment: z.number(),
  fedFundsRate: z.number(),
  tenYearYield: z.number(),
  oilWtiUsd: z.number(),
});

export const socialSentimentSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  score7d: z.number(),
  positive: z.number(),
  negative: z.number(),
  neutral: z.number(),
  shortInterestPct: z.number(),
});

const predictionMarket = z.object({
  question: z.string(),
  eventTitle: z.string().nullable(),
  /** Yes-side probability (0..1). Derived from `outcomePrices[0]` when present,
   *  else falls back to `lastTradePrice`. */
  yesProbability: z.number(),
  volumeUsd: z.number(),
  liquidityUsd: z.number(),
  /** ISO date when the market resolves. Imminent end-dates carry the strongest
   *  signal — a 99% market that resolves tomorrow is near-certain. */
  endDate: z.string(),
  slug: z.string(),
});

export const predictionMarketsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  markets: z.array(predictionMarket),
});

const redditMention = z.object({
  subreddit: z.string(),
  title: z.string(),
  score: z.number(),
  url: z.string().optional(),
});

export const redditMentionsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  mentions7d: z.number(),
  topThreads: z.array(redditMention),
});

export const toolInputSchemas = {
  get_balance_sheet: periodInput,
  get_income_statement: periodInput,
  get_cashflow: periodInput,
  get_fundamentals: periodInput,
  get_price_history: periodInput.extend({ range: z.string().default("1mo") }),
  compute_indicators: periodInput,
  search_news: periodInput,
  get_macro_indicators: z.object({ date: z.string().min(1) }),
  get_social_sentiment: periodInput,
  get_reddit_mentions: periodInput,
  get_prediction_markets: periodInput,
} as const;

export const toolOutputSchemas = {
  get_balance_sheet: balanceSheetSchema,
  get_income_statement: incomeStatementSchema,
  get_cashflow: cashflowSchema,
  get_fundamentals: fundamentalsSchema,
  get_price_history: priceHistorySchema,
  compute_indicators: indicatorsSchema,
  search_news: companyNewsSchema,
  get_macro_indicators: macroIndicatorsSchema,
  get_social_sentiment: socialSentimentSchema,
  get_reddit_mentions: redditMentionsSchema,
  get_prediction_markets: predictionMarketsSchema,
} as const;

export type ToolName = keyof typeof toolInputSchemas;

export type ToolInput<T extends ToolName> = z.infer<(typeof toolInputSchemas)[T]>;
export type ToolOutput<T extends ToolName> = z.infer<(typeof toolOutputSchemas)[T]>;

export interface DataSource {
  readonly mode: DataSourceMode;
  get_balance_sheet(input: ToolInput<"get_balance_sheet">): Promise<ToolOutput<"get_balance_sheet">>;
  get_income_statement(input: ToolInput<"get_income_statement">): Promise<ToolOutput<"get_income_statement">>;
  get_cashflow(input: ToolInput<"get_cashflow">): Promise<ToolOutput<"get_cashflow">>;
  get_fundamentals(input: ToolInput<"get_fundamentals">): Promise<ToolOutput<"get_fundamentals">>;
  get_price_history(input: ToolInput<"get_price_history">): Promise<ToolOutput<"get_price_history">>;
  compute_indicators(input: ToolInput<"compute_indicators">): Promise<ToolOutput<"compute_indicators">>;
  search_news(input: ToolInput<"search_news">): Promise<ToolOutput<"search_news">>;
  get_macro_indicators(input: ToolInput<"get_macro_indicators">): Promise<ToolOutput<"get_macro_indicators">>;
  get_social_sentiment(input: ToolInput<"get_social_sentiment">): Promise<ToolOutput<"get_social_sentiment">>;
  get_reddit_mentions(input: ToolInput<"get_reddit_mentions">): Promise<ToolOutput<"get_reddit_mentions">>;
  get_prediction_markets(input: ToolInput<"get_prediction_markets">): Promise<ToolOutput<"get_prediction_markets">>;
}

const TOOL_FILE_NAMES: Record<ToolName, string> = {
  get_balance_sheet: "balance-sheet.json",
  get_income_statement: "income-statement.json",
  get_cashflow: "cashflow.json",
  get_fundamentals: "fundamentals.json",
  get_price_history: "prices.json",
  compute_indicators: "indicators.json",
  search_news: "company-news.json",
  get_macro_indicators: "macro-indicators.json",
  get_social_sentiment: "social-sentiment.json",
  get_reddit_mentions: "reddit-mentions.json",
  get_prediction_markets: "prediction-markets.json",
};

export function fixtureFileName(tool: ToolName): string {
  return TOOL_FILE_NAMES[tool];
}
