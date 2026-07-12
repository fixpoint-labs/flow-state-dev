/**
 * Local statistics for the eval suite (FIX-790): mean/std, the standard error of
 * a difference of means, and ordinal Krippendorff's alpha.
 *
 * Implemented locally (the benchmark's equivalents are package-internal, and
 * promoting them is out of scope, spec §Non-Goals). Pure, IO-free.
 */

/** Sample mean and standard deviation (n−1 denominator; std is 0 for n ≤ 1). */
export function meanStd(xs: number[]): { mean: number; std: number } {
  if (xs.length === 0) return { mean: 0, std: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (xs.length === 1) return { mean, std: 0 };
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

/** Standard error of the mean (std / √n) — the per-dimension noise band the
 *  variance mode reports as `2·SE`. */
export function standardError(xs: number[]): number {
  if (xs.length < 2) return 0;
  return meanStd(xs).std / Math.sqrt(xs.length);
}

/**
 * Krippendorff's alpha over a reliability matrix — items (rows) × raters
 * (columns), here sessions × judge repeats. Uses the INTERVAL difference metric
 * δ²(a,b) = (a−b)², the natural choice for the continuous 0–1 judge scores this
 * suite records (an ordinal metric would first have to bin them).
 *
 * Returns `null` when fewer than two items carry ≥2 ratings — with a single
 * usable item the expected-disagreement denominator is degenerate and alpha is
 * meaningless (spec §4.7). Returns 1 when every value is identical (no observed
 * disagreement — a valid perfect-reliability outcome).
 */
export function krippendorffAlpha(items: number[][]): number | null {
  // Usable units: an item needs ≥2 ratings to contribute a within-unit pair.
  const units = items.filter((u) => u.length >= 2);
  if (units.length < 2) return null;

  const allValues = units.flat();
  const N = allValues.length;
  if (N < 2) return null;

  const delta2 = (a: number, b: number): number => (a - b) ** 2;

  // Observed disagreement: within-unit ordered pairs, each unit weighted by
  // 1/(n_u − 1).
  let observed = 0;
  for (const unit of units) {
    const nu = unit.length;
    let unitSum = 0;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nu; j++) {
        if (i !== j) unitSum += delta2(unit[i], unit[j]);
      }
    }
    observed += unitSum / (nu - 1);
  }
  const Do = observed / N;

  // Expected disagreement: ordered pairs over ALL values.
  let expected = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i !== j) expected += delta2(allValues[i], allValues[j]);
    }
  }
  const De = expected / (N * (N - 1));

  if (De === 0) return 1; // no variance anywhere → perfect agreement
  return 1 - Do / De;
}
