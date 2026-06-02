/**
 * Composite setup score (0–100) blending value, quality, factor exposure,
 * and momentum signals into a single conviction-axis number.
 *
 * Weights: value .35, quality .30, factor .20, momentum .15.
 * Each sub-score is normalized to 0–100 before blending.
 */
import type { ExpectedReturn } from "./expected-return";
import type { FairValue } from "./fair-value";

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
  fairValue: FairValue;
  quantComposites: { piotroskiF?: number; altmanZone?: string } | null;
  factorRanks: { compositeFactorPercentile?: number } | null;
  technicals: { trend?: string; sma50?: number; sma200?: number } | null;
  valuation: { roic?: { value: number | null } } | null;
}): SetupScore {
  const { expectedReturn: er, fairValue: fv, quantComposites, factorRanks, technicals, valuation } = args;

  let componentCount = 0;

  // Value sub-score: margin of safety + excess return, normalized
  let valueSub: number | null = null;
  if (er.excessReturn != null || (fv.marginOfSafety != null && fv.available)) {
    let v = 50; // neutral baseline
    if (er.excessReturn != null) {
      // +10% excess → 80, -10% → 20, linear in between
      v = clamp100(50 + er.excessReturn * 300);
    }
    if (fv.marginOfSafety != null && fv.available) {
      // +30% MoS → 80, -30% → 20
      const mosScore = clamp100(50 + fv.marginOfSafety * 100);
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

  // Momentum sub-score: trend label + SMA50/200 cross
  let momentumSub: number | null = null;
  if (technicals) {
    let m = 50;
    if (technicals.trend === "up") m += 20;
    else if (technicals.trend === "down") m -= 20;

    if (technicals.sma50 != null && technicals.sma200 != null) {
      if (technicals.sma50 > technicals.sma200) m += 10; // golden cross
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
