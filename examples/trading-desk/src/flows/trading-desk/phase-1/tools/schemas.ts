/**
 * Shared tool input/output schemas + the `ToolName` union.
 *
 * Each Phase 1 tool has a fixed shape that all providers normalize to: a
 * `source` provenance tag plus the canonical fields the analyst prompts
 * expect. Splitting these out of the tool files keeps each tool file focused
 * on dispatch logic (fixture vs. live, provider preference).
 */
import { z } from "zod";

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
 * Provenance tag stamped on every tool output. The session-state `dataSource`
 * enum picks the *strategy*; this tag identifies the *concrete provider*.
 *
 *   - `"fixture"`     — only emitted in fixture mode.
 *   - `"finnhub"`     — live mode, Finnhub answered.
 *   - `"yahoo"`       — live mode, Yahoo answered.
 *   - `"fred"`        — live mode, FRED API answered.
 *   - `"polymarket"`  — live mode, Polymarket Gamma API answered.
 *   - `"unavailable"` — live mode, no provider could answer; payload is an
 *                       empty/zeroed schema-valid skeleton. Never silently
 *                       substitutes fixture data — false data is worse than
 *                       no data for analyst reasoning.
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
  bollinger: z.object({ upper: z.number(), middle: z.number(), lower: z.number() }),
  vwma20: z.number(),
  stoch: z.object({ k: z.number(), d: z.number() }),
  kdj: z.object({ k: z.number(), d: z.number(), j: z.number() }),
  obv: z.number(),
});

const newsItem = z.object({
  date: z.string(),
  headline: z.string(),
  source: z.string(),
  url: z.string().optional(),
  category: z.string().optional(),
  /** 1-2 sentence editorial blurb. Finnhub returns this on /company-news;
   *  null for sources that don't supply it (e.g. fixture data without
   *  manual summary edits). */
  summary: z.string().nullable(),
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

const insiderTransactionItem = z.object({
  /** Date the Form 4 hit EDGAR (YYYY-MM-DD). */
  filingDate: z.string(),
  /** Date of the transaction itself (YYYY-MM-DD). */
  transactionDate: z.string(),
  insiderName: z.string(),
  /** Free-form title from the filing (e.g. "CEO", "Director", "10% Owner"). */
  insiderTitle: z.string(),
  /** SEC transaction code: P (open-market buy), S (open-market sell),
   *  A (grant/award), M (option exercise), G (gift), F (tax withholding), etc. */
  transactionCode: z.string(),
  /** Signed share count: positive for acquisitions, negative for dispositions. */
  shares: z.number(),
  /** USD per share. 0 for non-cash transactions (gifts, awards, withholdings). */
  pricePerShare: z.number(),
  /** True for derivative-security transactions (options, RSUs). */
  isDerivative: z.boolean(),
});

export const insiderTransactionsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  transactions: z.array(insiderTransactionItem),
  /** Lookback window in days (e.g. 90). */
  windowDays: z.number(),
});

/**
 * Business-identity profile: who the company is, what it does, how big it
 * is. Factual fields are nullable so partial-coverage provider responses
 * round-trip cleanly (Finnhub provides no `sector` or `businessDescription`;
 * Yahoo provides no `exchange` or `ipoDate`). The Company Profile analyst
 * is a *renderer* of these fields, not a synthesizer.
 */
export const companyProfileSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  /** Empty string only in the `"unavailable"` empty payload. */
  name: z.string(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  country: z.string().nullable(),
  exchange: z.string().nullable(),
  currency: z.string().nullable(),
  businessDescription: z.string().nullable(),
  marketCapUsd: z.number().nullable(),
  employees: z.number().nullable(),
  ipoDate: z.string().nullable(),
  website: z.string().nullable(),
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
  get_insider_transactions: periodInput,
  get_company_profile: periodInput,
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
  get_insider_transactions: insiderTransactionsSchema,
  get_company_profile: companyProfileSchema,
} as const;

export type ToolName = keyof typeof toolInputSchemas;

export type ToolInput<T extends ToolName> = z.infer<(typeof toolInputSchemas)[T]>;
export type ToolOutput<T extends ToolName> = z.infer<(typeof toolOutputSchemas)[T]>;

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
  get_insider_transactions: "insider-transactions.json",
  get_company_profile: "company-profile.json",
};

export function fixtureFileName(tool: ToolName): string {
  return TOOL_FILE_NAMES[tool];
}

/** Mode picker — read by every tool's `execute` to branch between fixture
 *  and live behavior. Default to `"fixture"` if state isn't set. */
export function pickMode(ctx: {
  session: { state: Record<string, unknown> };
}): "fixture" | "live" {
  return (ctx.session.state.dataSource as "fixture" | "live") ?? "fixture";
}
