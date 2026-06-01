/**
 * Pure factor-math functions for cross-sectional factor ranking.
 *
 * Computes factor exposures (momentum, value, quality, size, low-vol)
 * for a set of names and returns the target's percentile rank and
 * z-score within the cross-section.
 */

/** 12-1 skip-month momentum: price(t−21d) / price(t−252d) − 1.
 *  Skips the most recent 21 trading days (mean-reversion effect). */
export function momentum12m1(closes: number[]): number | null {
  // Need at least 252 bars. The "12-1" convention: return from bar[0] to bar[length-22].
  // closes[0] is oldest, closes[length-1] is newest.
  if (closes.length < 252) return null;
  const recent = closes[closes.length - 22]; // ~1 month ago
  const yearAgo = closes[0]; // ~12 months ago
  if (yearAgo === 0) return null;
  return recent / yearAgo - 1;
}

/** Earnings yield = net income / market cap. */
export function earningsYield(netIncome: number | null, marketCap: number | null): number | null {
  if (netIncome == null || marketCap == null || marketCap === 0) return null;
  return netIncome / marketCap;
}

/** Book-to-price = book value (equity) / market cap. */
export function bookToPrice(bookValue: number | null, marketCap: number | null): number | null {
  if (bookValue == null || marketCap == null || marketCap === 0) return null;
  return bookValue / marketCap;
}

/** FCF yield = (CFO − CapEx) / market cap. */
export function fcfYield(cfo: number | null, capex: number | null, marketCap: number | null): number | null {
  if (cfo == null || capex == null || marketCap == null || marketCap === 0) return null;
  return (cfo + capex) / marketCap; // capex is already negative from Yahoo
}

/** ROE = net income / equity. */
export function returnOnEquity(netIncome: number | null, equity: number | null): number | null {
  if (netIncome == null || equity == null || equity === 0) return null;
  return netIncome / equity;
}

/** Gross-profits-to-assets = (revenue − COGS) / total assets. Novy-Marx quality proxy. */
export function grossProfitsToAssets(
  revenue: number | null,
  cogs: number | null,
  totalAssets: number | null,
): number | null {
  if (revenue == null || totalAssets == null || totalAssets === 0) return null;
  const grossProfit = cogs != null ? revenue - cogs : revenue;
  return grossProfit / totalAssets;
}

/** Accruals quality = (net income − CFO) / total assets. Lower = higher quality. */
export function accruals(
  netIncome: number | null,
  cfo: number | null,
  totalAssets: number | null,
): number | null {
  if (netIncome == null || cfo == null || totalAssets == null || totalAssets === 0) return null;
  return (netIncome - cfo) / totalAssets;
}

/** Log market cap (size factor — smaller = higher size-factor exposure). */
export function logMarketCap(marketCap: number | null): number | null {
  if (marketCap == null || marketCap <= 0) return null;
  return Math.log(marketCap);
}

/** Cross-sectional percentile rank (0–100) of `value` within `allValues`.
 *  Uses the "percentage of values strictly less than" convention. */
export function crossSectionalPercentile(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter((v) => v < value).length;
  return Math.round((below / (allValues.length - 1)) * 100);
}

/** Cross-sectional z-score of `value` within `allValues`. */
export function crossSectionalZScore(value: number, allValues: number[]): number | null {
  if (allValues.length < 2) return null;
  const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const variance = allValues.reduce((a, v) => a + (v - mean) ** 2, 0) / (allValues.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return (value - mean) / std;
}
