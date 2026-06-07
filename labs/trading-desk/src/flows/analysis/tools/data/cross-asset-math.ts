/**
 * Pure cross-asset-flow math.
 *
 * The `get_cross_asset_flow` tool fetches trailing returns for a basket of
 * risk-on / risk-off ETF pairs and one financial-conditions series. These
 * functions turn those raw numbers into a directional reading — they hold the
 * only judgment in the tool (where the risk-on/off line and the flat band sit),
 * which is why they live in their own pure, unit-tested module rather than
 * inline in the handler. No IO, no fetch — closes over nothing.
 *
 * A `deadband` keeps a near-zero move from masquerading as a directional
 * signal: a 0.1% spread is noise, not "risk-on". Callers pass the band in the
 * units of the value being judged (return-fraction for spreads, index-points
 * for the conditions trend).
 */

/** Directional read for one risk-on minus risk-off return spread. `null` in →
 *  `null` out (the pair could not be priced); inside ±deadband → "neutral". */
export function classifyLeaning(
  spread: number | null,
  deadband: number,
): "risk-on" | "neutral" | "risk-off" | null {
  if (spread === null) return null;
  if (spread > deadband) return "risk-on";
  if (spread < -deadband) return "risk-off";
  return "neutral";
}

/** Composite risk appetite across the basket: the mean of the spreads that
 *  resolved, classified with the same deadband. `null` when no pair priced — an
 *  empty mean is not 0, it is "unknown". */
export function riskAppetite(
  spreads: Array<number | null>,
  deadband: number,
): { score: number; appetite: "risk-on" | "neutral" | "risk-off" } | null {
  const resolved = spreads.filter((s): s is number => s !== null);
  if (resolved.length === 0) return null;
  const score = resolved.reduce((a, b) => a + b, 0) / resolved.length;
  // classifyLeaning never returns null for a non-null input, so the cast is safe.
  const appetite = classifyLeaning(score, deadband) as
    | "risk-on"
    | "neutral"
    | "risk-off";
  return { score, appetite };
}

/** Three-way trend of a single series between a prior and a latest reading.
 *  `null` when either endpoint is missing; inside ±deadband → "flat". The
 *  caller maps "rising"/"falling" onto its domain labels (e.g. for NFCI a rise
 *  is tightening, a fall is easing). */
export function trend3(
  latest: number | null,
  prior: number | null,
  deadband: number,
): "rising" | "flat" | "falling" | null {
  if (latest === null || prior === null) return null;
  const change = latest - prior;
  if (change > deadband) return "rising";
  if (change < -deadband) return "falling";
  return "flat";
}
