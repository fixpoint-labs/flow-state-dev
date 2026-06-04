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
    totalAssets: null,
    totalLiabilities: null,
    totalEquity: null,
    cashAndEquivalents: null,
    totalDebt: null,
    unit: "USD billions",
  }),
  get_income_statement: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    revenue: null,
    grossProfit: null,
    operatingIncome: null,
    netIncome: null,
    yoyRevenueGrowth: null,
    unit: "USD billions",
  }),
  get_cashflow: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    operating: null,
    investing: null,
    financing: null,
    freeCashFlow: null,
    unit: "USD billions",
  }),
  get_fundamentals: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    marketCap: 0,
    forwardPE: null,
    trailingPE: null,
    priceToSales: 0,
    returnOnEquity: 0,
    operatingMargin: 0,
    grossMargin: 0,
    dividendYield: null,
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
  get_market_news: (i) => ({
    source: "unavailable",
    asOf: i.date,
    items: [],
  }),
  get_macro_news: (i) => ({
    source: "unavailable",
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
    yieldCurve2s10s: 0,
    hyCreditSpread: 0,
    dollarIndex: 0,
    industrialProduction: 0,
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
  get_sector_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    sector: null,
    industry: null,
    sectorEtf: null,
    nameReturn1m: null,
    sectorEtfReturn1m: null,
    broadMarketReturn1m: null,
    relativeStrength1m: null,
    sectorVsMarket1m: null,
  }),
  get_sector_peers: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    grouping: null,
    peers: [],
    peerMedianReturn1m: null,
  }),
  get_cross_asset_flow: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    windowDays: 63,
    ratios: [],
    riskAppetite: null,
    riskAppetiteScore: null,
    nameReturn: null,
    broadMarketReturn: null,
    nameVsBroadMarket: null,
    liquidity: null,
  }),
  discover_market_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    query: "",
    items: [],
  }),
  discover_macro_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    query: "",
    items: [],
  }),
  get_factor_ranks: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    peerCount: null,
    factors: [],
    compositeFactorPercentile: null,
  }),
  get_risk_regime: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    betaMarket: null,
    betaSector: null,
    rSquared: null,
    realizedVolAnnualized: null,
    volRegime: null,
    volPercentile: null,
    correlationMarket: null,
    correlationRegime: null,
  }),
  get_quant_composites: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    altmanZ: null,
    altmanZone: null,
    altmanVariant: null,
    piotroskiF: null,
    piotroskiBreakdown: [],
    coverageNote: "Statement data unavailable.",
  }),
  get_short_interest: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    shortInterest: null,
    shortInterestPctFloat: null,
    daysToCover: null,
    settlementDate: null,
  }),
  get_institutional_ownership: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    reportDate: null,
    holderCount: null,
    totalSharesHeld: null,
    netShareChange: null,
    flowDirection: null,
    topHolders: [],
  }),
  discover_quant_context: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    query: "",
    items: [],
  }),
  get_sec_filings: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    recentFilings: [],
    materialEvents: [],
    latestPeriodic: null,
    redFlagProbes: [],
  }),
  get_analyst_estimates: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    ratingsDistribution: null,
    earningsSurprises: [],
    consensusEstimates: null,
    priceTargets: null,
    recentRatingActions: [],
  }),
  get_earnings_transcript: (i) => ({
    source: "unavailable",
    ticker: i.ticker,
    asOf: i.date,
    available: false,
    callDate: null,
    quarter: null,
    content: null,
  }),
  discover_disclosure_context: (i) => ({
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
  | "discover_profile_context"
  | "discover_market_context"
  | "discover_macro_context"
  | "discover_quant_context"
  | "discover_disclosure_context";

export function skippedDiscoveryPayload<T extends DiscoveryTool>(
  tool: T,
  input: ToolInput<T>,
): ToolOutput<T> {
  return { ...emptyPayload(tool, input), source: "skipped" } as ToolOutput<T>;
}
