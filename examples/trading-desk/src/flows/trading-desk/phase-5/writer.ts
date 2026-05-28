/**
 * Phase 5 memo-writing blocks.
 *
 *   - `markWritingP5` / `markErrorP5` — built via `defineMemoStateBlocks`.
 *   - `commitPortfolioManagerMemo` — plain handler that derives two
 *     structural fields at commit time (`agreesWithTrader` from the
 *     trader memo's direction vs the PM's final rating;
 *     `upstreamReferences` from the canonical key maps), publishes the
 *     memo, then flips `session.runComplete` so the navigator renders a
 *     terminal state.
 *
 * The `runComplete` patch is inline at the end of the handler — not
 * abstracted into a factory callback. This is the cleanest expression of
 * "this commit also marks the run complete": one statement, in the same
 * scope as the rest of the commit body.
 */
import {
  PHASE_1_MEMO_KEYS,
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
} from "../agents";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../lib/memo-writer";
import { portfolioDecisionOutputSchema } from "./portfolio-manager";

export const {
  markWriting: markWritingP5,
  markError: markErrorP5,
} = defineMemoStateBlocks({
  phaseId: "p5",
  agentTeam: "pm",
  keys: PHASE_5_MEMO_KEYS,
  errorMessageFallback: "Phase 5 generator failed.",
});

/** Map a Phase 5 final rating to the trader-shape direction it implies, so
 *  PM-vs-trader agreement can be checked structurally. Buy/Overweight →
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

export const commitPortfolioManagerMemo = memoHandler({
  name: "commit-memo-p5-portfolio-manager",
  inputSchema: portfolioDecisionOutputSchema,
  execute: async (decision, ctx) => {
    // `agreesWithTrader` is computed, not LLM-emitted. If the trader memo
    // is missing (defensive — should not happen post-Phase 3) or has no
    // recorded direction, record `null` rather than guess.
    const traderMemo = ctx.resources.memos.getOptional(
      PHASE_3_MEMO_KEYS.trader.collectionKey,
    );
    const traderState = traderMemo?.state as
      | { direction?: string | null; dependsOn?: string[] | null }
      | undefined;
    const traderDirection = traderState?.direction;

    // Lineage enforcement: every dependency the trader named must be
    // carried forward in `keyDependencies` or consciously dropped in
    // `acknowledgedAndDropped`. The prompt asks for this, but only the
    // writer can guarantee it — an orphaned dependency means the PM
    // silently lost a contestable judgment. Throwing here triggers the
    // `markErrorP5` rescue, which flips the memo to `error`.
    const traderDeps = traderState?.dependsOn ?? [];
    const dropped = decision.acknowledgedAndDropped.map((d) => d.item);
    const orphaned = traderDeps.filter(
      (d) => !decision.keyDependencies.includes(d) && !dropped.includes(d),
    );
    if (orphaned.length > 0) {
      throw new Error(
        `lineage-violation: PM dropped trader dependencies without acknowledgment: ${orphaned.join(", ")}`,
      );
    }
    const agreesWithTrader =
      traderDirection === "long" || traderDirection === "short" || traderDirection === "flat"
        ? directionFromRating(decision.finalRating) === traderDirection
        : null;

    await publishMemo(
      ctx,
      "portfolioManager",
      PHASE_5_MEMO_KEYS.portfolioManager.collectionKey,
      {
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
      },
    );

    // Phase 5 is terminal — mark the run complete so the navigator
    // renders the "done" state. This used to be an `afterCommit` callback
    // on the writer factory; now it's just the next statement.
    await ctx.session.patchState({ runComplete: true });
  },
});
