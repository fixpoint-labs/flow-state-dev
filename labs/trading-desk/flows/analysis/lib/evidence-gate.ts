/**
 * The pure, deterministic evidence-sufficiency gate (FIX-781).
 *
 * An always-on capital gate — the sibling of `computePolicyGate` (FIX-761) and
 * `computeMandateGates` (FIX-752). It caps NEW exposure when the evidence behind a
 * call is too thin: an absent/thin valuation spine, an absent/thin reward-to-risk
 * figure, or an unavailable primary financial input. Independent of the optional
 * risk mandate, so it fires on mandate-blind and portfolio-blind runs alike.
 *
 * What it enforces (no-add, downward-only, non-overridable):
 *   - INSUFFICIENT evidence → cap the target at the current position
 *     (`min(target, currentWeight)`); `initiate`/`add` become `hold`; `trim`,
 *     `exit`, and an existing `hold` are preserved.
 *   - When the current position can't be measured in the run's own NAV basis
 *     (`currentWeightPct == null`) → WITHHOLD the numeric target rather than
 *     publish an uncapped positive % (never fabricate a trim from a wrong-basis
 *     or partial weight).
 *
 * UNITS: percentage points 0..100 (matching `targetWeightPct`). `currentWeightPct`
 * is the analyzed ticker's weight in the run's OWN NAV basis (the frozen
 * `scopedTickerWeightPct`) — NOT the household weight the FIX-761 policy gate uses.
 *
 * Never touches `finalRating` (the FIX-715 / FIX-752 / FIX-761 orthogonality — a
 * bearish rating on observed negative evidence still stands; only new exposure is
 * gated). Pure leaf (BP-019): imports only a TYPE.
 */
import type { PortfolioDecisionOutput } from "../agents/portfolio-manager/portfolio-manager";

/** The five PM actions. Reuses the generator's own output type so the gate can't
 *  drift from the emitted enum (no runtime import — the type is erased). */
export type PortfolioAction = PortfolioDecisionOutput["portfolioFit"]["action"];

export type EvidenceVerdict = "sufficient" | "insufficient-evidence";

export type EvidenceGateInput = {
  /** Valuation-spine evidenceBasis; null when the spine resource is absent
   *  (fail-closed → treated as thin). */
  spineEvidenceBasis: "sufficient" | "thin" | null;
  /** Spine expectedReturn.lowConfidence. The spine's evidenceBasis already folds
   *  this (valuation-spine.ts), but read it explicitly so the gate stays correct
   *  if that fold ever changes (the acceptance criterion lists both). */
  spineLowConfidence: boolean;
  /** Reward-to-risk evidenceBasis; null when the figure is absent (→ thin). */
  rewardToRiskEvidenceBasis: "sufficient" | "thin" | null;
  /** Deterministic missing-substrate signal — true when any primary financial
   *  input was unavailable. Derived by the writer from the tool-set `source`
   *  markers, NOT the LLM self-report (see `deriveCriticalDataThin`). Closes the
   *  "forecaster emits ≥3 buckets on thin substrate → reward-to-risk reads
   *  sufficient" hole. */
  criticalDataThin: boolean;
  /** The action entering the gate (post-FIX-761 downgrade). */
  action: PortfolioAction;
  /** Size entering the gate (pct points), post-FIX-752 + post-FIX-761 clamps. */
  targetWeightPct: number;
  /** The analyzed ticker's current weight in the SAME NAV basis as
   *  `targetWeightPct` (the frozen `scopedTickerWeightPct`). Three-value
   *  contract: `0` = not held (portfolio-blind or not in this book), positive =
   *  held+priced, `null` = held-but-unpriced (unknown → withhold). */
  currentWeightPct: number | null;
};

export type EvidenceGateResult = {
  verdict: EvidenceVerdict;
  sufficient: boolean;
  spineSufficient: boolean;
  rewardToRiskSufficient: boolean;
  /** Downward-only clamped weight; null when `targetWithheld`. */
  targetWeightPct: number | null;
  sizeClamped: boolean;
  /** initiate|add → hold when insufficient; trim|exit|hold preserved. */
  action: PortfolioAction;
  actionDowngraded: boolean;
  /** False when the current weight was unknown (held-unpriced) → clamp skipped. */
  currentWeightKnown: boolean;
  /** True when insufficient and the current weight was unknown → the published
   *  `targetWeightPct` is null (no numeric authorization). */
  targetWithheld: boolean;
};

/**
 * Compute the deterministic evidence-sufficiency gate for the analyzed ticker.
 * Pure, IO-free, never throws, idempotent, downward-only.
 */
export function computeEvidenceGate(input: EvidenceGateInput): EvidenceGateResult {
  const spineSufficient =
    input.spineEvidenceBasis === "sufficient" && !input.spineLowConfidence;
  const rewardToRiskSufficient = input.rewardToRiskEvidenceBasis === "sufficient";
  const sufficient =
    spineSufficient && rewardToRiskSufficient && !input.criticalDataThin;

  const currentWeightKnown = input.currentWeightPct != null;

  if (sufficient) {
    return {
      verdict: "sufficient",
      sufficient: true,
      spineSufficient,
      rewardToRiskSufficient,
      targetWeightPct: input.targetWeightPct,
      sizeClamped: false,
      action: input.action,
      actionDowngraded: false,
      currentWeightKnown,
      targetWithheld: false,
    };
  }

  // Insufficient → no-add. Cap to the (basis-consistent) current weight when
  // known; else withhold the numeric target (never publish an uncapped positive
  // %, never fabricate a trim/exit from a partial or wrong-basis weight).
  let targetWeightPct: number | null = input.targetWeightPct;
  let sizeClamped = false;
  let targetWithheld = false;
  if (currentWeightKnown) {
    const capped = Math.min(input.targetWeightPct, input.currentWeightPct as number);
    if (capped < input.targetWeightPct) {
      targetWeightPct = capped;
      sizeClamped = true;
    }
  } else {
    targetWeightPct = null;
    targetWithheld = true;
  }

  const action: PortfolioAction =
    input.action === "initiate" || input.action === "add" ? "hold" : input.action;

  return {
    verdict: "insufficient-evidence",
    sufficient: false,
    spineSufficient,
    rewardToRiskSufficient,
    targetWeightPct,
    sizeClamped,
    action,
    actionDowngraded: action !== input.action,
    currentWeightKnown,
    targetWithheld,
  };
}
