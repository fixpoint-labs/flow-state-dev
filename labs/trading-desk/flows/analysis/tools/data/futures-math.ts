/**
 * Pure futures-curve math.
 *
 * `get_futures_curve` reads a fixed basket of benchmark futures and reduces each
 * to a front-month level, a session change, and a front-vs-next spread. These
 * functions hold the judgment — where the contango/backwardation flat band sits,
 * how the equity-index and gold legs combine into a composite risk tone — so
 * they live in their own pure, unit-tested module. No IO, no fetch.
 *
 * `null` in → `null` out everywhere: an unpriced leg is "unknown", never 0.
 */

/** Asset class of a basket product — drives the composite `riskTone` read. */
export type FuturesAssetClass = "equity-index" | "energy" | "metal" | "rates";

/** Front-month last vs the prior session close, as a fraction. `null` when
 *  either price is missing or prior is non-positive. */
export function changePct(last: number | null, priorClose: number | null): number | null {
  if (last === null || priorClose === null) return null;
  if (!Number.isFinite(last) || !Number.isFinite(priorClose) || priorClose <= 0) return null;
  return (last - priorClose) / priorClose;
}

/** Front-to-next contract spread: (next − front) / front, as a fraction.
 *  Positive = the deferred contract trades richer than the front. `null` when
 *  either price is missing or front is non-positive. */
export function frontNextSpreadPct(front: number | null, next: number | null): number | null {
  if (front === null || next === null) return null;
  if (!Number.isFinite(front) || !Number.isFinite(next) || front <= 0) return null;
  return (next - front) / front;
}

/** Classify a front-to-next spread. Inside ±deadband is "flat"; deferred richer
 *  (positive) is "contango"; deferred cheaper is "backwardation". `null` spread
 *  (no next contract) → `null`. */
export function classifyTermStructure(
  spreadPct: number | null,
  deadband: number,
): "contango" | "backwardation" | "flat" | null {
  if (spreadPct === null || !Number.isFinite(spreadPct)) return null;
  if (spreadPct > deadband) return "contango";
  if (spreadPct < -deadband) return "backwardation";
  return "flat";
}

/** A priced basket leg, reduced to what `riskTone` needs. */
export interface RiskToneLeg {
  assetClass: FuturesAssetClass;
  changePct: number | null;
}

/** Mean of the finite values, or `null` when none are finite. */
function meanOrNull(values: Array<number | null>): number | null {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

/**
 * Composite cross-asset tone from the equity-index and gold (metal) legs.
 * Equity up with gold flat/down is risk-on; the inverse is risk-off. The score
 * is `equityMove − goldMove` (using whichever legs priced); inside ±deadband is
 * "neutral". `null` when neither equity-index nor metal legs priced.
 */
export function riskTone(
  legs: readonly RiskToneLeg[],
  deadband: number,
): "risk-on" | "neutral" | "risk-off" | null {
  const equityMove = meanOrNull(
    legs.filter((l) => l.assetClass === "equity-index").map((l) => l.changePct),
  );
  const goldMove = meanOrNull(
    legs.filter((l) => l.assetClass === "metal").map((l) => l.changePct),
  );
  if (equityMove === null && goldMove === null) return null;
  const score = (equityMove ?? 0) - (goldMove ?? 0);
  if (score > deadband) return "risk-on";
  if (score < -deadband) return "risk-off";
  return "neutral";
}
