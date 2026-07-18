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
 *     (`currentWeightPct == null`, held-but-unpriced) → SKIP the numeric clamp and
 *     let the pre-gate size pass through, relying on the `initiate`/`add`→`hold`
 *     action downgrade for the no-add (the `computePolicyGate`
 *     `householdWeightKnown: false` precedent — never fabricate a size from an
 *     unknown basis).
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

/** A financial payload carries its own tool-set `source` marker; an absent payload
 *  or `source: "unavailable"` means the underwriting-critical input was not obtained. */
type SourcedPayload = { source?: string } | null | undefined;

/**
 * DETERMINISTIC missing-substrate signal — the third evidence layer. True when ANY
 * of the four primary financial payloads is absent or `source: "unavailable"`.
 * Fail-closed OR (not AND): an "unavailable" payload is a truthy empty object that
 * passes the spine's `!statement` null-check, so a single missing statement can
 * leave the spine `sufficient` — any one missing must still gate new exposure.
 * Derived from the tool markers only, NEVER the LLM `dataQuality`/`evidenceBasis`.
 * Pure, so the writer and (later) the eval recompute it identically.
 */
export function deriveCriticalDataThin(
  fin:
    | {
        fundamentals?: SourcedPayload;
        incomeStatement?: SourcedPayload;
        balanceSheet?: SourcedPayload;
        cashflow?: SourcedPayload;
      }
    | null
    | undefined,
): boolean {
  const unavailable = (s: SourcedPayload) => s == null || s.source === "unavailable";
  return (
    unavailable(fin?.fundamentals) ||
    unavailable(fin?.incomeStatement) ||
    unavailable(fin?.balanceSheet) ||
    unavailable(fin?.cashflow)
  );
}

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
   *  held+priced, `null` = held-but-unpriced (unknown → the numeric clamp is
   *  skipped, exactly like `computePolicyGate`; the action downgrade still fires). */
  currentWeightPct: number | null;
};

export type EvidenceGateResult = {
  verdict: EvidenceVerdict;
  spineSufficient: boolean;
  rewardToRiskSufficient: boolean;
  /** Downward-only clamped weight (the FIX-761 policy-gate shape — always a
   *  number). When the current weight is unknown the clamp is SKIPPED and the
   *  pre-gate size passes through; the `action` downgrade is what enforces the
   *  no-add there. */
  targetWeightPct: number;
  sizeClamped: boolean;
  /** initiate|add → hold when insufficient; trim|exit|hold preserved. */
  action: PortfolioAction;
  actionDowngraded: boolean;
  /** False when the current weight was unknown (held-unpriced) → numeric clamp
   *  skipped (consumers read this to know the size wasn't capped, only the action). */
  currentWeightKnown: boolean;
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
      spineSufficient,
      rewardToRiskSufficient,
      targetWeightPct: input.targetWeightPct,
      sizeClamped: false,
      action: input.action,
      actionDowngraded: false,
      currentWeightKnown,
    };
  }

  // Insufficient → no-add, mirroring `computePolicyGate`'s exclusion clamp. When
  // the current weight is KNOWN, cap the target to it (0 for a not-held name →
  // portfolio-blind initiate goes to 0%). When it is UNKNOWN (held-but-unpriced),
  // SKIP the numeric clamp — never fabricate a size from an unknown basis — and
  // rely on the action downgrade for the no-add, exactly like the policy gate's
  // `householdWeightKnown: false` branch. A reducing action (trim/exit/hold) keeps
  // its own (already-reduced) target either way.
  let targetWeightPct = input.targetWeightPct;
  let sizeClamped = false;
  if (input.currentWeightPct != null) {
    const capped = Math.min(input.targetWeightPct, input.currentWeightPct);
    if (capped < input.targetWeightPct) {
      targetWeightPct = capped;
      sizeClamped = true;
    }
  }

  const action: PortfolioAction =
    input.action === "initiate" || input.action === "add" ? "hold" : input.action;

  return {
    verdict: "insufficient-evidence",
    spineSufficient,
    rewardToRiskSufficient,
    targetWeightPct,
    sizeClamped,
    action,
    actionDowngraded: action !== input.action,
    currentWeightKnown,
  };
}
