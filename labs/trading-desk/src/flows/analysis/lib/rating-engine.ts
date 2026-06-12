/**
 * Deterministic rating engine: two independent axes plus a combined rating.
 *
 * Absolute axis (Buy / Hold / Sell): anchored to expected return + margin
 * of safety. Answers "is this stock worth owning at this price?"
 *
 * Relative axis (Overweight / Equal Weight / Underweight): anchored to
 * the setup score (0–100 composite of value/quality/factor/momentum).
 * Answers "how much to allocate vs. baseline?"
 *
 * Combined: the two axes merge into a 5-tier finalRating via a score
 * matrix (absolute ±2, relative ±1).
 *
 * Band: the combined rating ±1 tier. PM picks within the band freely;
 * stepping outside requires a non-empty ratingOverrideReason.
 */
import type { ExpectedReturn } from "./expected-return";
import type { FairValue } from "./fair-value";
import type { SetupScore } from "./setup-score";

export type AbsoluteRating = "Buy" | "Hold" | "Sell";
export type RelativeRating = "Overweight" | "Equal Weight" | "Underweight";
export type FinalRating = "Sell" | "Underweight" | "Hold" | "Overweight" | "Buy";

const FINAL_RATING_LADDER: FinalRating[] = [
  "Sell", "Underweight", "Hold", "Overweight", "Buy",
];

export interface RatingEnvelope {
  absoluteRating: AbsoluteRating;
  relativeRating: RelativeRating;
  implied: FinalRating;
  floor: FinalRating;
  ceiling: FinalRating;
  rationale: string;
}

// ── Absolute axis thresholds ────────────────────────────────────────
// Buy:  excessReturn ≥ +10%, AND marginOfSafety ≥ 25% when a valid MoS
//       reading exists. A null MoS (no applicable valuation method — e.g.
//       high-growth names outside the Gordon domain, financials) is NO
//       EVIDENCE, not a failed value test: the floor must not fire on it
//       (FIX-778 — missing data is absorbed by confidence, never by a
//       lower rating).
// Hold: -3% ≤ excessReturn < +10%, OR mixed/thin, OR a VALID MoS < 25%
// Sell: excessReturn < -3%

function computeAbsoluteRating(
  er: ExpectedReturn,
  fv: FairValue,
): { rating: AbsoluteRating; rationale: string } {
  if (er.lowConfidence || er.excessReturn == null) {
    return { rating: "Hold", rationale: "insufficient data for return estimate" };
  }

  const xr = er.excessReturn;
  const mos = fv.marginOfSafety;

  if (xr < -0.03) {
    return {
      rating: "Sell",
      rationale: `excess return ${(xr * 100).toFixed(1)}% < -3% hurdle`,
    };
  }

  if (xr >= 0.10 && mos == null) {
    return {
      rating: "Buy",
      rationale: `excess return ${(xr * 100).toFixed(1)}% ≥ 10%; margin of safety unavailable (no applicable valuation method) — return-anchored`,
    };
  }

  if (xr >= 0.10 && mos != null && mos >= 0.25) {
    return {
      rating: "Buy",
      rationale: `excess return ${(xr * 100).toFixed(1)}% ≥ 10% and margin of safety ${(mos * 100).toFixed(0)}% ≥ 25%`,
    };
  }

  // Reaching here with xr ≥ 0.10 implies mos != null && mos < 0.25 (the
  // null-MoS case returned Buy above); the && narrows mos without an
  // assertion so a future guard reorder fails the compile, not the runtime.
  return {
    rating: "Hold",
    rationale: xr >= 0.10 && mos != null
      ? `excess return ${(xr * 100).toFixed(1)}% but margin of safety ${(mos * 100).toFixed(0)}% < 25%`
      : `excess return ${(xr * 100).toFixed(1)}% within neutral band`,
  };
}

// ── Relative axis thresholds ────────────────────────────────────────
// Overweight:   score ≥ 65
// Equal Weight: 40 ≤ score < 65
// Underweight:  score < 40

function computeRelativeRating(
  ss: SetupScore,
): { rating: RelativeRating; rationale: string } {
  if (ss.score == null) {
    return { rating: "Equal Weight", rationale: "insufficient data for setup score" };
  }

  if (ss.score >= 65) {
    return {
      rating: "Overweight",
      rationale: `setup score ${ss.score} ≥ 65`,
    };
  }
  if (ss.score < 40) {
    return {
      rating: "Underweight",
      rationale: `setup score ${ss.score} < 40`,
    };
  }
  return {
    rating: "Equal Weight",
    rationale: `setup score ${ss.score} in neutral band [40, 65)`,
  };
}

// ── Combined rating ─────────────────────────────────────────────────

function absoluteScore(r: AbsoluteRating): number {
  return r === "Buy" ? 2 : r === "Sell" ? -2 : 0;
}

function relativeScore(r: RelativeRating): number {
  return r === "Overweight" ? 1 : r === "Underweight" ? -1 : 0;
}

function combinedRating(abs: AbsoluteRating, rel: RelativeRating): FinalRating {
  const score = absoluteScore(abs) + relativeScore(rel);
  // Map: -3..-2 → Sell(0), -1 → Underweight(1), 0 → Hold(2),
  //       1 → Overweight(3), 2..3 → Buy(4)
  const idx = Math.max(0, Math.min(4, score + 2));
  return FINAL_RATING_LADDER[idx];
}

function ratingIndex(r: FinalRating): number {
  return FINAL_RATING_LADDER.indexOf(r);
}

export interface ValuationSpineInput {
  expectedReturn: ExpectedReturn;
  fairValue: FairValue;
  setupScore: SetupScore;
}

export function modelImpliedRating(input: ValuationSpineInput): RatingEnvelope {
  const { expectedReturn: er, fairValue: fv, setupScore: ss } = input;

  const abs = computeAbsoluteRating(er, fv);
  const rel = computeRelativeRating(ss);
  const implied = combinedRating(abs.rating, rel.rating);
  const idx = ratingIndex(implied);

  // Band: ±1 tier. Thin evidence (missing valuation / low-confidence return)
  // widens the band UPWARD only. It grants extra room to be more bullish when
  // the deterministic value anchor is absent, but must NOT open a free path
  // *below* the model-implied rating: missing data is absorbed by a lower
  // decisionConfidence, never by a lower rating. So the downward spread is
  // always 1; only the upward spread reacts to thin evidence.
  const thin = ss.evidenceBasis === "thin" || er.lowConfidence;
  const downSpread = 1;
  const upSpread = thin ? 2 : 1;
  const floor = FINAL_RATING_LADDER[Math.max(0, idx - downSpread)];
  const ceiling = FINAL_RATING_LADDER[Math.min(4, idx + upSpread)];

  const rationale = `absolute: ${abs.rationale}; relative: ${rel.rationale}`;

  return {
    absoluteRating: abs.rating,
    relativeRating: rel.rating,
    implied,
    floor,
    ceiling,
    rationale,
  };
}

export function clampRatingToBand(
  llmRating: FinalRating,
  envelope: RatingEnvelope,
  overrideReason: string,
): { final: FinalRating; clamped: boolean } {
  const llmIdx = ratingIndex(llmRating);
  const floorIdx = ratingIndex(envelope.floor);
  const ceilingIdx = ratingIndex(envelope.ceiling);

  if (llmIdx >= floorIdx && llmIdx <= ceilingIdx) {
    return { final: llmRating, clamped: false };
  }

  // PM is outside the band — allow if reason given
  if (overrideReason.trim().length > 0) {
    return { final: llmRating, clamped: false };
  }

  // Clamp to nearest band edge
  const clampedIdx = llmIdx < floorIdx ? floorIdx : ceilingIdx;
  return { final: FINAL_RATING_LADDER[clampedIdx], clamped: true };
}
