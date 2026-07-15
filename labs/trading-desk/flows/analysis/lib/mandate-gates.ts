/**
 * Risk-mandate SIZE gate math (FIX-752), extracted from the PM commit handler so
 * one formula backs both the live decision and the eval invariant layer (FIX-790).
 *
 * The mandate steers SIZE and emits a bright-line worth-it verdict; it NEVER
 * clamps the rating (that stays the valuation-anchored, cross-book signal). All
 * mandate effects are downward-only — the caps only reduce a size. `computeMandateGates`
 * derives the soft appetite gates + the hard capacity line + the verdict from the
 * reward-to-risk figure and the frozen dials; `clampTargetWeight` applies the
 * downward-only clamp (hard capacity veto first, then the soft worth-it cap).
 *
 * Pure, IO-free leaf (BP-019): imports only the `RiskMandate` dial type. The
 * reward-to-risk figure is accepted structurally (the fields the gates read) so
 * this module needs no resource import — the PM writer passes its `RewardToRiskState`
 * and the eval layer passes the bundle's `rewardToRisk`, both structurally compatible.
 */
import type { RiskMandate } from "./risk-mandate";

/** The reward-to-risk fields the mandate gates read. A structural subtype of both
 *  `RewardToRiskState` (the resource) and `RewardToRisk` (the pure figure). */
export type RewardToRiskFigure = {
  noDownside: boolean;
  lossAdjustedGlr: number | null;
  expectedValuePct: number | null;
  worstCaseReturnPct: number | null;
};

/** The soft + hard mandate gates, recomputed from the reward-to-risk figure and
 *  the frozen dials, plus the derived worth-it verdict. */
export type MandateGates = {
  /** Loss-adjusted GLR clears the floor (or the distribution has no downside). */
  rrCleared: boolean;
  /** Probability-weighted expected return clears the hurdle. */
  hurdleCleared: boolean;
  /** Decision confidence clears the floor. */
  confidenceCleared: boolean;
  /** All three soft appetite gates cleared. */
  cleared: boolean;
  /** The hard capacity line: worst case within tolerance. Fails CLOSED on a null
   *  worst case (a hard safety gate never silently passes an unknown worst case). */
  capacityCleared: boolean;
  /** Bright-line worth-it verdict: capacity must clear AND (soft gates clear OR a
   *  stated override) for the position to be worth it. */
  verdict: "clears" | "fails";
};

/**
 * Recompute the mandate gates from the reward-to-risk figure and the dials.
 * `override` is true when the PM supplied a non-empty mandate override reason.
 */
export function computeMandateGates(args: {
  mandate: RiskMandate;
  rr: RewardToRiskFigure;
  decisionConfidence: number;
  override: boolean;
}): MandateGates {
  const { mandate, rr, decisionConfidence, override } = args;

  // Soft gates (appetite/tolerance). A no-downside distribution treats the
  // reward-to-risk floor as cleared (the GLR is undefined there).
  const rrCleared =
    rr.noDownside ||
    (rr.lossAdjustedGlr != null && rr.lossAdjustedGlr >= mandate.rewardToRiskFloor);
  const hurdleCleared =
    rr.expectedValuePct != null && rr.expectedValuePct >= mandate.hurdleReturnPct;
  const confidenceCleared = decisionConfidence >= mandate.confidenceFloor;
  const cleared = rrCleared && hurdleCleared && confidenceCleared;

  // Hard capacity line: the worst-case bucket must be within tolerance. A null
  // worst case fails CLOSED — a hard safety gate must never silently pass an
  // unknown worst case.
  const capacityCleared =
    rr.worstCaseReturnPct != null &&
    rr.worstCaseReturnPct >= -mandate.maxTolerableLossPct;

  const verdict: "clears" | "fails" =
    capacityCleared && (cleared || override) ? "clears" : "fails";

  return { rrCleared, hurdleCleared, confidenceCleared, cleared, capacityCleared, verdict };
}

/**
 * Apply the downward-only mandate size clamp: the hard capacity veto first
 * (non-overridable, and — since `capacityVetoCapPct ≤ unclearedCapPct` for every
 * preset — the tighter cap), then the soft worth-it cap (lifted only by a stated
 * override reason). Returns the clamped weight and whether any clamp fired.
 */
export function clampTargetWeight(args: {
  targetWeightPct: number;
  mandate: RiskMandate;
  gates: MandateGates;
  override: boolean;
}): { targetWeightPct: number; sizeClamped: boolean } {
  const { mandate, gates, override } = args;
  let targetWeightPct = args.targetWeightPct;
  let sizeClamped = false;

  // Capacity veto first — non-overridable, the strongest line (capacity vetoes
  // appetite).
  if (!gates.capacityCleared && targetWeightPct > mandate.capacityVetoCapPct) {
    targetWeightPct = mandate.capacityVetoCapPct;
    sizeClamped = true;
  }
  // Soft worth-it cap — lifted only by a stated override reason.
  if (!gates.cleared && !override && targetWeightPct > mandate.unclearedCapPct) {
    targetWeightPct = mandate.unclearedCapPct;
    sizeClamped = true;
  }

  return { targetWeightPct, sizeClamped };
}
