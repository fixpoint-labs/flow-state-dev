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
import { z } from "zod";
import type { ExpectedReturn } from "./expected-return";
import type { FairValue } from "./fair-value";
import type { SetupScore } from "./setup-score";
import type { Triangulation } from "./triangulation";

export type AbsoluteRating = "Buy" | "Hold" | "Sell";
export type RelativeRating = "Overweight" | "Equal Weight" | "Underweight";

/** The five-tier final rating, low→high in tier order. Exported as a zod enum so
 *  every desk site that persists, mirrors, or maps the rating shares ONE
 *  definition — a future ladder change is a single edit here (adopted at each
 *  five-tier-enum site per the FIX-790 spec §4.1). A bare `z.enum` stays
 *  OpenAI strict-compatible (BP-016), so the PM generator output schema uses it
 *  directly. */
export const ratingSchema = z.enum([
  "Sell", "Underweight", "Hold", "Overweight", "Buy",
]);
export type FinalRating = z.infer<typeof ratingSchema>;

/** The rating ladder in tier order (low→high). Derived from `ratingSchema` so the
 *  order and the enum can never drift. */
export const RATING_LADDER: readonly FinalRating[] = ratingSchema.options;

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
  return RATING_LADDER[idx];
}

/** Tier position of a rating on the ladder (0 = Sell … 4 = Buy). Exported so the
 *  eval invariant layer can order-compare a stored rating against its band. */
export function ratingIndex(r: FinalRating): number {
  return RATING_LADDER.indexOf(r);
}

/** The rating band around a model-implied rating: floor = implied − 1 tier;
 *  ceiling = implied + 1, widened to +2 when the evidence is thin (missing
 *  valuation anchor / low-confidence return). Thin evidence grants extra room to
 *  be MORE bullish, never a free path below the implied rating (the downward
 *  spread is always 1). Extracted so the eval invariant layer (FIX-790)
 *  recomputes the band with the same formula `modelImpliedRating` writes it,
 *  not a duplicate. */
export function ratingBandFor(
  implied: FinalRating,
  thinEvidence: boolean,
): { floor: FinalRating; ceiling: FinalRating } {
  const idx = ratingIndex(implied);
  const upSpread = thinEvidence ? 2 : 1;
  return {
    floor: RATING_LADDER[Math.max(0, idx - 1)],
    ceiling: RATING_LADDER[Math.min(4, idx + upSpread)],
  };
}

export interface ValuationSpineInput {
  expectedReturn: ExpectedReturn;
  fairValue: FairValue;
  setupScore: SetupScore;
  /**
   * Cross-method consensus (FIX-807). Surfaced in the rationale ONLY — the hard
   * Buy/Hold gate stays anchored to the justified-PE margin of safety (`fv`), so
   * a conservative DCF read never floors a high-growth name to Hold (Open Q1:
   * soft-only, preserving FIX-778's return-anchored Buy). Optional so callers
   * predating the triangulation leg still type-check.
   */
  triangulation?: Triangulation;
}

export function modelImpliedRating(input: ValuationSpineInput): RatingEnvelope {
  const { expectedReturn: er, fairValue: fv, setupScore: ss, triangulation } = input;

  const abs = computeAbsoluteRating(er, fv);
  const rel = computeRelativeRating(ss);
  const implied = combinedRating(abs.rating, rel.rating);

  // Band: ±1 tier, widened UPWARD only on thin evidence (missing valuation /
  // low-confidence return) — extra room to be more bullish when the value anchor
  // is absent, never a free path *below* the implied rating (missing data is
  // absorbed by a lower decisionConfidence, not a lower rating). See
  // `ratingBandFor`, the single formula the eval invariant recomputes against.
  const thin = ss.evidenceBasis === "thin" || er.lowConfidence;
  const { floor, ceiling } = ratingBandFor(implied, thin);

  // Surface the consensus margin of safety so the prompt shows the triangulated
  // number; it does NOT enter the gate conditions above.
  const consensus =
    triangulation != null && triangulation.marginOfSafety != null
      ? `; consensus margin of safety ${(triangulation.marginOfSafety * 100).toFixed(0)}% (${triangulation.divergence})`
      : "";
  const rationale = `absolute: ${abs.rationale}; relative: ${rel.rationale}${consensus}`;

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
  return { final: RATING_LADDER[clampedIdx], clamped: true };
}
