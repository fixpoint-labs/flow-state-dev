/**
 * The nine Phase 1 analyst sub-sequencers.
 *
 * Each one is the same recipe — `defineAnalyst` captures it. The role
 * differences live in two places per analyst: the generator (which tools'
 * outputs it reads, which prompt it runs) and the `tools` record (which
 * deterministic fetches its parallel branch performs).
 *
 * The fundamentals / sentiment / technical / company-profile analysts
 * are pure synthesis: tool inputs are derivable from session state, so
 * the LLM does no tool selection. The news analyst is the one exception:
 * it pre-fetches headlines + macro deterministically, then keeps the
 * `fetch` tool agent-callable so the model picks 2–3 article URLs from
 * the headline window to read in depth.
 *
 * `itemVisibility: { client: true, history: false }` on every generator
 * keeps each analyst's items off the conversation history while still
 * flowing to the client for live observability.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { z } from "zod";
import { PHASE_1_MEMO_KEYS } from "../../agents";
import { tradingDesk } from "../../capability";
import { asDataBlock } from "../../lib/helpers";
import { computeValuation, formatValuation } from "../../lib/valuation";
import { loadPrompt } from "../../lib/prompt";
import { defineAnalyst } from "../_recipe/define-analyst";
import { thesisOutputSchema } from "./thesis-schema";
import {
  compute_indicators,
  discover_disclosure_context,
  discover_fundamentals_context,
  discover_macro_context,
  discover_market_context,
  discover_profile_context,
  discover_quant_context,
  discover_sentiment_context,
  discover_technical_context,
  get_analyst_estimates,
  get_balance_sheet,
  get_cashflow,
  get_company_profile,
  get_cross_asset_flow,
  get_earnings_transcript,
  get_factor_ranks,
  get_fundamentals,
  get_income_statement,
  get_insider_transactions,
  get_institutional_ownership,
  get_macro_indicators,
  get_macro_news,
  get_market_news,
  get_prediction_markets,
  get_price_history,
  get_quant_composites,
  get_reddit_mentions,
  get_risk_regime,
  get_sec_filings,
  get_sector_context,
  get_sector_peers,
  get_short_interest,
  get_social_sentiment,
  search_news,
} from "../../tools";
import { toolOutputSchemas } from "../../tools/schemas";

const fundamentalsPrompt = loadPrompt(
  "agents/analysts/prompts/fundamentals.prompt.md"
);
const technicalPrompt = loadPrompt("agents/analysts/prompts/technical.prompt.md");
const newsPrompt = loadPrompt("agents/analysts/prompts/news.prompt.md");
const sentimentPrompt = loadPrompt("agents/analysts/prompts/sentiment.prompt.md");
const companyProfilePrompt = loadPrompt(
  "agents/analysts/prompts/company-profile.prompt.md"
);
const marketContextPrompt = loadPrompt(
  "agents/analysts/prompts/market-context.prompt.md"
);
const macroPrompt = loadPrompt("agents/analysts/prompts/macro.prompt.md");
const quantPrompt = loadPrompt("agents/analysts/prompts/quant.prompt.md");
const disclosurePrompt = loadPrompt("agents/analysts/prompts/disclosure.prompt.md");

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

const fundamentalsGenerator = generator({
  name: "fundamentals-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.fundamentals.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    balanceSheet: toolOutputSchemas.get_balance_sheet,
    incomeStatement: toolOutputSchemas.get_income_statement,
    cashflow: toolOutputSchemas.get_cashflow,
    fundamentals: toolOutputSchemas.get_fundamentals,
    fundamentalsContext: toolOutputSchemas.discover_fundamentals_context,
  }),
  context: {
    data: (input) => asDataBlock(input),
    valuation: (input: any) => formatValuation(computeValuation(input)),
  },
  ...definePromptFile(fundamentalsPrompt),
  outputSchema: thesisOutputSchema,
});

export const fundamentalsAnalyst = defineAnalyst({
  shortName: "fundamentals",
  tools: {
    balanceSheet: get_balance_sheet,
    incomeStatement: get_income_statement,
    cashflow: get_cashflow,
    fundamentals: get_fundamentals,
    fundamentalsContext: discover_fundamentals_context,
  },
  generator: fundamentalsGenerator,
});

// ---------------------------------------------------------------------------
// Technical — price history and indicators run in parallel.
// `compute_indicators` fetches its own 1-year window internally, independent
// of the analyst's 1-month price_history call.
// ---------------------------------------------------------------------------

const technicalGenerator = generator({
  name: "technical-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.technical.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    priceHistory: toolOutputSchemas.get_price_history,
    indicators: toolOutputSchemas.compute_indicators,
    technicalContext: toolOutputSchemas.discover_technical_context,
  }),
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(technicalPrompt),
  outputSchema: thesisOutputSchema,
});

export const technicalAnalyst = defineAnalyst({
  shortName: "technical",
  tools: {
    priceHistory: get_price_history,
    indicators: compute_indicators,
    technicalContext: discover_technical_context,
  },
  generator: technicalGenerator,
});

// ---------------------------------------------------------------------------
// News — pre-fetch headlines + macro deterministically; keep `fetch` as an
// LLM-callable tool so the model picks 2–3 article URLs to read deeply.
// This is the only Phase 1 analyst that still does tool calls.
// ---------------------------------------------------------------------------

const newsGenerator = generator({
  name: "news-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.news.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    news: toolOutputSchemas.search_news,
    insiderTransactions: toolOutputSchemas.get_insider_transactions,
  }),
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(newsPrompt),
  outputSchema: thesisOutputSchema,
});

export const newsAnalyst = defineAnalyst({
  shortName: "news",
  tools: {
    news: search_news,
    insiderTransactions: get_insider_transactions,
  },
  generator: newsGenerator,
});

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

const sentimentGenerator = generator({
  name: "sentiment-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.sentiment.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    socialSentiment: toolOutputSchemas.get_social_sentiment,
    redditMentions: toolOutputSchemas.get_reddit_mentions,
    predictionMarkets: toolOutputSchemas.get_prediction_markets,
    sentimentContext: toolOutputSchemas.discover_sentiment_context,
  }),
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(sentimentPrompt),
  outputSchema: thesisOutputSchema,
});

export const sentimentAnalyst = defineAnalyst({
  shortName: "sentiment",
  tools: {
    socialSentiment: get_social_sentiment,
    redditMentions: get_reddit_mentions,
    predictionMarkets: get_prediction_markets,
    sentimentContext: discover_sentiment_context,
  },
  generator: sentimentGenerator,
});

// ---------------------------------------------------------------------------
// Company Profile — single deterministic fetch; the LLM is a renderer of
// the structured identity fields, not a synthesizer. The prompt's "every
// claim must trace to a field in <data>" rule plus the shared grounding
// clause from `tradingDesk` are the no-fabrication defenses.
// ---------------------------------------------------------------------------

const companyProfileGenerator = generator({
  name: "company-profile-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.companyProfile.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    companyProfile: toolOutputSchemas.get_company_profile,
    profileContext: toolOutputSchemas.discover_profile_context,
  }),
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(companyProfilePrompt),
  outputSchema: thesisOutputSchema,
});

export const companyProfileAnalyst = defineAnalyst({
  shortName: "companyProfile",
  tools: {
    companyProfile: get_company_profile,
    profileContext: discover_profile_context,
  },
  generator: companyProfileGenerator,
});

// ---------------------------------------------------------------------------
// Market — sector positioning, peer posture, theme momentum, and sector-
// specific regulatory/supply-chain overhang. Runs as a parallel peer (not
// a sub-sequence after Company Profile) — the sector label is resolved
// inside `get_sector_context` via a soft Yahoo profile fetch, cache-deduped.
// ---------------------------------------------------------------------------

const marketGenerator = generator({
  name: "market-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.market.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    sectorContext: toolOutputSchemas.get_sector_context,
    sectorPeers: toolOutputSchemas.get_sector_peers,
    marketContext: toolOutputSchemas.discover_market_context,
    marketNews: toolOutputSchemas.get_market_news,
  }),
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(marketContextPrompt),
  outputSchema: thesisOutputSchema,
});

export const marketAnalyst = defineAnalyst({
  shortName: "market",
  tools: {
    sectorContext: get_sector_context,
    sectorPeers: get_sector_peers,
    marketContext: discover_market_context,
    marketNews: get_market_news,
  },
  generator: marketGenerator,
});

// ---------------------------------------------------------------------------
// Macro — global economic regime (rates, inflation, growth cycle, FX,
// commodities, credit) and geopolitical regime, plus a transmission map to
// the specific name. Runs as a parallel peer — company identity is resolved
// via `get_company_profile` (cache-deduped), not a sub-sequence.
// ---------------------------------------------------------------------------

const macroGenerator = generator({
  name: "macro-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.macro.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    macro: toolOutputSchemas.get_macro_indicators,
    macroNews: toolOutputSchemas.get_macro_news,
    crossAssetFlow: toolOutputSchemas.get_cross_asset_flow,
    macroContext: toolOutputSchemas.discover_macro_context,
    profile: toolOutputSchemas.get_company_profile,
  }),
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(macroPrompt),
  outputSchema: thesisOutputSchema,
});

export const macroAnalyst = defineAnalyst({
  shortName: "macro",
  tools: {
    macro: get_macro_indicators,
    macroNews: get_macro_news,
    crossAssetFlow: get_cross_asset_flow,
    macroContext: discover_macro_context,
    profile: get_company_profile,
  },
  generator: macroGenerator,
});

// ---------------------------------------------------------------------------
// Quant — cross-sectional factor ranks, statistical composites (Altman Z'',
// Piotroski F-Score), risk-regime statistics, and short-interest positioning.
// Pure quantitative analysis — no chart-reading (Technical's lane) and no
// sector-rotation (Market's lane).
// ---------------------------------------------------------------------------

const quantGenerator = generator({
  name: "quant-analyst-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_1_MEMO_KEYS.quant.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: z.object({
    factorRanks: toolOutputSchemas.get_factor_ranks,
    riskRegime: toolOutputSchemas.get_risk_regime,
    quantComposites: toolOutputSchemas.get_quant_composites,
    shortInterest: toolOutputSchemas.get_short_interest,
    institutionalOwnership: toolOutputSchemas.get_institutional_ownership,
    quantContext: toolOutputSchemas.discover_quant_context,
  }),
  context: { data: (input) => asDataBlock(input) },
  ...definePromptFile(quantPrompt),
  outputSchema: thesisOutputSchema,
});

export const quantAnalyst = defineAnalyst({
  shortName: "quant",
  tools: {
    factorRanks: get_factor_ranks,
    riskRegime: get_risk_regime,
    quantComposites: get_quant_composites,
    shortInterest: get_short_interest,
    institutionalOwnership: get_institutional_ownership,
    quantContext: discover_quant_context,
  },
  generator: quantGenerator,
});

// ---------------------------------------------------------------------------
// Disclosure — SEC filings (10-K/10-Q/8-K text and red flags), earnings-call
// transcript (FMP-key-gated), and Street consensus (ratings, beat/miss,
// estimates, targets). The primary-document read the desk didn't have.
// ---------------------------------------------------------------------------

const disclosureInputSchema = z.object({
  filings: toolOutputSchemas.get_sec_filings,
  estimates: toolOutputSchemas.get_analyst_estimates,
  transcript: toolOutputSchemas.get_earnings_transcript,
  disclosureContext: toolOutputSchemas.discover_disclosure_context,
});

// TS 5.7 hits its inference-depth limit on the 4 disclosure tool output
// schemas combined with generator()'s 20+ generic params.  The config
// cast is safe — defineAnalyst consumes an unparameterised BlockDefinition.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const disclosureGenerator = generator({
  name: "disclosure-analyst-generator",
  agentType: "sub",
  agentName: PHASE_1_MEMO_KEYS.disclosure.agentName,
  uses: [tradingDesk.presets({ investigate: true })],
  inputSchema: disclosureInputSchema,
  context: { data: (input: unknown) => asDataBlock(input) },
  ...definePromptFile(disclosurePrompt),
  outputSchema: thesisOutputSchema,
} as any);

export const disclosureAnalyst = defineAnalyst({
  shortName: "disclosure",
  tools: {
    filings: get_sec_filings,
    estimates: get_analyst_estimates,
    transcript: get_earnings_transcript,
    disclosureContext: discover_disclosure_context,
  },
  generator: disclosureGenerator,
});
