/**
 * Deterministic lens-convergence math — the FIX-655 honesty guarantee, as a
 * pure function so it is unit-testable without a runtime.
 *
 * Convergence is ARITHMETIC over independent lens verdicts, never an LLM
 * narrative. `computeConvergence` takes the N verdict records and returns the
 * `lensConvergenceState` the resource stores. The classification boundaries are
 * the intent-encoding test (`test/lens-convergence.spec.ts`): change the rule
 * and a test must change.
 *
 * Rules (BUILD_PLAN §7 / spec 05 §2.5):
 *   - stanceSign:  bullish → +1, neutral → 0, bearish → −1
 *   - netLean   =  Σ(stanceSign × conviction) / N            ∈ [−1, 1]
 *   - majorityStance = the modal stance; ties → "neutral"
 *   - agreementScore = (# lenses on the majority stance) / N  ∈ [0, 1]
 *   - classification: agreementScore ≥ 0.8 → "convergent"
 *                     agreementScore ≥ 0.5 → "mixed"
 *                     else                 → "divergent"
 *   - dissenters = lens ids whose stance ≠ majorityStance
 *
 * v1 is EQUAL-WEIGHT by conviction (open-Q#3): a lens that flagged a `dataGap`
 * is NOT down-weighted yet — the gap is surfaced in the UI so the reader
 * discounts it. Revisit weighting after observing real divergence.
 *
 * Pure leaf: imports only the convergence types. No runtime, no IO.
 */
import type {
  LensConvergenceState,
  LensVerdictRecord,
} from "../../resources/lens-convergence";

type Stance = "bullish" | "neutral" | "bearish";

/** +1 / 0 / −1 directional sign for a stance. */
function stanceSign(stance: Stance): number {
  if (stance === "bullish") return 1;
  if (stance === "bearish") return -1;
  return 0;
}

/**
 * Compute the deterministic convergence summary from the committed lens
 * verdicts. With zero verdicts (every lens errored) it returns a neutral,
 * divergent-by-absence-of-agreement shell rather than throwing — the caller
 * (a `.tap`) should still write SOMETHING so the UI can say "no verdicts".
 */
export function computeConvergence(
  verdicts: LensVerdictRecord[],
): LensConvergenceState {
  const n = verdicts.length;
  if (n === 0) {
    return {
      verdicts: [],
      netLean: 0,
      agreementScore: 0,
      classification: "divergent",
      majorityStance: "neutral",
      dissenters: [],
    };
  }

  // netLean — conviction-weighted directional lean.
  const netLean =
    verdicts.reduce((sum, v) => sum + stanceSign(v.stance) * v.conviction, 0) / n;

  // Modal stance. Count each stance; ties resolve to "neutral" (the
  // deliberately conservative tie-break — never invent a direction from a tie).
  const counts: Record<Stance, number> = { bullish: 0, neutral: 0, bearish: 0 };
  for (const v of verdicts) counts[v.stance] += 1;
  const maxCount = Math.max(counts.bullish, counts.neutral, counts.bearish);
  const leaders = (["bullish", "neutral", "bearish"] as const).filter(
    (s) => counts[s] === maxCount,
  );
  const majorityStance: Stance = leaders.length === 1 ? leaders[0] : "neutral";

  // agreementScore — fraction of lenses on the majority stance.
  const agreementScore = counts[majorityStance] / n;

  const classification: LensConvergenceState["classification"] =
    agreementScore >= 0.8 ? "convergent" : agreementScore >= 0.5 ? "mixed" : "divergent";

  const dissenters = verdicts
    .filter((v) => v.stance !== majorityStance)
    .map((v) => v.lensId);

  return {
    verdicts,
    netLean,
    agreementScore,
    classification,
    majorityStance,
    dissenters,
  };
}
