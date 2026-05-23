/**
 * Phase 5 memo state-transition blocks — built via the shared
 * `defineMemoWriter` factory. The PM commit derives two structural fields
 * (`agreesWithTrader`, `upstreamReferences`) at commit time rather than
 * asking the LLM, and uses `afterCommit` to flip `session.runComplete`
 * so the navigator renders a terminal state.
 */
import { defineMemoWriter } from "../lib/memo-writer";
import {
  PHASE_1_MEMO_KEYS,
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
} from "../agents";
import { portfolioDecisionOutputSchema } from "./portfolio-manager";

const writer = defineMemoWriter({
  phaseId: "p5",
  agentTeam: "pm",
  keys: PHASE_5_MEMO_KEYS,
  errorMessageFallback: "Phase 5 generator failed.",
});

export const { markWriting: markWritingP5, markError: markErrorP5 } = writer;

/** Map a Phase 5 final rating to the trader-shape direction it implies,
 *  so PM-vs-trader agreement can be checked structurally. Buy/Overweight →
 *  long, Hold → flat, Underweight/Sell → short. */
function directionFromRating(
  r: "Sell" | "Underweight" | "Hold" | "Overweight" | "Buy",
): "long" | "short" | "flat" {
  if (r === "Buy" || r === "Overweight") return "long";
  if (r === "Hold") return "flat";
  return "short";
}

const ANALYST_MEMO_KEYS = [
  PHASE_1_MEMO_KEYS.fundamentals.collectionKey,
  PHASE_1_MEMO_KEYS.sentiment.collectionKey,
  PHASE_1_MEMO_KEYS.news.collectionKey,
  PHASE_1_MEMO_KEYS.technical.collectionKey,
] as const;

export const commitPortfolioManagerMemo = writer.defineCommit({
  shortName: "portfolioManager",
  inputSchema: portfolioDecisionOutputSchema,
  project: (decision, ctx) => {
    // `agreesWithTrader` is computed, not LLM-emitted. If the trader memo
    // is missing (defensive — should not happen post-Phase 3) or has no
    // recorded direction, record `null` rather than guess.
    const traderMemo = ctx.resources.memos.getOptional(
      PHASE_3_MEMO_KEYS.trader.collectionKey,
    );
    const traderDirection = (traderMemo?.state as { direction?: string | null } | undefined)
      ?.direction;
    const agreesWithTrader =
      traderDirection === "long" || traderDirection === "short" || traderDirection === "flat"
        ? directionFromRating(decision.finalRating) === traderDirection
        : null;

    return {
      label: decision.label,
      headline: decision.headline,
      rating: decision.rating,
      body: decision.body,
      metrics: decision.metrics,
      decisionSummary: decision.decisionSummary,
      finalRating: decision.finalRating,
      decisionConfidence: decision.decisionConfidence,
      acceptedAdjustments: decision.acceptedAdjustments,
      keyDependencies: decision.keyDependencies,
      upstreamReferences: {
        analystMemos: [...ANALYST_MEMO_KEYS],
        thesis: PHASE_2_MEMO_KEYS.researchManager.collectionKey,
        tradeProposal: PHASE_3_MEMO_KEYS.trader.collectionKey,
        riskAssessment: PHASE_4_MEMO_KEYS.riskAssessment.collectionKey,
      },
      agreesWithTrader,
    };
  },
  afterCommit: async (_decision, ctx) => {
    await ctx.session.patchState({ runComplete: true });
  },
});
