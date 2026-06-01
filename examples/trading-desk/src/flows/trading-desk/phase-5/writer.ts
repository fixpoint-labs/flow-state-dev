/**
 * Phase 5 memo-writing blocks, for both sub-stages.
 *
 * Scenario forecaster (runs first):
 *   - `markWritingForecast` / `markErrorForecast` — built via
 *     `defineMemoStateBlocks`.
 *   - `commitScenarioForecastMemo` — normalizes the scenario probabilities,
 *     copies `horizon` from the trader memo, and publishes. Throws
 *     `probability-violation` when the raw probabilities sum outside
 *     [0.8, 1.2], caught by the pipeline's per-step rescue.
 *
 * Portfolio manager (runs second, terminal):
 *   - `markWritingP5` / `markErrorP5` — built via `defineMemoStateBlocks`.
 *   - `commitPortfolioManagerMemo` — derives two structural fields at
 *     commit time (`agreesWithTrader` from the trader memo's direction vs
 *     the PM's final rating; `upstreamReferences` from the canonical key
 *     maps), enforces trader-dependency lineage, publishes the memo, then
 *     flips `session.runComplete` so the navigator renders a terminal state.
 *
 * The `runComplete` patch is inline at the end of the PM handler — not
 * abstracted into a factory callback. This is the cleanest expression of
 * "this commit also marks the run complete": one statement, in the same
 * scope as the rest of the commit body.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  PHASE_1_MEMO_KEYS,
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
} from "../agents";
import { clampRatingToBand } from "../lib/rating-engine";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../lib/memo-writer";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";
import { valuationSpineResource } from "../valuation-spine-resource";
import { portfolioDecisionOutputSchema } from "./portfolio-manager";
import { scenarioForecastOutputSchema } from "./scenario-forecaster";

// ── Scenario forecaster ──────────────────────────────────────────────

export const {
  markWriting: markWritingForecast,
  markError: markErrorForecast,
} = defineMemoStateBlocks({
  phaseId: "p5",
  agentTeam: "pm",
  keys: { scenarioForecast: PHASE_5_MEMO_KEYS.scenarioForecast },
  errorMessageFallback: "Scenario forecaster failed.",
});

export const commitScenarioForecastMemo = memoHandler({
  name: "commit-memo-p5-scenario-forecast",
  inputSchema: scenarioForecastOutputSchema,
  execute: async (forecast, ctx) => {
    // Copy horizon from the trader memo's holdingPeriod.
    const traderMemo = await ctx.resources.memos.getOptional(
      PHASE_3_MEMO_KEYS.trader.collectionKey,
    );
    const traderState = traderMemo?.state as
      | { holdingPeriod?: string | null }
      | undefined;
    const horizon = traderState?.holdingPeriod ?? null;

    // Probability integrity: sum, validate band, normalize.
    const rawSum = forecast.scenarios.reduce((s, sc) => s + sc.probability, 0);
    if (rawSum < 0.8 || rawSum > 1.2) {
      throw new Error(
        `probability-violation: scenario probabilities sum to ${rawSum.toFixed(4)}, outside [0.8, 1.2]`,
      );
    }
    const normalizedScenarios = forecast.scenarios.map((sc) => ({
      ...sc,
      probability: sc.probability / rawSum,
    }));

    await publishMemo(
      ctx,
      "scenarioForecast",
      PHASE_5_MEMO_KEYS.scenarioForecast.collectionKey,
      {
        label: forecast.label,
        headline: forecast.headline,
        rating: forecast.rating,
        body: forecast.body,
        metrics: forecast.metrics,
        scenarios: normalizedScenarios,
        distribution: forecast.distribution,
        probabilitySum: rawSum,
        horizon,
        evidenceBasis: forecast.evidenceBasis,
      },
    );
  },
});

// ── Portfolio manager ────────────────────────────────────────────────

export const {
  markWriting: markWritingP5,
  markError: markErrorP5,
} = defineMemoStateBlocks({
  phaseId: "p5",
  agentTeam: "pm",
  keys: { portfolioManager: PHASE_5_MEMO_KEYS.portfolioManager },
  errorMessageFallback: "Portfolio manager failed.",
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

export const commitPortfolioManagerMemo = handler({
  name: "commit-memo-p5-portfolio-manager",
  inputSchema: portfolioDecisionOutputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  resources: { ...memoResources, valuationSpine: valuationSpineResource },
  execute: async (decision, ctx) => {
    // `agreesWithTrader` is computed, not LLM-emitted. If the trader memo
    // is missing (defensive — should not happen post-Phase 3) or has no
    // recorded direction, record `null` rather than guess.
    const traderMemo = await ctx.resources.memos.getOptional(
      PHASE_3_MEMO_KEYS.trader.collectionKey,
    );
    const traderState = traderMemo?.state as
      | { direction?: string | null; dependsOn?: string[] | null }
      | undefined;
    const traderDirection = traderState?.direction;

    // Lineage enforcement: every dependency the trader named must be
    // dispositioned by the PM — carried forward as a live judgment or
    // consciously dropped. The PM references each one by its position in
    // `trader.dependsOn` (the same `[index]` it was rendered with), so
    // this check is referential, not string-based: the PM can paraphrase
    // freely in `keyDependencies` without orphaning a judgment. Only the
    // writer can guarantee coverage — an un-dispositioned dependency means
    // the PM silently lost a contestable judgment. Throwing here triggers
    // the `markErrorP5` rescue, which flips the memo to `error`.
    const traderDeps = traderState?.dependsOn ?? [];
    const dispositioned = new Set(
      decision.traderDependencyDispositions.map((d) => d.index),
    );
    const orphaned = traderDeps.filter((_, i) => !dispositioned.has(i));
    if (orphaned.length > 0) {
      throw new Error(
        `lineage-violation: PM did not disposition trader dependencies: ${orphaned.join(", ")}`,
      );
    }
    const agreesWithTrader =
      traderDirection === "long" || traderDirection === "short" || traderDirection === "flat"
        ? directionFromRating(decision.finalRating) === traderDirection
        : null;

    // Valuation-spine clamping: bound the LLM's finalRating to the
    // model-implied envelope when the spine was computed successfully.
    const spine = ctx.resources.valuationSpine?.state as
      | { envelope: { implied: typeof decision.finalRating; floor: typeof decision.finalRating; ceiling: typeof decision.finalRating; absoluteRating: "Buy" | "Hold" | "Sell"; relativeRating: "Overweight" | "Equal Weight" | "Underweight"; rationale: string } }
      | null
      | undefined;
    let finalRating = decision.finalRating;
    let modelImpliedRating: typeof finalRating | null = null;
    let ratingBand: { floor: typeof finalRating; ceiling: typeof finalRating } | null = null;
    let ratingClamped = false;
    let ratingOverrideReason: string | null = null;
    let absoluteRating: "Buy" | "Hold" | "Sell" | null = null;
    let relativeRating: "Overweight" | "Equal Weight" | "Underweight" | null = null;

    if (spine?.envelope) {
      const clamped = clampRatingToBand(
        decision.finalRating,
        spine.envelope,
        decision.ratingOverrideReason,
      );
      finalRating = clamped.final;
      ratingClamped = clamped.clamped;
      modelImpliedRating = spine.envelope.implied;
      ratingBand = { floor: spine.envelope.floor, ceiling: spine.envelope.ceiling };
      ratingOverrideReason = clamped.clamped
        ? null
        : (decision.ratingOverrideReason || null);
      absoluteRating = spine.envelope.absoluteRating;
      relativeRating = spine.envelope.relativeRating;
    }

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
        finalRating,
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
        primaryScenario: decision.primaryScenario,
        modelImpliedRating,
        ratingBand,
        ratingClamped,
        ratingOverrideReason,
        absoluteRating,
        relativeRating,
      },
    );

    // Phase 5 is terminal — mark the run complete so the navigator
    // renders the "done" state. This used to be an `afterCommit` callback
    // on the writer factory; now it's just the next statement.
    await ctx.session.patchState({ runComplete: true });
  },
});
