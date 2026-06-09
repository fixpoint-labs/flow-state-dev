/**
 * Scenario-derived reward-to-risk metric (FIX-752).
 *
 * Reads the probability-weighted outcome buckets the scenario forecaster already
 * produces (FIX-695) and computes a deterministic, legible reward-to-risk figure
 * the PM judges against the active risk mandate. The metric is a loss-aware
 * Gain/Loss ratio (Bernardo–Ledoit): probability-weighted upside over
 * probability-weighted downside, with the downside scaled by the mandate's
 * loss-aversion λ.
 *
 * Deliberately simple — every term is a `probability × move` product a reader can
 * verify by hand. The inputs are LLM-estimated probabilities, so the design
 * favors honesty over precision: no probability-weighting of tail buckets, no
 * prospect-theory curvature.
 *
 * Pure, IO-free leaf (BP-019) — the `computeExpectedReturn` nullable-honest shape.
 */

/** One scenario bucket the metric reads — a normalized probability and a signed
 *  expected return (%). The forecaster emits 3–5 of these. */
export interface RewardToRiskScenario {
  probability: number;
  expectedReturnPct: number;
}

/**
 * The derived reward-to-risk figure. Numeric fields are null when uncomputable
 * (no buckets); `noDownside` and `evidenceBasis` flag the honest edge cases.
 */
export interface RewardToRisk {
  /** Probability-weighted expected return over the buckets, signed %. */
  expectedValuePct: number | null;
  /** Probability-weighted upside (sum of p·r over up-buckets), %. */
  expectedGainPct: number | null;
  /** Probability-weighted downside magnitude (sum of p·|r| over down-buckets), %. */
  expectedLossPct: number | null;
  /** Plain Gain/Loss ratio (expectedGain / expectedLoss). Null when no downside. */
  glr: number | null;
  /** Loss-aware ratio: expectedGain / (λ · expectedLoss). Null when no downside. */
  lossAdjustedGlr: number | null;
  /** Worst single-bucket return, %. The capacity-veto input. */
  worstCaseReturnPct: number | null;
  /** Total probability mass on up-buckets. */
  probGain: number | null;
  /** True when no bucket is negative (expectedLoss == 0) — the GLR is undefined
   *  and the mandate treats the reward-to-risk floor as cleared. */
  noDownside: boolean;
  /** "thin" when fewer than three buckets or any return is non-finite — the PM is
   *  told the basis is thin rather than fed a fabricated figure. */
  evidenceBasis: "sufficient" | "thin";
}

/**
 * Compute the reward-to-risk figure from a scenario distribution.
 *
 * @param scenarios   The normalized buckets (probabilities need not be exactly
 *                    1; the metric is ratio-based so a small drift is harmless).
 * @param lossAversion The active mandate's λ (1 when mandate-blind). Values ≤ 0
 *                    fall back to 1 to keep the ratio well-defined.
 */
export function computeRewardToRisk(args: {
  scenarios: RewardToRiskScenario[];
  lossAversion: number;
}): RewardToRisk {
  const { scenarios } = args;
  const lambda = args.lossAversion > 0 ? args.lossAversion : 1;

  if (scenarios.length === 0) {
    return {
      expectedValuePct: null,
      expectedGainPct: null,
      expectedLossPct: null,
      glr: null,
      lossAdjustedGlr: null,
      worstCaseReturnPct: null,
      probGain: null,
      noDownside: false,
      evidenceBasis: "thin",
    };
  }

  const allFinite = scenarios.every(
    (s) => Number.isFinite(s.probability) && Number.isFinite(s.expectedReturnPct),
  );
  const evidenceBasis: "sufficient" | "thin" =
    scenarios.length < 3 || !allFinite ? "thin" : "sufficient";

  let expectedValuePct = 0;
  let expectedGainPct = 0;
  let expectedLossPct = 0;
  let probGain = 0;
  // Seed to +Infinity (not bucket 0's raw value) so the running-min below picks
  // up the first sanitized return — keeps the seed consistent with the
  // finiteness-guarded accumulators. `scenarios` is non-empty here (the empty
  // case returned above), so the loop always sets a finite value.
  let worstCaseReturnPct = Infinity;

  for (const s of scenarios) {
    const r = Number.isFinite(s.expectedReturnPct) ? s.expectedReturnPct : 0;
    const p = Number.isFinite(s.probability) ? s.probability : 0;
    expectedValuePct += p * r;
    if (r > 0) {
      expectedGainPct += p * r;
      probGain += p;
    } else if (r < 0) {
      expectedLossPct += p * -r;
    }
    if (r < worstCaseReturnPct) worstCaseReturnPct = r;
  }

  const noDownside = expectedLossPct === 0;
  const glr = noDownside ? null : expectedGainPct / expectedLossPct;
  const lossAdjustedGlr = noDownside
    ? null
    : expectedGainPct / (lambda * expectedLossPct);

  return {
    expectedValuePct,
    expectedGainPct,
    expectedLossPct,
    glr,
    lossAdjustedGlr,
    worstCaseReturnPct,
    probGain,
    noDownside,
    evidenceBasis,
  };
}
