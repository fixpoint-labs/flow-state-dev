/**
 * Pure composite-score math: Altman Z'' and Piotroski F-Score.
 *
 * Both composites take a normalized statement shape and return the score
 * plus metadata about which criteria were computable.
 */

export type StatementPeriod = {
  totalAssets: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  totalLiabilities: number | null;
  retainedEarnings: number | null;
  totalEquity: number | null;
  totalRevenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  cfo: number | null;
  capitalExpenditures: number | null;
  sharesOutstanding: number | null;
};

/** Altman Z'' (non-manufacturer variant):
 *  Z'' = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4
 *  where:
 *    X1 = (current assets − current liabilities) / total assets
 *    X2 = retained earnings / total assets
 *    X3 = EBIT (operating income) / total assets
 *    X4 = book equity / total liabilities
 */
export function altmanZDoublePrime(
  period: StatementPeriod,
): { score: number; zone: "safe" | "grey" | "distress"; missingInputs: string[] } | null {
  const missing: string[] = [];
  const ta = period.totalAssets;
  const tl = period.totalLiabilities;
  if (ta == null || ta === 0) return null; // denominator for X1–X3
  if (tl == null || tl === 0) return null; // denominator for X4

  let x1: number | null = null;
  if (period.totalCurrentAssets != null && period.totalCurrentLiabilities != null) {
    x1 = (period.totalCurrentAssets - period.totalCurrentLiabilities) / ta;
  } else {
    missing.push("currentAssets or currentLiabilities");
  }

  let x2: number | null = null;
  if (period.retainedEarnings != null) {
    x2 = period.retainedEarnings / ta;
  } else {
    missing.push("retainedEarnings");
  }

  let x3: number | null = null;
  if (period.operatingIncome != null) {
    x3 = period.operatingIncome / ta;
  } else {
    missing.push("operatingIncome");
  }

  let x4: number | null = null;
  const equity = period.totalEquity;
  if (equity != null) {
    x4 = equity / tl;
  } else {
    missing.push("totalEquity");
  }

  // Need at least X3 and X4 for a meaningful partial
  if (x3 == null && x4 == null) return null;

  const score =
    6.56 * (x1 ?? 0) +
    3.26 * (x2 ?? 0) +
    6.72 * (x3 ?? 0) +
    1.05 * (x4 ?? 0);

  let zone: "safe" | "grey" | "distress";
  if (score > 2.6) zone = "safe";
  else if (score >= 1.1) zone = "grey";
  else zone = "distress";

  return { score: Math.round(score * 100) / 100, zone, missingInputs: missing };
}

export type PiotroskiCriterion = {
  criterion: string;
  passed: boolean | null;
};

/** Piotroski F-Score: 9 binary criteria comparing current and prior period.
 *  Returns the total score (count of true), the breakdown, and how many
 *  criteria were computable. */
export function piotroskiFScore(
  current: StatementPeriod,
  prior: StatementPeriod | null,
): { score: number; computable: number; breakdown: PiotroskiCriterion[] } {
  const results: PiotroskiCriterion[] = [];

  const ta = current.totalAssets;
  const priorTa = prior?.totalAssets;

  // 1. ROA > 0
  const roa = ta && ta !== 0 && current.netIncome != null ? current.netIncome / ta : null;
  results.push({ criterion: "ROA > 0", passed: roa != null ? roa > 0 : null });

  // 2. CFO > 0
  results.push({ criterion: "CFO > 0", passed: current.cfo != null ? current.cfo > 0 : null });

  // 3. ΔROA > 0 (current ROA > prior ROA)
  const priorRoa = priorTa && priorTa !== 0 && prior?.netIncome != null ? prior.netIncome / priorTa : null;
  results.push({
    criterion: "ΔROA > 0",
    passed: roa != null && priorRoa != null ? roa > priorRoa : null,
  });

  // 4. CFO/Assets > ROA (accruals quality)
  const cfoToAssets = ta && ta !== 0 && current.cfo != null ? current.cfo / ta : null;
  results.push({
    criterion: "CFO/Assets > ROA",
    passed: cfoToAssets != null && roa != null ? cfoToAssets > roa : null,
  });

  // 5. ΔLeverage < 0 (long-term debt / assets decreased)
  const leverage = ta && ta !== 0 && current.totalLiabilities != null ? current.totalLiabilities / ta : null;
  const priorLeverage = priorTa && priorTa !== 0 && prior?.totalLiabilities != null ? prior.totalLiabilities / priorTa : null;
  results.push({
    criterion: "ΔLeverage < 0",
    passed: leverage != null && priorLeverage != null ? leverage < priorLeverage : null,
  });

  // 6. ΔCurrentRatio > 0
  const currentRatio = current.totalCurrentAssets != null && current.totalCurrentLiabilities != null && current.totalCurrentLiabilities !== 0
    ? current.totalCurrentAssets / current.totalCurrentLiabilities
    : null;
  const priorCurrentRatio = prior?.totalCurrentAssets != null && prior?.totalCurrentLiabilities != null && prior.totalCurrentLiabilities !== 0
    ? prior.totalCurrentAssets / prior.totalCurrentLiabilities
    : null;
  results.push({
    criterion: "ΔCurrentRatio > 0",
    passed: currentRatio != null && priorCurrentRatio != null ? currentRatio > priorCurrentRatio : null,
  });

  // 7. No new shares issued (shares outstanding didn't increase)
  // Yahoo doesn't provide historical shares — typically null
  results.push({
    criterion: "No new shares",
    passed: current.sharesOutstanding != null && prior?.sharesOutstanding != null
      ? current.sharesOutstanding <= prior.sharesOutstanding
      : null,
  });

  // 8. ΔGrossMargin > 0
  const gm = current.totalRevenue && current.totalRevenue !== 0
    ? (current.grossProfit ?? (current.costOfRevenue != null ? current.totalRevenue - current.costOfRevenue : null))
    : null;
  const gmRatio = gm != null && current.totalRevenue && current.totalRevenue !== 0 ? gm / current.totalRevenue : null;
  const priorGm = prior?.totalRevenue && prior.totalRevenue !== 0
    ? (prior.grossProfit ?? (prior.costOfRevenue != null ? prior.totalRevenue - prior.costOfRevenue : null))
    : null;
  const priorGmRatio = priorGm != null && prior?.totalRevenue && prior.totalRevenue !== 0 ? priorGm / prior.totalRevenue : null;
  results.push({
    criterion: "ΔGrossMargin > 0",
    passed: gmRatio != null && priorGmRatio != null ? gmRatio > priorGmRatio : null,
  });

  // 9. ΔAssetTurnover > 0
  const turnover = ta && ta !== 0 && current.totalRevenue != null ? current.totalRevenue / ta : null;
  const priorTurnover = priorTa && priorTa !== 0 && prior?.totalRevenue != null ? prior.totalRevenue / priorTa : null;
  results.push({
    criterion: "ΔAssetTurnover > 0",
    passed: turnover != null && priorTurnover != null ? turnover > priorTurnover : null,
  });

  const computable = results.filter((r) => r.passed != null).length;
  const score = results.filter((r) => r.passed === true).length;

  return { score, computable, breakdown: results };
}
