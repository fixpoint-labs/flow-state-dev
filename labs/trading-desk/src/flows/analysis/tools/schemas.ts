/**
 * Shared tool input/output schemas + the `ToolName` union.
 *
 * Each Phase 1 tool has a fixed shape that all providers normalize to: a
 * `source` provenance tag plus the canonical fields the analyst prompts
 * expect. Splitting these out of the tool files keeps each tool file focused
 * on dispatch logic (fixture vs. live, provider preference).
 */
import { z } from "zod";
import { searchProviders } from "@flow-state-dev/tools/search";

/** Re-export so other trading-desk files don't take a direct dep on the
 *  search package's types module. */
export { searchProviders };

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
 *   - `"edgar"`       — live mode, SEC EDGAR XBRL companyfacts answered.
 *                       Authoritative US-filing source for the statement tools.
 *   - `"yahoo"`       — live mode, Yahoo answered.
 *   - `"fred"`        — live mode, FRED API answered.
 *   - `"polymarket"`  — live mode, Polymarket Gamma API answered.
 *   - `"xai"`         — live mode, xAI (Grok) answered. Model estimate
 *                       grounded in xSearch-retrieved X posts, not a
 *                       measured feed.
 *   - `"massive"`     — live mode, Massive.com (rebranded Polygon.io) answered.
 *                       The desk's only futures + options-chain source; paid
 *                       per-product tiers. See `src/providers/massive.ts`.
 *   - `"unavailable"` — live mode, no provider could answer; payload is an
 *                       empty/zeroed schema-valid skeleton. Never silently
 *                       substitutes fixture data — false data is worse than
 *                       no data for analyst reasoning.
 */
const sourceTag = z.enum([
  "fixture",
  "yahoo",
  "finnhub",
  "edgar",
  "fred",
  "polymarket",
  "xai",
  "fmp",
  "massive",
  "unavailable",
]);
export type SourceTag = z.infer<typeof sourceTag>;

const periodInput = z.object({
  ticker: z.string().min(1),
  date: z.string().min(1),
});

// Statement numeric fields are nullable: a field the provider did not supply
// reads `null` (honest "unobserved"), never `0`. A real `0` and a missing
// value are different signals, and `0` silently corrupts derived valuation
// (e.g. a missing operatingIncome must not read as a real zero). Extends the
// nullable-PE discipline (FIX-692) to the statements after live runs showed
// Yahoo's legacy modules returning zero-filled statements (FIX-705 follow-up).
export const balanceSheetSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  totalAssets: z.number().nullable(),
  totalLiabilities: z.number().nullable(),
  totalEquity: z.number().nullable(),
  cashAndEquivalents: z.number().nullable(),
  totalDebt: z.number().nullable(),
  unit: z.string().default("USD billions"),
});

export const incomeStatementSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  revenue: z.number().nullable(),
  grossProfit: z.number().nullable(),
  operatingIncome: z.number().nullable(),
  netIncome: z.number().nullable(),
  yoyRevenueGrowth: z.number().nullable(),
  unit: z.string().default("USD billions"),
});

export const cashflowSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  operating: z.number().nullable(),
  investing: z.number().nullable(),
  financing: z.number().nullable(),
  freeCashFlow: z.number().nullable(),
  unit: z.string().default("USD billions"),
});

export const fundamentalsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  marketCap: z.number(),
  forwardPE: z.number().nullable(),
  trailingPE: z.number().nullable(),
  priceToSales: z.number(),
  returnOnEquity: z.number(),
  operatingMargin: z.number(),
  grossMargin: z.number(),
  dividendYield: z.number().nullable(),
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

/** General market-news feed — same item shape as company news, but
 *  market-wide (no `ticker` field). Feeds the Market Analyst. */
export const marketNewsSchema = z.object({
  source: sourceTag,
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
  yieldCurve2s10s: z.number(),
  hyCreditSpread: z.number(),
  dollarIndex: z.number(),
  industrialProduction: z.number(),
});

/**
 * Cross-asset flow & liquidity directionality. The macro-flow read the Macro
 * Analyst lacked: which way money is leaning across asset classes (risk-on vs
 * risk-off), whether the name is confirming or fighting the broad tape, and
 * which way financial conditions are trending. Computed deterministically from
 * trailing ETF returns (Yahoo, keyless) plus the Chicago Fed NFCI (FRED).
 *
 * Every field is nullable so a thin/throttled live read degrades honestly
 * (BP-020): an unpriced pair → null spread, FRED unavailable → null `liquidity`
 * block — never a fabricated directional signal.
 */
export const crossAssetFlowSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  /** Trailing window the returns were measured over (~63 trading days). */
  windowDays: z.number(),
  /** One entry per risk-on/risk-off ETF pair. `spread` is the risk-on leg's
   *  trailing return minus the risk-off leg's; positive = the risk-on leg is
   *  leading. `null` legs/spread mean that pair could not be priced. */
  ratios: z.array(
    z.object({
      label: z.string(),
      riskOnTicker: z.string(),
      riskOffTicker: z.string(),
      riskOnReturn: z.number().nullable(),
      riskOffReturn: z.number().nullable(),
      spread: z.number().nullable(),
      leaning: z.enum(["risk-on", "neutral", "risk-off"]).nullable(),
    }),
  ),
  /** Composite lean across the pairs that priced — the headline read. Null when
   *  no pair priced (unknown, not neutral). */
  riskAppetite: z.enum(["risk-on", "neutral", "risk-off"]).nullable(),
  /** Mean of the resolved spreads backing `riskAppetite`. */
  riskAppetiteScore: z.number().nullable(),
  /** The name's own trailing return, the broad-market (SPY) trailing return,
   *  and their difference — is price action confirming or fighting the tape
   *  (the macro-reflexive "tape confirmation" weight). */
  nameReturn: z.number().nullable(),
  broadMarketReturn: z.number().nullable(),
  nameVsBroadMarket: z.number().nullable(),
  /** Financial-conditions / liquidity sub-block (FRED NFCI). Null when FRED is
   *  unavailable — the ETF-based cross-asset read above still stands. NFCI > 0
   *  is tighter-than-average conditions; a rising NFCI is tightening. */
  liquidity: z
    .object({
      nfci: z.number().nullable(),
      nfciTrend: z.enum(["tightening", "stable", "easing"]).nullable(),
    })
    .nullable(),
});

/**
 * Broad institutional positioning: who owns the name and whether institutions
 * are accumulating or distributing. Quarterly 13F-derived data (Finnhub),
 * lagged ~45 days — a slow-moving ownership-trend signal, not a short-term one.
 * The Quant Analyst's positioning lane alongside short interest.
 */
export const institutionalOwnershipSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  /** Latest filing date across the reported holders. */
  reportDate: z.string().nullable(),
  /** Number of institutional holders in the reported set. */
  holderCount: z.number().nullable(),
  /** Sum of shares held across the reported holders. */
  totalSharesHeld: z.number().nullable(),
  /** Sum of the quarter-over-quarter share changes — net accumulation (+) or
   *  distribution (−) across the reported holders. */
  netShareChange: z.number().nullable(),
  /** Direction derived from `netShareChange` against a deadband of total shares
   *  held. Null when ownership could not be resolved. */
  flowDirection: z.enum(["accumulating", "neutral", "distributing"]).nullable(),
  /** Largest holders by shares, with their QoQ change. Capped for prompt budget. */
  topHolders: z.array(
    z.object({
      name: z.string(),
      shares: z.number(),
      shareChange: z.number(),
    }),
  ),
});

/** A single retrieved X post used as evidence for the sentiment score.
 *  `polarity` reflects the model's classification of THIS post (not overall
 *  sentiment). Excerpts are one short sentence — no paraphrasing of meaning. */
const sentimentPost = z.object({
  handle: z.string(),
  excerpt: z.string(),
  polarity: z.enum(["positive", "negative", "neutral"]),
});

export const socialSentimentSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  score7d: z.number(),
  positive: z.number(),
  negative: z.number(),
  neutral: z.number(),
  /** Null when the provider can't measure short interest (e.g. xAI/xSearch
   *  reads X chatter, not exchange short-interest filings). Honest null
   *  beats a fabricated 0 — analysts must not read 0 as "no shorts." */
  shortInterestPct: z.number().nullable(),
  /** Representative posts that grounded the score. Empty in `unavailable`
   *  mode. Fixture and live (xAI) modes populate this. The sentiment
   *  analyst should treat these as primary evidence — the score is a
   *  summary of these quotes, not an independent signal. */
  posts: z.array(sentimentPost),
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

/**
 * Two-tier Polymarket coverage (FIX-681). `tickerMarkets` are the direct
 * ticker matches that feed the sentiment analyst's numeric aggregates;
 * `backdropMarkets` are sector/macro markets resolved from the company's
 * sector, usable only as regime framing (never in numeric aggregates).
 *
 * `coverageQuality` is computed deterministically from `tickerMarkets`:
 *   - `"rich"`   — ≥3 ticker markets AND ≥$100k aggregate liquidity.
 *   - `"thin"`   — ≥1 ticker market, but below the count or liquidity floor.
 *   - `"absent"` — 0 ticker markets.
 * On `"thin"`/`"absent"` the sentiment prompt drops the market-derived
 * metrics to `"n/a"` rather than manufacturing precision from noise.
 */
export const predictionMarketsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  tickerMarkets: z.array(predictionMarket),
  backdropMarkets: z.array(predictionMarket),
  /** The primary sector/macro theme the backdrop markets were queried for
   *  (e.g. `"AI capex"`). Empty string when no theme was resolved. */
  backdropTheme: z.string(),
  coverageQuality: z.enum(["rich", "thin", "absent"]),
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
 *
 * `websiteMetaDescription` and `searchSnippets` are web-enrichment backstops
 * for the description gap when both structured providers leave it null
 * (common with less-covered tickers). The analyst is prompted to cite which
 * source each claim traced to.
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
  /** Concatenated `<meta name="description">` + `og:description` from the
   *  company's own homepage, when reachable. The company's self-description. */
  websiteMetaDescription: z.string().nullable(),
  /** Top web-search snippets for the company name (provider-agnostic via
   *  `@flow-state-dev/tools/search`'s auto-detection). Independent
   *  perspective on what the business is. */
  searchSnippets: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      }),
    )
    .nullable(),
});

/**
 * Provenance tag for discovery payloads (web-search wrappers). Distinct
 * from the data-provider `sourceTag` above — discovery has its own failure
 * modes:
 *
 *   - `"fixture"`     — fixture-mode read.
 *   - `"web"`         — live mode, any configured search provider answered.
 *   - `"skipped"`     — `costPreset !== "full"`; no provider call made.
 *                       The analyst sees an empty items list and the prompt
 *                       short-circuits investigation entirely.
 *   - `"unavailable"` — `costPreset === "full"` but the search provider
 *                       failed or no provider key is configured. Per BP-020
 *                       discovery never silently falls back to fixture data
 *                       — false discovery items are worse than none.
 */
const discoverySourceTag = z.enum(["fixture", "web", "skipped", "unavailable"]);

/** A single numbered web-search result returned by a discovery tool. The
 *  `id` is sequential ("1", "2", ...) so the analyst prompt can ask the
 *  LLM to reference URLs by their numeric tag. `publisher` is best-effort
 *  domain extraction; null when URL parsing fails. */
const discoveryItem = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
  publisher: z.string().nullable(),
  provider: z.enum(searchProviders),
});

export const discoveryPayloadSchema = z.object({
  source: discoverySourceTag,
  ticker: z.string(),
  asOf: z.string(),
  /** The composed query string sent to the search provider — kept on the
   *  payload for auditability. Empty string on `"skipped"` and the
   *  `"unavailable"` empty payload. */
  query: z.string(),
  items: z.array(discoveryItem),
});

export type DiscoveryPayload = z.infer<typeof discoveryPayloadSchema>;

/**
 * Sector context: how the name's sector is positioned vs. the broad market,
 * and where the name sits within its sector. The broad-market return (SPY)
 * is a relative baseline, not a macro-regime indicator — that belongs to the
 * Macro Analyst (FIX-704).
 */
export const sectorContextSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  sectorEtf: z.string().nullable(),
  nameReturn1m: z.number().nullable(),
  sectorEtfReturn1m: z.number().nullable(),
  broadMarketReturn1m: z.number().nullable(),
  relativeStrength1m: z.number().nullable(),
  sectorVsMarket1m: z.number().nullable(),
});

/**
 * Sector peers: Finnhub peer set with trailing 1-month returns. Capped at
 * ~6 peers to keep prompt size and API budget bounded.
 */
export const sectorPeersSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  grouping: z.string().nullable(),
  peers: z.array(
    z.object({
      ticker: z.string(),
      name: z.string().nullable(),
      return1m: z.number().nullable(),
    }),
  ),
  peerMedianReturn1m: z.number().nullable(),
});

/**
 * Cross-sectional factor ranks: where the name sits within its peer set
 * on momentum, value, quality, size, and low-vol. The Quant Analyst's
 * primary differentiator from Technical (chart) and Market (sector returns).
 */
export const factorRanksSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  peerCount: z.number().nullable(),
  factors: z.array(z.object({
    factor: z.enum(["momentum", "value", "quality", "size", "lowVol"]),
    value: z.number().nullable(),
    percentile: z.number().nullable(),
    // Ordinal rank within the peer set (1 = highest), `outOf` names ranked on
    // this factor. Valid at any sample size; the headline read for the small
    // (~7-name) free-data peer set.
    rank: z.number().nullable(),
    outOf: z.number().nullable(),
    // Reported only when the cross-section is large enough to be meaningful
    // (see MIN_Z_CROSS_SECTION); null for small peer sets.
    zScore: z.number().nullable(),
  })),
  compositeFactorPercentile: z.number().nullable(),
});

/**
 * Risk-regime statistics: beta, realized-vol regime, and correlation
 * regime vs SPY and the sector ETF.
 */
export const riskRegimeSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  betaMarket: z.number().nullable(),
  betaSector: z.number().nullable(),
  rSquared: z.number().nullable(),
  realizedVolAnnualized: z.number().nullable(),
  volRegime: z.enum(["calm", "normal", "elevated", "stressed"]).nullable(),
  volPercentile: z.number().nullable(),
  correlationMarket: z.number().nullable(),
  correlationRegime: z.enum(["rising", "stable", "falling"]).nullable(),
});

/**
 * Statistical composites: Altman Z'' and Piotroski F-Score from
 * quarterly financial statements.
 */
export const quantCompositesSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  altmanZ: z.number().nullable(),
  altmanZone: z.enum(["safe", "grey", "distress"]).nullable(),
  altmanVariant: z.enum(["Z''"]).nullable(),
  piotroskiF: z.number().nullable(),
  piotroskiBreakdown: z.array(z.object({
    criterion: z.string(),
    passed: z.boolean().nullable(),
  })),
  coverageNote: z.string(),
});

/**
 * Short interest and days-to-cover from Finnhub.
 */
export const shortInterestSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  shortInterest: z.number().nullable(),
  shortInterestPctFloat: z.number().nullable(),
  daysToCover: z.number().nullable(),
  settlementDate: z.string().nullable(),
});

/**
 * SEC filings: recent filing list, latest periodic section extracts, and
 * EFTS red-flag probes. Keyless (EDGAR is free, US-only).
 */
export const secFilingsSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  recentFilings: z.array(z.object({
    form: z.string(),
    filingDate: z.string(),
    title: z.string(),
    url: z.string(),
  })),
  materialEvents: z.array(z.object({
    filingDate: z.string(),
    form: z.string(),
    title: z.string(),
    url: z.string(),
    events: z.array(z.object({
      code: z.string(),
      label: z.string(),
      title: z.string(),
      signal: z.enum(["high", "medium", "low"]),
    })),
  })),
  latestPeriodic: z.object({
    form: z.string(),
    filingDate: z.string(),
    url: z.string(),
    riskFactors: z.string().nullable(),
    mdna: z.string().nullable(),
  }).nullable(),
  redFlagProbes: z.array(z.object({
    term: z.string(),
    hit: z.boolean(),
    snippet: z.string().nullable(),
  })),
});

/**
 * Analyst estimates, ratings, and targets. Finnhub free baseline (ratings
 * distribution + earnings surprises); FMP optional enrichment (consensus
 * estimates, price targets, recent rating actions).
 */
export const analystEstimatesSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  ratingsDistribution: z.object({
    period: z.string(),
    strongBuy: z.number(),
    buy: z.number(),
    hold: z.number(),
    sell: z.number(),
    strongSell: z.number(),
  }).nullable(),
  earningsSurprises: z.array(z.object({
    period: z.string(),
    actual: z.number().nullable(),
    estimate: z.number().nullable(),
    surprisePct: z.number().nullable(),
  })),
  consensusEstimates: z.object({
    fyEpsAvg: z.number().nullable(),
    fyRevenueAvg: z.number().nullable(),
    numAnalysts: z.number().nullable(),
  }).nullable(),
  priceTargets: z.object({
    high: z.number().nullable(),
    low: z.number().nullable(),
    median: z.number().nullable(),
    consensus: z.number().nullable(),
  }).nullable(),
  recentRatingActions: z.array(z.object({
    date: z.string(),
    firm: z.string(),
    action: z.string(),
    fromGrade: z.string().nullable(),
    toGrade: z.string().nullable(),
  })),
});

/**
 * Earnings-call transcript. FMP-key-gated: `available: false` when no key
 * or no transcript exists for the latest quarter.
 */
export const earningsTranscriptSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  available: z.boolean(),
  callDate: z.string().nullable(),
  quarter: z.string().nullable(),
  content: z.string().nullable(),
});

/**
 * Options-chain read for the analyzed ticker (Massive / Polygon). A single
 * snapshot of the near-dated chain, reduced to the derivatives signals the Quant
 * Analyst reasons over: at-the-money implied vol, the IV term-structure tilt,
 * the 25-delta put-vs-call skew, and the put/call open-interest balance.
 *
 * Every derived field is nullable so a thin or absent chain degrades honestly
 * (BP-020): a name with no listed options, or a chain too thin to interpolate a
 * skew, reads `null` — never a fabricated 0. `source: "massive"` means the
 * provider answered (even with an empty chain); `"unavailable"` means it could
 * not be reached or no key/entitlement was present.
 */
export const optionsChainSchema = z.object({
  source: sourceTag,
  ticker: z.string(),
  asOf: z.string(),
  /** Underlying spot used to locate the at-the-money strike. */
  spotPrice: z.number().nullable(),
  /** Nearest expiration the metrics below were measured on (YYYY-MM-DD). */
  nearestExpiry: z.string().nullable(),
  /** At-the-money implied vol on the nearest expiry, as a fraction (0.32 = 32%). */
  atmIv: z.number().nullable(),
  /** Sign of `ivTermSlope`: far ATM IV above near = contango, below = backwardation. */
  ivTermStructure: z.enum(["contango", "flat", "backwardation"]).nullable(),
  /** Far-expiry ATM IV minus near-expiry ATM IV. Needs ≥2 expiries; else null. */
  ivTermSlope: z.number().nullable(),
  /** 25-delta skew: put IV at ~−0.25Δ minus call IV at ~+0.25Δ on the nearest
   *  expiry. Positive = downside puts richer than upside calls (fear premium). */
  skew25Delta: z.number().nullable(),
  /** Total put open interest divided by total call open interest across the
   *  fetched chain. > 1 = more put than call OI. */
  putCallOiRatio: z.number().nullable(),
  totalOpenInterest: z.number().nullable(),
  totalVolume: z.number().nullable(),
  /** Count of distinct expirations seen in the fetched chain (0 in the empty payload). */
  expiriesCovered: z.number(),
});

/**
 * Benchmark futures curve (Massive / Polygon). A fixed basket of the most
 * macro-relevant US futures — equity-index, energy, metal, rates — each reduced
 * to a front-month level, its session change, and the front-vs-next spread that
 * reveals contango/backwardation. `riskTone` is a composite read off the
 * equity-index and gold legs. The Macro Analyst's cross-asset positioning lane.
 *
 * Per-product fields are nullable so one unpriced product degrades on its own
 * (BP-020); the basket still returns the products that priced. `source` is
 * "massive" when any product priced, "unavailable" when none did.
 */
export const futuresCurveSchema = z.object({
  source: sourceTag,
  asOf: z.string(),
  products: z.array(
    z.object({
      /** Root product code, e.g. "ES". */
      productCode: z.string(),
      name: z.string(),
      assetClass: z.enum(["equity-index", "energy", "metal", "rates"]),
      /** Front (nearest-expiry active) contract ticker. Null when unresolved. */
      frontContract: z.string().nullable(),
      lastPrice: z.number().nullable(),
      /** Front-month last vs prior session close, as a fraction. */
      changePct: z.number().nullable(),
      /** Next active contract ticker. Null when only the front resolved. */
      nextContract: z.string().nullable(),
      /** (next − front) / front, as a fraction. Positive = deferred richer. */
      frontNextSpreadPct: z.number().nullable(),
      termStructure: z.enum(["contango", "backwardation", "flat"]).nullable(),
    }),
  ),
  /** Composite cross-asset tone from the equity-index and gold legs. Null when
   *  neither priced. Risk-on = equity up / gold down; risk-off = the inverse. */
  riskTone: z.enum(["risk-on", "neutral", "risk-off"]).nullable(),
});

export const toolInputSchemas = {
  get_balance_sheet: periodInput,
  get_income_statement: periodInput,
  get_cashflow: periodInput,
  get_fundamentals: periodInput,
  get_price_history: periodInput.extend({ range: z.string().default("1mo") }),
  compute_indicators: periodInput,
  search_news: periodInput,
  get_market_news: z.object({ date: z.string().min(1) }),
  get_macro_indicators: z.object({ date: z.string().min(1) }),
  get_macro_news: z.object({ date: z.string().min(1) }),
  get_social_sentiment: periodInput,
  get_reddit_mentions: periodInput,
  get_prediction_markets: periodInput,
  get_insider_transactions: periodInput,
  get_company_profile: periodInput,
  discover_fundamentals_context: periodInput,
  discover_sentiment_context: periodInput,
  discover_technical_context: periodInput,
  discover_profile_context: periodInput,
  get_sector_context: periodInput,
  get_sector_peers: periodInput,
  get_cross_asset_flow: periodInput,
  discover_market_context: periodInput,
  discover_macro_context: periodInput,
  get_factor_ranks: periodInput,
  get_risk_regime: periodInput,
  get_quant_composites: periodInput,
  get_short_interest: periodInput,
  get_institutional_ownership: periodInput,
  get_options_chain: periodInput,
  get_futures_curve: z.object({ date: z.string().min(1) }),
  discover_quant_context: periodInput,
  get_sec_filings: periodInput,
  get_analyst_estimates: periodInput,
  get_earnings_transcript: periodInput,
  discover_disclosure_context: periodInput,
} as const;

export const toolOutputSchemas = {
  get_balance_sheet: balanceSheetSchema,
  get_income_statement: incomeStatementSchema,
  get_cashflow: cashflowSchema,
  get_fundamentals: fundamentalsSchema,
  get_price_history: priceHistorySchema,
  compute_indicators: indicatorsSchema,
  search_news: companyNewsSchema,
  get_market_news: marketNewsSchema,
  get_macro_indicators: macroIndicatorsSchema,
  get_macro_news: marketNewsSchema,
  get_social_sentiment: socialSentimentSchema,
  get_reddit_mentions: redditMentionsSchema,
  get_prediction_markets: predictionMarketsSchema,
  get_insider_transactions: insiderTransactionsSchema,
  get_company_profile: companyProfileSchema,
  discover_fundamentals_context: discoveryPayloadSchema,
  discover_sentiment_context: discoveryPayloadSchema,
  discover_technical_context: discoveryPayloadSchema,
  discover_profile_context: discoveryPayloadSchema,
  get_sector_context: sectorContextSchema,
  get_sector_peers: sectorPeersSchema,
  get_cross_asset_flow: crossAssetFlowSchema,
  discover_market_context: discoveryPayloadSchema,
  discover_macro_context: discoveryPayloadSchema,
  get_factor_ranks: factorRanksSchema,
  get_risk_regime: riskRegimeSchema,
  get_quant_composites: quantCompositesSchema,
  get_short_interest: shortInterestSchema,
  get_institutional_ownership: institutionalOwnershipSchema,
  get_options_chain: optionsChainSchema,
  get_futures_curve: futuresCurveSchema,
  discover_quant_context: discoveryPayloadSchema,
  get_sec_filings: secFilingsSchema,
  get_analyst_estimates: analystEstimatesSchema,
  get_earnings_transcript: earningsTranscriptSchema,
  discover_disclosure_context: discoveryPayloadSchema,
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
  get_market_news: "market-news.json",
  get_macro_indicators: "macro-indicators.json",
  get_macro_news: "macro-news.json",
  get_social_sentiment: "social-sentiment.json",
  get_reddit_mentions: "reddit-mentions.json",
  get_prediction_markets: "prediction-markets.json",
  get_insider_transactions: "insider-transactions.json",
  get_company_profile: "company-profile.json",
  discover_fundamentals_context: "discover-fundamentals-context.json",
  discover_sentiment_context: "discover-sentiment-context.json",
  discover_technical_context: "discover-technical-context.json",
  discover_profile_context: "discover-profile-context.json",
  get_sector_context: "sector-context.json",
  get_sector_peers: "sector-peers.json",
  get_cross_asset_flow: "cross-asset.json",
  discover_market_context: "discover-market-context.json",
  discover_macro_context: "discover-macro-context.json",
  get_factor_ranks: "factor-ranks.json",
  get_risk_regime: "risk-regime.json",
  get_quant_composites: "quant-composites.json",
  get_short_interest: "short-interest.json",
  get_institutional_ownership: "institutional-ownership.json",
  get_options_chain: "options-chain.json",
  get_futures_curve: "futures-curve.json",
  discover_quant_context: "discover-quant-context.json",
  get_sec_filings: "sec-filings.json",
  get_analyst_estimates: "analyst-estimates.json",
  get_earnings_transcript: "earnings-transcript.json",
  discover_disclosure_context: "discover-disclosure-context.json",
};

export function fixtureFileName(tool: ToolName): string {
  return TOOL_FILE_NAMES[tool];
}

/** Mode picker — read by every tool's `execute` to branch between fixture,
 *  live, and record behavior. Default to `"fixture"` if state isn't set.
 *  Tools that only test `=== "fixture"` treat record as live — correct, since
 *  a record run fetches live data (and persists it as a fixture snapshot). */
export function pickMode(ctx: {
  session: { state: Record<string, unknown> };
}): "fixture" | "live" | "record" {
  return (
    (ctx.session.state.dataSource as "fixture" | "live" | "record") ??
    "fixture"
  );
}
