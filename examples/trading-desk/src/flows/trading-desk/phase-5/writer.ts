/**
 * Phase 5 memo state-transition taps.
 *
 * Three handlers, structurally identical to Phase 3's: `markWritingP5`
 * flips the memo to `writing` + `startedAt`, `markErrorP5` records the
 * rescue, and `commitPortfolioManagerMemo` writes the design-shape fields
 * plus the seven Phase 5 extension fields and flips status to `published`.
 *
 * `commitPortfolioManagerMemo` also:
 *   - Computes `agreesWithTrader` from `finalRating` vs the trader memo's
 *     `direction` field. Derived at commit time rather than asked of the
 *     LLM — it's a function of two already-stored values, and asking the
 *     LLM to mirror them adds hallucination surface for no gain.
 *   - Computes `upstreamReferences` from the canonical key maps. The
 *     reference list is structural — every PM decision references the
 *     same set of upstream memos by construction — so emitting it from
 *     constants beats round-tripping through the model.
 *   - Sets `session.runComplete` to `true` so the navigator can render a
 *     terminal "complete" state.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  PHASE_1_MEMO_KEYS,
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
  type Phase5MemoShortName,
} from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";
import {
  portfolioDecisionOutputSchema,
  type PortfolioDecisionOutput,
} from "./schemas";

/** Pre-mark a Phase 5 memo as `writing` and stamp `startedAt`. */
export function markWritingP5(shortName: Phase5MemoShortName) {
  const { collectionKey, agentName } = PHASE_5_MEMO_KEYS[shortName];
  return handler({
    name: `mark-writing-p5-${shortName}`,
    inputSchema: z.unknown(),
    outputSchema: z.void(),
    sessionStateSchema,
    resources: memoResources,
    execute: async (_input, ctx) => {
      const ref = ctx.resources.memos.getOptional(collectionKey);
      const startedAt = new Date().toISOString();
      const patch = {
        status: "writing" as const,
        startedAt,
        agentName,
      };
      if (ref !== undefined) {
        await ref.patchState(patch);
      } else {
        await ctx.resources.memos.create(collectionKey, {
          ...patch,
          agentTeam: "pm",
          phaseId: "p5",
          ticker: ctx.session.state.ticker,
          date: ctx.session.state.date,
          label: null,
          headline: null,
          rating: null,
          body: null,
          metrics: null,
          completedAt: null,
          errorMessage: null,
          stance: null,
          conviction: null,
          keyRisks: null,
          keyOpportunities: null,
          unresolvedDisagreements: null,
          direction: null,
          sizePct: null,
          stopPrice: null,
          targetPrice: null,
          holdingPeriod: null,
          invalidationCriteria: null,
          dependsOn: null,
          posture: null,
          raisedRisks: null,
          proposedAdjustments: null,
          dismissedRisks: null,
          criticalRisks: null,
          recommendedAdjustments: null,
          confidenceCalibration: null,
          calibrationRationale: null,
          decisionSummary: null,
          finalRating: null,
          decisionConfidence: null,
          acceptedAdjustments: null,
          keyDependencies: null,
          upstreamReferences: null,
          agreesWithTrader: null,
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", shortName, "writing");
      }
    },
  });
}

/** Mark a specific Phase 5 memo as `error` with the rescued error's message. */
export function markErrorP5(shortName: Phase5MemoShortName) {
  const { collectionKey } = PHASE_5_MEMO_KEYS[shortName];
  return handler({
    name: `mark-error-p5-${shortName}`,
    inputSchema: z.object({ error: z.unknown() }).passthrough(),
    outputSchema: z.object({ status: z.literal("error") }),
    sessionStateSchema,
    resources: memoResources,
    execute: async (input, ctx) => {
      const error = (input as { error?: unknown }).error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Phase 5 generator failed.";
      const ref = ctx.resources.memos.getOptional(collectionKey);
      if (ref !== undefined) {
        await ref.patchState({
          status: "error",
          errorMessage: message,
          completedAt: new Date().toISOString(),
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "error") {
        await ctx.session.setStateRecord("memoStatus", shortName, "error");
      }
      return { status: "error" as const };
    },
  });
}

/** Map a Phase 5 final rating to the trader-shape direction it implies, so
 *  PM-vs-trader agreement can be checked structurally. Buy/Overweight → long,
 *  Hold → flat, Underweight/Sell → short. */
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

/**
 * Commit a `PortfolioDecision` to `memos/p5/portfolio-manager`. Populates
 * the design-shape `Thesis` fields plus the seven Phase 5 extension fields,
 * derives `agreesWithTrader` and `upstreamReferences`, flips status to
 * `published`, and sets `session.runComplete` to `true`.
 */
export const commitPortfolioManagerMemo = handler({
  name: "commit-memo-p5-portfolio-manager",
  inputSchema: portfolioDecisionOutputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (decision: PortfolioDecisionOutput, ctx) => {
    const ref = ctx.resources.memos.get(
      PHASE_5_MEMO_KEYS.portfolioManager.collectionKey,
    );
    const completedAt = new Date().toISOString();

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

    await ref.patchState({
      status: "published",
      label: decision.label,
      headline: decision.headline,
      rating: decision.rating,
      body: decision.body,
      metrics: decision.metrics,
      completedAt,
      errorMessage: null,
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
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.portfolioManager !== "published") {
      await ctx.session.setStateRecord(
        "memoStatus",
        "portfolioManager",
        "published",
      );
    }
    await ctx.session.patchState({ runComplete: true });
  },
});
