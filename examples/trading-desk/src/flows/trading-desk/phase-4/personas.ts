/**
 * The three Phase 4 persona generators — aggressive, conservative, neutral.
 *
 * Each generator runs as a round-robin roster slot override (see
 * `phase-4/round-robin.ts`). Single-shot structured critique: reads the
 * Phase 3 trade proposal + Phase 2 investment thesis (always), prior
 * persona memos in fixed round-robin order (via
 * `ctx.resources.memos.getOptional`), and — on the `full` cost preset —
 * the four Phase 1 analyst memos plus the full bull/bear debate
 * transcript (via `p2Contributions`).
 *
 * Personas read prior persona memos from `ctx.resources.memos`, not from
 * the round-robin's contributions resource, because the structured fields
 * (`raisedRisks`, `proposedAdjustments`, neutral's `dismissedRisks`) live
 * on the memo. The contributions resource only carries the `{ text }`
 * round-robin transcript and is lossy.
 *
 * `agentType: "sub"` — per the design, P4 personas emit speak rows only
 * (no structured-output card in the transcript). The memo on the right
 * pane is the persona's structured artifact.
 */
import { generator } from "@flow-state-dev/core";
import {
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
} from "../agents";
import { memosCollection } from "../resources";
import { sessionStateSchema } from "../state";
import { phase2Contributions } from "../phase-2/round-robin";
import {
  formatAnalystMemos,
  formatDebate,
  formatMemoBlock,
  formatPersonaCritique,
  formatThesisExtensions,
  formatTradeProposalExtensions,
  readContributionsEntries,
} from "./format";
import {
  AGGRESSIVE_PROMPT,
  CONSERVATIVE_PROMPT,
  NEUTRAL_PROMPT,
} from "./prompts";
import {
  neutralCritiqueOutputSchema,
  personaCritiqueOutputSchema,
} from "./schemas";

const generatorResources = {
  memos: memosCollection,
  p2Contributions: phase2Contributions,
} as const;

function modelFor(costPreset: "fast" | "full" | undefined): string {
  return costPreset === "full" ? "intent/chat" : "intent/utility";
}

/** Build the shared user-prompt prologue: ticker, date, trade proposal,
 *  investment thesis, and (on `full` preset) analyst memos + P2 debate. */
function buildSharedContext(ctx: any): string[] {
  const ticker = ctx.session.state.ticker as string;
  const date = ctx.session.state.date as string;
  const preset =
    (ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast";
  const tradeRef = ctx.resources.memos.getOptional(
    PHASE_3_MEMO_KEYS.trader.collectionKey,
  );
  const thesisRef = ctx.resources.memos.getOptional(
    PHASE_2_MEMO_KEYS.researchManager.collectionKey,
  );
  const lines: string[] = [
    `Ticker: ${ticker}`,
    `As-of date: ${date}`,
    "",
    "## Phase 3 — Trade proposal (trader)",
    formatMemoBlock("Trade proposal", tradeRef?.state),
    "",
    "### Trade fields (typed)",
    formatTradeProposalExtensions(tradeRef?.state),
    "",
    "## Phase 2 — Investment thesis (research manager)",
    formatMemoBlock("Investment thesis", thesisRef?.state),
    "",
    "### Debate outcome (extension fields)",
    formatThesisExtensions(thesisRef?.state),
  ];
  if (preset === "full") {
    lines.push(
      "",
      "## Phase 1 — Analyst memos (full preset only)",
      formatAnalystMemos(ctx.resources.memos as any),
      "",
      "## Phase 2 — Full bull/bear debate transcript (full preset only)",
      formatDebate(readContributionsEntries(ctx, "p2Contributions")),
    );
  }
  return lines;
}

export const aggressiveRiskGenerator = generator({
  name: "aggressive-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.aggressive.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: AGGRESSIVE_PROMPT,
  user: (_input, ctx) => {
    const lines = buildSharedContext(ctx);
    lines.push("", "You are the first persona to speak in the round-robin.");
    lines.push("", "Now write the published Aggressive Risk critique.");
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

export const conservativeRiskGenerator = generator({
  name: "conservative-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.conservative.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: CONSERVATIVE_PROMPT,
  user: (_input, ctx) => {
    const lines = buildSharedContext(ctx);
    const aggressiveRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.aggressive.collectionKey,
    );
    lines.push(
      "",
      formatPersonaCritique("Aggressive Risk critique", aggressiveRef?.state),
      "",
      "Now write the published Conservative Risk critique.",
    );
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

export const neutralRiskGenerator = generator({
  name: "neutral-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.neutral.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: NEUTRAL_PROMPT,
  user: (_input, ctx) => {
    const lines = buildSharedContext(ctx);
    const aggressiveRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.aggressive.collectionKey,
    );
    const conservativeRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.conservative.collectionKey,
    );
    lines.push(
      "",
      formatPersonaCritique("Aggressive Risk critique", aggressiveRef?.state),
      "",
      formatPersonaCritique("Conservative Risk critique", conservativeRef?.state),
      "",
      "Now write the published Neutral Risk critique. Remember: your job is",
      "to filter, not to win. Populate `dismissedRisks` with the load-bearing",
      "call on what does not warrant action.",
    );
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: neutralCritiqueOutputSchema,
});
