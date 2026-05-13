/**
 * `defineAnalyst` — sub-sequencer factory shared by the four Phase 1 analyst
 * agents. Each analyst:
 *   1. Marks its memo `writing` (state + session-status mirror).
 *   2. Runs a generator with role-specific tools and a system prompt that
 *      enforces the `Thesis` output shape.
 *   3. Commits the generator's structured output to the memo resource.
 *   4. On error, the rescue branch flips the memo to `error` with a message.
 *
 * `agentType: "sub"` keeps each analyst's items off the conversation history
 * but lets them flow to the client for live observability.
 */
import { generator, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import {
  AGENTS,
  PHASE_1_MEMO_KEYS,
  type AgentName,
  type Phase1MemoShortName,
} from "../agents";
import {
  fundamentalsPrompt,
  newsPrompt,
  sentimentPrompt,
  technicalPrompt,
} from "./prompts";
import {
  commitMemo,
  markError,
  markWriting,
} from "../memo-writer";
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

type AnalystOptions = {
  shortName: Phase1MemoShortName;
  agentName: AgentName;
  systemPrompt: string;
  tools: BlockDefinition<any, any>[];
  label: string;
};

/**
 * Map the flow's `costPreset` to a model intent. `intent/utility` resolves to
 * the cheap end of the configured model resolver; `intent/chat` to the
 * higher-quality tier. Both fall back to the resolver's default model.
 */
function resolveAnalystModel(costPreset: "fast" | "full" | undefined): string {
  return costPreset === "full" ? "intent/chat" : "intent/utility";
}

function makeUserPrompt(input: { ticker: string; date: string; agentName: string }): string {
  return [
    `Ticker: ${input.ticker}`,
    `As-of date: ${input.date}`,
    `Role: ${AGENTS[input.agentName as AgentName]?.role ?? input.agentName}`,
    "",
    "Call your tools to gather the data, synthesize, and emit a single JSON",
    "object matching the Thesis schema. Return the JSON object only.",
  ].join("\n");
}

export function defineAnalyst({
  shortName,
  agentName,
  systemPrompt,
  tools,
  label,
}: AnalystOptions) {
  const analystGenerator = generator({
    name: `${shortName}-analyst-generator`,
    agentType: "sub",
    agentName,
    model: (_input, ctx) =>
      resolveAnalystModel(
        (ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast",
      ),
    prompt: systemPrompt,
    user: (_input, ctx) =>
      makeUserPrompt({
        ticker: ctx.session.state.ticker as string,
        date: ctx.session.state.date as string,
        agentName,
      }),
    tools,
    outputSchema: thesisOutputSchema,
  });

  return sequencer({
    name: `analyst-${shortName}`,
    container: { component: "analyst-card", label },
  })
    .tap(markWriting(shortName))
    .then(analystGenerator)
    .tap(commitMemo(shortName))
    .rescue([
      // Catch-all: omit `when` so any Error subclass routes here.
      { block: markError(shortName) },
    ]);
}

const fundamentalsLabel = `${AGENTS[PHASE_1_MEMO_KEYS.fundamentals.agentName].role} memo`;
const sentimentLabel = `${AGENTS[PHASE_1_MEMO_KEYS.sentiment.agentName].role} memo`;
const newsLabel = `${AGENTS[PHASE_1_MEMO_KEYS.news.agentName].role} memo`;
const technicalLabel = `${AGENTS[PHASE_1_MEMO_KEYS.technical.agentName].role} memo`;

export const fundamentalsAnalyst = defineAnalyst({
  shortName: "fundamentals",
  agentName: PHASE_1_MEMO_KEYS.fundamentals.agentName,
  systemPrompt: fundamentalsPrompt,
  tools: [get_balance_sheet, get_income_statement, get_cashflow, get_fundamentals],
  label: fundamentalsLabel,
});

export const technicalAnalyst = defineAnalyst({
  shortName: "technical",
  agentName: PHASE_1_MEMO_KEYS.technical.agentName,
  systemPrompt: technicalPrompt,
  tools: [get_price_history, compute_indicators],
  label: technicalLabel,
});

export const newsAnalyst = defineAnalyst({
  shortName: "news",
  agentName: PHASE_1_MEMO_KEYS.news.agentName,
  systemPrompt: newsPrompt,
  tools: [search_news, get_macro_indicators],
  label: newsLabel,
});

export const sentimentAnalyst = defineAnalyst({
  shortName: "sentiment",
  agentName: PHASE_1_MEMO_KEYS.sentiment.agentName,
  systemPrompt: sentimentPrompt,
  tools: [get_social_sentiment, get_reddit_mentions, get_prediction_markets],
  label: sentimentLabel,
});
