/**
 * Portfolio-manager commit handler (runs second in Phase 5, terminal).
 *
 *   - `commitPortfolioManagerMemo` — the terminal commit. It does several
 *     deterministic jobs the LLM is NOT trusted with, then publishes the memo,
 *     writes the durable decision snapshot, and flips `session.runComplete`:
 *       1. derives `agreesWithTrader` (trader direction vs the PM's rating) and
 *          `upstreamReferences` (from the canonical key maps);
 *       2. enforces trader-dependency lineage (throws `lineage-violation` →
 *          memo flips to `error`);
 *       3. clamps `finalRating` to the FIX-715 valuation envelope (logged escape);
 *       4. derives the FIX-728 portfolio-fit echo fields (current weight, delta,
 *          validated suggested account);
 *       5. applies the FIX-752 risk-mandate SIZE gate — derives the worth-it
 *          verdict and clamps `targetWeightPct` (hard capacity veto, then soft
 *          worth-it cap); the mandate never touches `finalRating`.
 *
 * The mandate gate and the valuation clamp are independent: the valuation
 * envelope bounds the rating; the mandate bounds the size. Both only reduce.
 *
 * The `runComplete` patch is inline at the end of the PM handler — not
 * abstracted into a factory callback. This is the cleanest expression of
 * "this commit also marks the run complete": one statement, in the same
 * scope as the rest of the commit body.
 *
 * The memo `writing`/`error` lifecycle is no longer built here — it comes from
 * the keyed `markWriting`/`markError` resolved by `defineMemoStep` from the
 * registry entry in `orchestration/stages.ts`.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  PHASE_1_MEMO_KEYS,
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
} from "../../registry";
import {
  decisionSnapshotResource,
  type DecisionSnapshotState,
} from "../../decision-snapshot-resource";
import { clampRatingToBand } from "../../lib/rating-engine";
import { clampTargetWeight, computeMandateGates } from "../../lib/mandate-gates";
import { computePolicyGate } from "../../lib/policy-gate";
import { publishMemo } from "../_recipe/memo-writer";
import type { ReportDecisionMeta } from "../../report-index";
import {
  memoResources,
  type MandateDecision,
  type PolicyDecision,
} from "../../resources";
import { sessionStateSchema } from "../../state";
import { valuationSpineResource, type ValuationSpineState } from "../../valuation-spine-resource";
import {
  rewardToRiskResource,
  type RewardToRiskState,
} from "../../reward-to-risk-resource";
import {
  lensConvergenceResource,
  type LensConvergenceState,
} from "../lenses/lens-convergence-resource";
import { portfolioDecisionOutputSchema } from "./portfolio-manager";

// ── Portfolio manager ────────────────────────────────────────────────

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
    // FIX-752 — the scenario-derived reward-to-risk figure, gated against the
    // frozen mandate to clamp size + derive the worth-it verdict. Null when the
    // forecaster produced no usable buckets (→ mandate-blind decision).
    rewardToRisk: rewardToRiskResource,
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
    // the keyed mark-error rescue, which flips the memo to `error`.
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

    // ── Risk-mandate worth-it size gate (FIX-752) ──────────────────────
    // The mandate steers SIZE and emits a derived verdict; it NEVER clamps the
    // rating (that stays the valuation-anchored, cross-book-comparable name
    // signal). All mandate effects are downward-only. The bright-line verdict and
    // the clamp are derived here from the figure + the frozen dials — never
    // trusted from the LLM (the agreesWithTrader precedent); the PM's `mandateFit`
    // supplies only the narrative + an optional override reason.
    const mandate = ctx.session.state.riskMandate;
    const rr = ctx.resources.rewardToRisk?.state as
      | RewardToRiskState
      | null
      | undefined;
    let targetWeightPct = decision.portfolioFit.targetWeightPct;
    let mandateDecision: MandateDecision | null = null;

    if (mandate != null && rr != null && rr.evidenceBasis != null) {
      const override = decision.mandateFit.mandateOverrideReason.trim().length > 0;
      // Recompute the soft appetite gates + hard capacity line + verdict, then
      // apply the downward-only size clamp — the same `lib/mandate-gates.ts`
      // formula the eval invariant layer recomputes against (FIX-790).
      const gates = computeMandateGates({
        mandate,
        rr,
        decisionConfidence: decision.decisionConfidence,
        override,
      });
      const clamped = clampTargetWeight({
        targetWeightPct,
        mandate,
        gates,
        override,
      });
      targetWeightPct = clamped.targetWeightPct;

      mandateDecision = {
        mandateId: mandate.id,
        mandateLabel: mandate.label,
        verdict: gates.verdict,
        cleared: gates.cleared,
        capacityVetoed: !gates.capacityCleared,
        sizeClamped: clamped.sizeClamped,
        lossAdjustedGlr: rr.lossAdjustedGlr,
        expectedValuePct: rr.expectedValuePct,
        worstCaseReturnPct: rr.worstCaseReturnPct,
        noDownside: rr.noDownside,
        evidenceBasis: rr.evidenceBasis,
        rewardToRiskRead: decision.mandateFit.rewardToRiskRead,
        sizeStance: decision.mandateFit.sizeStance,
        overrideReason: decision.mandateFit.mandateOverrideReason,
      };
    }

    // ── Durable portfolio-mandate policy gate (FIX-761) ────────────────
    // Runs AFTER the FIX-752 clamp. The household mandate's HARD single-name
    // constraints — a max-position-weight cap (at-purchase, floored at the
    // household weight so an already-over-cap hold is never force-trimmed) and an
    // exclusion no-add — clamp `targetWeightPct` down deterministically. Min-cash
    // + allocation drift are ADVISORY (surfaced in `<portfolioMandate>`, the PM
    // narrates). Derived here, never trusted from the LLM (the agreesWithTrader
    // precedent); the PM's `policyFit` supplies only the two narrative strings.
    // The mandate NEVER touches `finalRating` (the FIX-715/FIX-752 orthogonality),
    // and every effect is downward-only. `preGatePolicyTargetPct` is the size
    // entering the gate (post-FIX-752), so a clamp is attributable to the policy
    // cap vs the FIX-752 gate.
    // NOTE (scoped-run cap precision): `householdWeightPct` and the mandate cap are
    // household-NAV percentages; on a scoped run the PM's `targetWeightPct` is a
    // percentage of the scoped snapshot's NAV. Clamping the scoped target to the
    // household cap only ever OVER-restricts on a scoped run (the safe direction —
    // a name can never exceed the household cap), and the common no-selection run
    // has one NAV so there is no mismatch. Converting units is a deferred
    // refinement (see docs/portfolio-mandate.md).
    const preGatePolicyTargetPct = targetWeightPct;
    const gate = computePolicyGate({
      mandate: ctx.session.state.portfolioMandate,
      ticker: ctx.session.state.ticker,
      targetWeightPct,
      householdWeightPct: ctx.session.state.householdTickerWeightPct,
    });
    targetWeightPct = gate.targetWeightPct;
    // An EXCLUDED name can NEVER be published as an add/initiate — the mandate
    // says the name is never added to. This holds even on the unpriced-held branch
    // (where we could not numerically clamp the size): the exclusion is known, so
    // the ACTION must not assert an increase (the PmHero card colors/labels off
    // `action`, so a hard no-add must not render as a green add). Downgrade to
    // "hold"; a trim/exit/hold the PM already chose is left intact (reducing or
    // holding an excluded name is fine). The `maxPositionWeight` cap is NOT
    // overridden here — a capped buy is still a legitimate (smaller) add.
    const gatedAction =
      gate.excluded &&
      (decision.portfolioFit.action === "add" || decision.portfolioFit.action === "initiate")
        ? "hold"
        : decision.portfolioFit.action;
    const policyDecision: PolicyDecision | null =
      gate.policyVerdict === "no-mandate"
        ? null
        : {
            mandatePresent: true,
            policyVerdict: gate.policyVerdict,
            positionCapClamped: gate.positionCapClamped,
            excluded: gate.excluded,
            householdWeightKnown: gate.householdWeightKnown,
            preGatePolicyTargetPct,
            allocationRead: decision.policyFit.allocationRead,
            constraintRead: decision.policyFit.constraintRead,
          };

    const weightDeltaPct = targetWeightPct - currentWeightPct;

    // Keep the hero's `metrics.size` chip in sync with the clamped size. Any
    // downward clamp (FIX-752 worth-it/capacity, or the FIX-761 cap/exclusion)
    // lowers `targetWeightPct` below the LLM's proposal, but `metrics.size` is the
    // model's pre-gate display string — so a capped run could advertise "8%" in
    // the header while the portfolio-fit / policy panels show "2%". When a clamp
    // reduced the size, overwrite the size chip with the enforced figure so the
    // user-facing recommendation is internally consistent (the enforced number is
    // the one the desk stands behind). Untouched when no clamp fired (preserve the
    // model's own precision/format).
    const sizeWasClamped = targetWeightPct < decision.portfolioFit.targetWeightPct;
    const displayMetrics = sizeWasClamped
      ? {
          ...decision.metrics,
          size: `${Number.isInteger(targetWeightPct) ? targetWeightPct : targetWeightPct.toFixed(1)}%`,
        }
      : decision.metrics;

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
      PHASE_5_MEMO_KEYS.portfolioManager.collectionKey,
      {
        label: decision.label,
        headline: decision.headline,
        rating: decision.rating,
        body: decision.body,
        metrics: displayMetrics,
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
        // `targetWeightPct` is the mandate-gated value (FIX-752): the LLM's size
        // after the worth-it/capacity clamps, so the published size, the delta,
        // and the decision snapshot all agree.
        portfolioFit: {
          // The policy-gated action: an excluded name never publishes add/initiate
          // (FIX-761), so the card can't render a hard no-add as a green add.
          action: gatedAction,
          targetWeightPct,
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
        // FIX-752 — the mandate decision mirror for the PmHero panel. Null on a
        // mandate-blind run.
        mandateDecision,
        // FIX-761 — the durable-mandate policy decision mirror (verdict + clamps +
        // narrative) for the PmHero policy-fit block. Null on a mandate-blind run.
        policyDecision,
        // FIX-676 — pass through any URLs the PM fetched (null when none).
        citations: decision.citations,
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
      // Risk-mandate decision (FIX-752) — the FIX-614 sensitivity-benchmark
      // record. Null on a mandate-blind run.
      mandateId: mandateDecision?.mandateId ?? null,
      mandateVerdict: mandateDecision?.verdict ?? null,
      rewardToRiskLossAdjustedGlr: mandateDecision?.lossAdjustedGlr ?? null,
      worstCaseReturnPct: mandateDecision?.worstCaseReturnPct ?? null,
      capacityVetoed: mandateDecision?.capacityVetoed ?? null,
      // Standing-thesis echo (FIX-760) — true when a durable thesis was frozen
      // and reached the decision tier. Derived from frozen state, the
      // `hasPortfolioContext` precedent (never trusted from the LLM).
      hasStandingThesis: ctx.session.state.standingThesis != null,
      // Durable portfolio-mandate echo (FIX-761) — the machine-scoreable record of
      // how the standing policy shaped the size. Null on a mandate-blind run.
      mandatePresent: policyDecision != null,
      policyVerdict: policyDecision?.policyVerdict ?? null,
      positionCapClamped: policyDecision?.positionCapClamped ?? null,
      excluded: policyDecision?.excluded ?? null,
      preGatePolicyTargetPct: policyDecision?.preGatePolicyTargetPct ?? null,
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
