/**
 * Composite setup score (0–100) blending value, quality, factor exposure,
 * and momentum signals into a single conviction-axis number.
 *
 * Weights: value .35, quality .30, factor .20, momentum .15.
 * Each sub-score is normalized to 0–100 before blending.
 */
import type { ExpectedReturn } from "./expected-return";

const W_VALUE = 0.35;
const W_QUALITY = 0.30;
const W_FACTOR = 0.20;
const W_MOMENTUM = 0.15;

export interface SetupScore {
  score: number | null;
  value: number | null;
  quality: number | null;
  factor: number | null;
  momentum: number | null;
  evidenceBasis: "sufficient" | "thin";
}

/** Clamp to [0, 100]. */
function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export function computeSetupScore(args: {
  expectedReturn: ExpectedReturn;
  /** Triangulated consensus margin of safety; null encodes "no value method". */
  marginOfSafety: number | null;
  quantComposites: { piotroskiF?: number; altmanZone?: string } | null;
  factorRanks: { compositeFactorPercentile?: number } | null;
  technicals: {
    trend?: string | null;
    sma50?: number | null;
    sma200?: number | null;
  } | null;
  valuation: { roic?: { value: number | null } } | null;
}): SetupScore {
  const { expectedReturn: er, marginOfSafety, quantComposites, factorRanks, technicals, valuation } = args;

  let componentCount = 0;

  // Value sub-score: margin of safety + excess return, normalized. The MoS term
  // is the TRIANGULATED consensus (FIX-807), so a deeply-negative DCF read for a
  // high-growth name materially lowers the value component even though the hard
  // absolute Buy gate stays return-anchored.
  let valueSub: number | null = null;
  if (er.excessReturn != null || marginOfSafety != null) {
    let v = 50; // neutral baseline
    if (er.excessReturn != null) {
      // +10% excess → 80, -10% → 20, linear in between
      v = clamp100(50 + er.excessReturn * 300);
    }
    if (marginOfSafety != null) {
      // +30% MoS → 80, -30% → 20. Saturates near 0 for deeply-negative reads
      // (an unbounded value penalty is not wanted).
      const mosScore = clamp100(50 + marginOfSafety * 100);
      v = (v + mosScore) / 2;
    }
    valueSub = v;
    componentCount++;
  }

  // Quality sub-score: Piotroski (0-9 → 0-100), ROIC, Altman zone
  let qualitySub: number | null = null;
  {
    const parts: number[] = [];
    const piotroski = quantComposites?.piotroskiF;
    if (piotroski != null) {
      parts.push(clamp100((piotroski / 9) * 100));
    }
    const roicVal = valuation?.roic?.value;
    if (roicVal != null) {
      // ROIC: 20% → 75, 40% → 100, 5% → ~38
      parts.push(clamp100(roicVal * 250 + 25));
    }
    const altmanZone = quantComposites?.altmanZone;
    if (altmanZone != null) {
      parts.push(altmanZone === "safe" ? 80 : altmanZone === "grey" ? 50 : 20);
    }
    if (parts.length > 0) {
      qualitySub = parts.reduce((a, b) => a + b, 0) / parts.length;
      componentCount++;
    }
  }

  // Factor sub-score: compositeFactorPercentile (already 0–100)
  let factorSub: number | null = null;
  const cfp = factorRanks?.compositeFactorPercentile;
  if (cfp != null) {
    factorSub = cfp;
    componentCount++;
  }

  // Momentum sub-score: trend label + SMA50/200 cross.
  //
  // The component contributes ONLY when there is a momentum reading to score:
  // a present `trend`, or BOTH moving averages. Otherwise it scores nothing and
  // does not count toward `componentCount` (FIX-1063).
  //
  // A merely present `technicals` object is not a reading. Two shapes made that
  // gate wrong before:
  //   - a fully unavailable payload (all nulls) recorded 50 − 10 = 40 — two
  //     null averages read as a DEATH CROSS on a name with no price data;
  //   - a 50-to-199-bar history, where `sma50` exists but `sma200` and `trend`
  //     are null, fired no directional branch yet still recorded the neutral 50
  //     and incremented the count — which can carry a run over the
  //     `componentCount >= 3` line to "sufficient" evidence on no momentum
  //     reading at all. That partial case is the one a naive fix leaves live,
  //     because the payload LOOKS populated.
  let momentumSub: number | null = null;
  const trend = technicals?.trend ?? null;
  const sma50 = technicals?.sma50 ?? null;
  const sma200 = technicals?.sma200 ?? null;
  const hasCross = sma50 != null && sma200 != null;
  if (trend != null || hasCross) {
    let m = 50;
    if (trend === "up") m += 20;
    else if (trend === "down") m -= 20;

    if (hasCross) {
      if (sma50 > sma200) m += 10; // golden cross
      else m -= 10; // death cross
    }
    momentumSub = clamp100(m);
    componentCount++;
  }

  const evidenceBasis: "sufficient" | "thin" = componentCount >= 3 ? "sufficient" : "thin";

  if (componentCount === 0) {
    return { score: null, value: null, quality: null, factor: null, momentum: null, evidenceBasis: "thin" };
  }

  // Weighted blend, only including available components
  let totalWeight = 0;
  let weightedSum = 0;
  if (valueSub != null) { weightedSum += W_VALUE * valueSub; totalWeight += W_VALUE; }
  if (qualitySub != null) { weightedSum += W_QUALITY * qualitySub; totalWeight += W_QUALITY; }
  if (factorSub != null) { weightedSum += W_FACTOR * factorSub; totalWeight += W_FACTOR; }
  if (momentumSub != null) { weightedSum += W_MOMENTUM * momentumSub; totalWeight += W_MOMENTUM; }

  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;

  return {
    score,
    value: valueSub != null ? Math.round(valueSub) : null,
    quality: qualitySub != null ? Math.round(qualitySub) : null,
    factor: factorSub != null ? Math.round(factorSub) : null,
    momentum: momentumSub != null ? Math.round(momentumSub) : null,
    evidenceBasis,
  };
}
