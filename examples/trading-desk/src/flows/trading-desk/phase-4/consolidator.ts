/**
 * The Phase 4 `riskAssessmentGenerator` — single-shot consolidation step.
 *
 * Reads the three Phase 4 persona memos (aggressive, conservative, neutral)
 * with their structured fields, the Phase 3 trade proposal, the Phase 2
 * investment thesis, and the round-robin transcript. On the `full` cost
 * preset, also reads the four Phase 1 analyst memos and the Phase 2
 * bull/bear debate transcript.
 *
 * Emits a typed `RiskAssessment` — what Phase 5 (the portfolio manager)
 * actually consumes. The three persona memos remain as the audit trail.
 *
 * `agentType: "sub"` — no structured-output card in the transcript; the
 * memo on the right pane is the artifact. See §10 OQ4.
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
import { phase4Contributions } from "./round-robin";
import {
  formatAnalystMemos,
  formatDebate,
  formatMemoBlock,
  formatPersonaCritique,
  formatThesisExtensions,
  formatTradeProposalExtensions,
  readContributionsEntries,
} from "./format";
import { RISK_ASSESSMENT_PROMPT } from "./prompts";
import { riskAssessmentOutputSchema } from "./schemas";

const generatorResources = {
  memos: memosCollection,
  p2Contributions: phase2Contributions,
  p4Contributions: phase4Contributions,
} as const;

function modelFor(costPreset: "fast" | "full" | undefined): string {
  return costPreset === "full" ? "intent/chat" : "intent/utility";
}

export const riskAssessmentGenerator = generator({
  name: "risk-assessment-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.riskAssessment.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: RISK_ASSESSMENT_PROMPT,
  user: (_input, ctx) => {
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
    const aggressiveRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.aggressive.collectionKey,
    );
    const conservativeRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.conservative.collectionKey,
    );
    const neutralRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.neutral.collectionKey,
    );
    const lines: string[] = [
      `Ticker: ${ticker}`,
      `As-of date: ${date}`,
      "",
      "## Phase 3 — Trade proposal",
      formatMemoBlock("Trade proposal", tradeRef?.state),
      "",
      "### Trade fields (typed)",
      formatTradeProposalExtensions(tradeRef?.state),
      "",
      "## Phase 2 — Investment thesis",
      formatMemoBlock("Investment thesis", thesisRef?.state),
      "",
      "### Debate outcome (extension fields)",
      formatThesisExtensions(thesisRef?.state),
      "",
      formatPersonaCritique("Aggressive Risk critique", aggressiveRef?.state),
      "",
      formatPersonaCritique("Conservative Risk critique", conservativeRef?.state),
      "",
      formatPersonaCritique("Neutral Risk critique", neutralRef?.state),
      "",
      "## Phase 4 — Round-robin transcript (free-form contributions)",
      formatDebate(readContributionsEntries(ctx, "p4Contributions")),
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
    lines.push("", "Now write the published RiskAssessment.");
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: riskAssessmentOutputSchema,
});
