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
import {
  decisionSnapshotResource,
  type DecisionSnapshotState,
} from "../decision-snapshot-resource";
import { clampRatingToBand } from "../lib/rating-engine";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../agents/_recipe/memo-writer";
import type { ReportDecisionMeta } from "../report-index";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";
import { valuationSpineResource, type ValuationSpineState } from "../valuation-spine-resource";
import {
  lensConvergenceResource,
  type LensConvergenceState,
} from "../lens-convergence-resource";
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
  resources: {
    ...memoResources,
    valuationSpine: valuationSpineResource,
    decisionSnapshot: decisionSnapshotResource,
    // Slice 5 — read the deterministic convergence read to mirror it onto the
    // memo (so the PmHero strip reads one place). Nullable; null on `fast` runs.
    lensConvergence: lensConvergenceResource,
  },
  execute: async (decision, ctx) => {
    // `agreesWithTrader` is computed, not LLM-emitted. If the trader memo
    // is missing (defensive — should not happen post-Phase 3) or has no
    // recorded direction, record `null` rather than guess.
    const traderMemo = await ctx.resources.memos.getOptional(
      PHASE_3_MEMO_KEYS.trader.collectionKey,
    );
    const traderState = traderMemo?.state as
      | {
          direction?: string | null;
          dependsOn?: string[] | null;
          stopPrice?: number | null;
          targetPrice?: number | null;
          sizePct?: number | null;
          holdingPeriod?: DecisionSnapshotState["holdingPeriod"];
        }
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
      | ValuationSpineState
      | null
      | undefined;
    let finalRating = decision.finalRating;
    let modelImpliedRating: typeof finalRating | null = null;
    let ratingBand: { floor: typeof finalRating; ceiling: typeof finalRating } | null = null;
    let ratingClamped = false;
    let ratingOverrideReason: string | null = decision.ratingOverrideReason || null;
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

    // ── Portfolio-fit echo fields (Slice 5) ────────────────────────────
    // Derived deterministically from the frozen session-state snapshot + the
    // real account list — NOT trusted from the LLM (the agreesWithTrader /
    // upstreamReferences precedent). The five LLM-emitted fields (action /
    // targetWeightPct / sizingRationale / concentrationRisk / convictionBasis)
    // pass through; the four echo fields are computed here.
    // A null/absent portfolio can surface as `{}` in some runtime paths, so gate
    // on the required `accounts` array, not `!== null`, to decide whether a real
    // portfolio snapshot was supplied.
    const rawPortfolio = ctx.session.state.portfolio;
    const portfolio =
      rawPortfolio != null && Array.isArray(rawPortfolio.accounts) ? rawPortfolio : null;
    const hasPortfolioContext = portfolio !== null;
    const tickerUpper = ctx.session.state.ticker.toUpperCase();
    // Current weight in this name = sum of the snapshot's priced rows for the
    // ticker (across all accounts). 0 when there is no portfolio or no priced
    // position (never fabricated from an unpriced holding).
    const currentWeightPct = hasPortfolioContext
      ? (portfolio?.holdings ?? [])
          .filter((h) => h.ticker.toUpperCase() === tickerUpper && h.weightPct != null)
          .reduce((s, h) => s + (h.weightPct ?? 0), 0)
      : 0;
    const weightDeltaPct = decision.portfolioFit.targetWeightPct - currentWeightPct;
    // Validate the LLM's suggested account LABEL against the real account list.
    // A hallucinated / absent label (or no portfolio) resolves to "" — never
    // invent an account the user does not have (real-money gate §1.8).
    const realLabels = new Set((portfolio?.accounts ?? []).map((a) => a.label));
    const suggestedAccount = realLabels.has(decision.portfolioFit.suggestedAccount)
      ? decision.portfolioFit.suggestedAccount
      : "";

    // Mirror the deterministic convergence read onto the memo so the PmHero
    // strip reads one place. Null on `fast` runs (the lens pack was skipped). A
    // registered-but-unwritten nullable single resource can surface as `{}`
    // (empty object), which would fail the memo's nullable schema if mirrored —
    // so normalize a partial/empty read to null (gate on `classification`).
    const rawConvergence = ctx.resources.lensConvergence?.state as
      | LensConvergenceState
      | null
      | undefined;
    const lensConvergence =
      rawConvergence != null && rawConvergence.classification != null
        ? rawConvergence
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
        // Slice 5 — portfolio-fit verdict with the four derived echo fields.
        portfolioFit: {
          action: decision.portfolioFit.action,
          targetWeightPct: decision.portfolioFit.targetWeightPct,
          sizingRationale: decision.portfolioFit.sizingRationale,
          concentrationRisk: decision.portfolioFit.concentrationRisk,
          convictionBasis: decision.portfolioFit.convictionBasis,
          suggestedAccount,
          currentWeightPct,
          weightDeltaPct,
          hasPortfolioContext,
          // Mirror the snapshot as-of so the UI labels the panel as a frozen
          // snapshot, not live (RISK-P3 provenance). Null when no portfolio.
          snapshotAsOf: portfolio?.snapshotAsOf ?? null,
        },
        lensConvergence,
      },
    );

    // Durable decision-of-record snapshot for outcome tracking and Past
    // Reports. Entry context comes from the trader memo's typed numeric
    // mirrors; `entryPrice` is reserved (null) until a price-history resource
    // exists (a Summary-feature concern). `patchState` is the session-scoped
    // single-resource write verb — the resource handle (`ResourceRef`) exposes
    // `patchState` / `setState` / `updateState`; there is no `.set()`. The
    // first `patchState` on this defaultless resource initializes it (nullable
    // fields the call omits fall back to their `.default(null)`), so passing
    // the full object is correct. Non-CAS last-write-wins; one write per run.
    const decidedAt = new Date().toISOString();
    await ctx.resources.decisionSnapshot.patchState({
      ticker: ctx.session.state.ticker,
      asOfDate: ctx.session.state.date,
      finalRating, // post-clamp value computed above
      decisionConfidence: decision.decisionConfidence,
      decisionSummary: decision.decisionSummary,
      direction:
        traderDirection === "long" ||
        traderDirection === "short" ||
        traderDirection === "flat"
          ? traderDirection
          : null,
      entryPrice: null, // TODO(outcome-tracking): source from price-history resource
      stopPrice: traderState?.stopPrice ?? null,
      targetPrice: traderState?.targetPrice ?? null,
      sizePct: traderState?.sizePct ?? null,
      holdingPeriod: traderState?.holdingPeriod ?? null,
      decidedAt,
      outcomeRealizedPrice: null,
      outcomeAsOf: null,
      outcomeVerdict: null,
    });

    // Enrich the session-metadata reports-index row so Past Reports renders
    // rich rows from `listSessions` alone. Additive shallow-merge — the four
    // tuple keys (ticker/date/costPreset/dataSource) written at create time are
    // preserved, so `findSessionForTuple`'s strict keying keeps matching.
    const decisionMeta: ReportDecisionMeta = {
      finalRating,
      decisionConfidence: decision.decisionConfidence,
      summary: decision.decisionSummary.slice(0, 160),
      decidedAt,
    };
    await ctx.session.setMetadata({
      metadata: { decision: decisionMeta, reportStatus: "complete" },
    });

    // Phase 5 is terminal — mark the run complete so the navigator
    // renders the "done" state. This used to be an `afterCommit` callback
    // on the writer factory; now it's just the next statement.
    await ctx.session.patchState({ runComplete: true });
  },
});
