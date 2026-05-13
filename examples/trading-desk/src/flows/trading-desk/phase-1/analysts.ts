/**
 * Phase 1 analyst sub-sequencers — one per role (fundamentals, technical,
 * news, sentiment).
 *
 * Shape: each analyst pre-fetches its data deterministically (`.parallel`
 * over the tool blocks the role needs, with `.map` to derive their
 * `{ ticker, date }` input from session state) and hands the result to a
 * tools-free generator that just synthesizes the `Thesis`. Phase 1 tool
 * inputs are entirely derivable from session state — there is no judgment
 * work for the LLM in tool selection, so the LLM does synthesis only.
 *
 * The news analyst is the one exception: it pre-fetches headlines + macro
 * data deterministically, then keeps the `fetch` tool agent-callable so
 * the model picks 2–3 article URLs from the headline window to read in
 * depth (a real judgment call).
 *
 * `agentType: "sub"` keeps each analyst's items off the conversation
 * history but lets them flow to the client for live observability.
 */
import { generator, sequencer } from "@flow-state-dev/core";
import { fetch as createFetchTool } from "@flow-state-dev/tools";
import { z } from "zod";
import {
  AGENTS,
  PHASE_1_MEMO_KEYS,
  type AgentName,
} from "../agents";
import { commitMemo, markError, markWriting } from "../memo-writer";
import { callAsTool } from "../services/prefetch";
import { tradingDesk } from "../services/trading-desk-capability";
import {
  fundamentalsPrompt,
  newsPrompt,
  sentimentPrompt,
  technicalPrompt,
} from "./prompts";
import { thesisOutputSchema } from "./thesis-schema";
import {
  compute_indicators,
  get_balance_sheet,
  get_cashflow,
  get_fundamentals,
  get_income_statement,
  get_macro_indicators,
  get_prediction_markets,
  get_price_history,
  get_reddit_mentions,
  get_social_sentiment,
  search_news,
} from "./tools";
import { toolOutputSchemas } from "./tools/schemas";

const ANALYST_INSTRUCTION =
  "Synthesize the Thesis from the data provided above. Return the JSON object only.";

// One reshape: pull ticker+date out of session state for every analyst's
// `.parallel` branches. Each Phase 1 tool block has `inputSchema =
// periodInput` (`{ ticker, date }`), so a single `.map` covers every branch
// without per-tool connectors. Ctx is untyped here because the sequencer
// pre-`.map` doesn't carry the `tradingDesk` capability's session-state
// typing yet — the values are runtime-validated by each tool's input schema
// downstream.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tickerDate = (_input: unknown, ctx: any) => ({
  ticker: ctx.session.state.ticker as string,
  date: ctx.session.state.date as string,
});

// Render the pre-fetched data bundle as a fenced JSON block so the LLM
// reads it as one cohesive payload rather than scattered tags.
const asDataBlock = (data: unknown): string =>
  "```json\n" + JSON.stringify(data, null, 2) + "\n```";

const memoLabel = (name: AgentName) => `${AGENTS[name].role} memo`;

// Bind `callAsTool` to a given analyst's agentName so each analyst's tool
// pills attribute to that analyst's card. Drop-in replacement target for
// when FIX-593 lands the framework helper of the same name.
const toolFor = (agentName: AgentName) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <TIn, TOut>(block: any): any =>
    callAsTool<TIn, TOut>(block, { agentType: "sub", agentName });

// ---------------------------------------------------------------------------
// Fundamentals — four independent fetches, all keyed by { ticker, date }.
// ---------------------------------------------------------------------------

const fundamentalsGenerator = generator({
  name: "fundamentals-analyst-generator",
  agentType: "sub",
  agentName: PHASE_1_MEMO_KEYS.fundamentals.agentName,
  uses: [tradingDesk],
  inputSchema: z.object({
    balanceSheet: toolOutputSchemas.get_balance_sheet,
    incomeStatement: toolOutputSchemas.get_income_statement,
    cashflow: toolOutputSchemas.get_cashflow,
    fundamentals: toolOutputSchemas.get_fundamentals,
  }),
  prompt: fundamentalsPrompt,
  context: {
    data: (input) => asDataBlock(input),
  },
  user: ANALYST_INSTRUCTION,
  outputSchema: thesisOutputSchema,
});

export const fundamentalsAnalyst = sequencer({
  name: "analyst-fundamentals",
  container: {
    component: "analyst-card",
    label: memoLabel(PHASE_1_MEMO_KEYS.fundamentals.agentName),
  },
})
  .tap(markWriting("fundamentals"))
  .map(tickerDate)
  .parallel((() => {
    const t = toolFor(PHASE_1_MEMO_KEYS.fundamentals.agentName);
    return {
      balanceSheet: t(get_balance_sheet),
      incomeStatement: t(get_income_statement),
      cashflow: t(get_cashflow),
      fundamentals: t(get_fundamentals),
    };
  })())
  .then(fundamentalsGenerator)
  .tap(commitMemo("fundamentals"))
  .rescue([{ block: markError("fundamentals") }]);

// ---------------------------------------------------------------------------
// Technical — price history and indicators run in parallel. `compute_indicators`
// fetches its own 1-year window internally (see compute_indicators.ts:30-37),
// independent of the analyst's 1-month price_history call.
// ---------------------------------------------------------------------------

const technicalGenerator = generator({
  name: "technical-analyst-generator",
  agentType: "sub",
  agentName: PHASE_1_MEMO_KEYS.technical.agentName,
  uses: [tradingDesk],
  inputSchema: z.object({
    priceHistory: toolOutputSchemas.get_price_history,
    indicators: toolOutputSchemas.compute_indicators,
  }),
  prompt: technicalPrompt,
  context: {
    data: (input) => asDataBlock(input),
  },
  user: ANALYST_INSTRUCTION,
  outputSchema: thesisOutputSchema,
});

export const technicalAnalyst = sequencer({
  name: "analyst-technical",
  container: {
    component: "analyst-card",
    label: memoLabel(PHASE_1_MEMO_KEYS.technical.agentName),
  },
})
  .tap(markWriting("technical"))
  .map(tickerDate)
  .parallel((() => {
    const t = toolFor(PHASE_1_MEMO_KEYS.technical.agentName);
    return {
      priceHistory: t(get_price_history),
      indicators: t(compute_indicators),
    };
  })())
  .then(technicalGenerator)
  .tap(commitMemo("technical"))
  .rescue([{ block: markError("technical") }]);

// ---------------------------------------------------------------------------
// News — pre-fetch headlines + macro deterministically; keep `fetch` as an
// LLM-callable tool so the model picks 2–3 article URLs to read deeply
// (genuine judgment work, see newsPrompt). This is the only Phase 1 analyst
// that still does tool calls.
// ---------------------------------------------------------------------------

const fetchArticle = createFetchTool();

const newsGenerator = generator({
  name: "news-analyst-generator",
  agentType: "sub",
  agentName: PHASE_1_MEMO_KEYS.news.agentName,
  uses: [tradingDesk],
  inputSchema: z.object({
    news: toolOutputSchemas.search_news,
    macro: toolOutputSchemas.get_macro_indicators,
  }),
  prompt: newsPrompt,
  context: {
    data: (input) => asDataBlock(input),
  },
  user:
    "Pick 2–3 of the most material article URLs from the news data above and " +
    "call `fetch` to read their bodies, then synthesize the Thesis. Return " +
    "the JSON object only.",
  tools: [fetchArticle],
  outputSchema: thesisOutputSchema,
});

export const newsAnalyst = sequencer({
  name: "analyst-news",
  container: {
    component: "analyst-card",
    label: memoLabel(PHASE_1_MEMO_KEYS.news.agentName),
  },
})
  .tap(markWriting("news"))
  .map(tickerDate)
  .parallel((() => {
    const t = toolFor(PHASE_1_MEMO_KEYS.news.agentName);
    return {
      news: t(search_news),
      macro: t(get_macro_indicators),
    };
  })())
  .then(newsGenerator)
  .tap(commitMemo("news"))
  .rescue([{ block: markError("news") }]);

// ---------------------------------------------------------------------------
// Sentiment — three independent fetches, all keyed by { ticker, date }.
// ---------------------------------------------------------------------------

const sentimentGenerator = generator({
  name: "sentiment-analyst-generator",
  agentType: "sub",
  agentName: PHASE_1_MEMO_KEYS.sentiment.agentName,
  uses: [tradingDesk],
  inputSchema: z.object({
    socialSentiment: toolOutputSchemas.get_social_sentiment,
    redditMentions: toolOutputSchemas.get_reddit_mentions,
    predictionMarkets: toolOutputSchemas.get_prediction_markets,
  }),
  prompt: sentimentPrompt,
  context: {
    data: (input) => asDataBlock(input),
  },
  user: ANALYST_INSTRUCTION,
  outputSchema: thesisOutputSchema,
});

export const sentimentAnalyst = sequencer({
  name: "analyst-sentiment",
  container: {
    component: "analyst-card",
    label: memoLabel(PHASE_1_MEMO_KEYS.sentiment.agentName),
  },
})
  .tap(markWriting("sentiment"))
  .map(tickerDate)
  .parallel((() => {
    const t = toolFor(PHASE_1_MEMO_KEYS.sentiment.agentName);
    return {
      socialSentiment: t(get_social_sentiment),
      redditMentions: t(get_reddit_mentions),
      predictionMarkets: t(get_prediction_markets),
    };
  })())
  .then(sentimentGenerator)
  .tap(commitMemo("sentiment"))
  .rescue([{ block: markError("sentiment") }]);
