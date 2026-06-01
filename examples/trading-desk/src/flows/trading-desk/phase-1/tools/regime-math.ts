/**
 * Pure risk-regime math functions.
 *
 * Computes realized volatility, vol-regime percentile, OLS beta + R²,
 * and rolling correlation from daily price history.
 */

/** Daily log returns from an array of closing prices. */
export function logReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  return returns;
}

/** Annualized realized volatility from daily log returns. */
export function realizedVolAnnualized(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 2) return null;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/** Realized vol computed over a short window (e.g. 21 or 63 days). */
export function shortWindowVol(dailyReturns: number[], window: number): number | null {
  if (dailyReturns.length < window) return null;
  const recent = dailyReturns.slice(-window);
  return realizedVolAnnualized(recent);
}

/** Vol-regime percentile: where the current short-window vol sits
 *  within a rolling distribution of short-window vols over the full series. */
export function volRegimePercentile(
  dailyReturns: number[],
  shortWindow: number,
): { percentile: number; regime: "calm" | "normal" | "elevated" | "stressed" } | null {
  if (dailyReturns.length < shortWindow + 1) return null;
  const currentVol = shortWindowVol(dailyReturns, shortWindow);
  if (currentVol == null) return null;

  // Compute rolling short-window vols
  const rollingVols: number[] = [];
  for (let end = shortWindow; end <= dailyReturns.length; end++) {
    const windowReturns = dailyReturns.slice(end - shortWindow, end);
    const vol = realizedVolAnnualized(windowReturns);
    if (vol != null) rollingVols.push(vol);
  }

  if (rollingVols.length < 2) return null;

  const below = rollingVols.filter((v) => v < currentVol).length;
  const percentile = Math.round((below / (rollingVols.length - 1)) * 100);

  let regime: "calm" | "normal" | "elevated" | "stressed";
  if (percentile < 33) regime = "calm";
  else if (percentile < 66) regime = "normal";
  else if (percentile < 90) regime = "elevated";
  else regime = "stressed";

  return { percentile, regime };
}

/** OLS regression: y = alpha + beta * x. Returns beta and R². */
export function olsBeta(
  yReturns: number[],
  xReturns: number[],
): { beta: number; rSquared: number } | null {
  const n = Math.min(yReturns.length, xReturns.length);
  if (n < 10) return null;

  const y = yReturns.slice(-n);
  const x = xReturns.slice(-n);

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let covXY = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return null;

  const beta = covXY / varX;
  const rSquared = (covXY * covXY) / (varX * varY);

  return { beta, rSquared };
}

/** Rolling correlation between two return series over a given window. */
export function rollingCorrelation(
  aReturns: number[],
  bReturns: number[],
  window: number,
): number | null {
  const n = Math.min(aReturns.length, bReturns.length);
  if (n < window) return null;

  const a = aReturns.slice(-window);
  const b = bReturns.slice(-window);

  const meanA = a.reduce((s, v) => s + v, 0) / window;
  const meanB = b.reduce((s, v) => s + v, 0) / window;

  let covAB = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < window; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covAB += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA === 0 || varB === 0) return null;
  return covAB / Math.sqrt(varA * varB);
}

/** Classify correlation regime: compare recent rolling correlation to the
 *  full-period average. */
export function correlationRegime(
  aReturns: number[],
  bReturns: number[],
  shortWindow: number,
): "rising" | "stable" | "falling" | null {
  const recentCorr = rollingCorrelation(aReturns, bReturns, shortWindow);
  const n = Math.min(aReturns.length, bReturns.length);
  const fullCorr = rollingCorrelation(aReturns, bReturns, n);
  if (recentCorr == null || fullCorr == null) return null;
  const diff = recentCorr - fullCorr;
  if (diff > 0.1) return "rising";
  if (diff < -0.1) return "falling";
  return "stable";
}
