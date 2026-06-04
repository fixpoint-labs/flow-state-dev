/**
 * Fair-value computation via justified P/E multiple (Gordon growth model).
 *
 * justified_PE = payout × (1 + g) / (r − g), where r = expected return
 * and g = sustainable growth. fair_value = justified_PE × EPS. Margin of
 * safety = 1 − price / fair_value. Null when r ≤ g (Gordon undefined),
 * earnings are non-positive, or inputs are insufficient.
 *
 * Financials (banks, insurance) switch to equity-multiples only — EV-based
 * metrics are meaningless for balance-sheet-intensive businesses.
 */
import type { z } from "zod";
import type {
  fundamentalsSchema,
  incomeStatementSchema,
} from "../phase-1/tools/schemas";
import type { ExpectedReturn } from "./expected-return";

type Fundamentals = z.infer<typeof fundamentalsSchema>;
type IncomeStatement = z.infer<typeof incomeStatementSchema>;

export type ValuationMethod = "justified-pe" | "equity-multiples" | "none";

const FINANCIAL_SECTORS = new Set([
  "financial services",
  "financials",
  "banks",
  "insurance",
  "financial",
]);

export interface FairValue {
  justifiedPE: number | null;
  fairValue: number | null;
  marginOfSafety: number | null;
  method: ValuationMethod;
  available: boolean;
}

export function isFinancialSector(sector: string | null): boolean {
  if (!sector) return false;
  return FINANCIAL_SECTORS.has(sector.toLowerCase());
}

export function computeFairValue(args: {
  fundamentals: Fundamentals;
  incomeStatement: IncomeStatement;
  expectedReturn: ExpectedReturn;
  sector: string | null;
}): FairValue {
  const { fundamentals: f, incomeStatement: is_, expectedReturn: er, sector } = args;

  const method: ValuationMethod = isFinancialSector(sector)
    ? "equity-multiples"
    : er.expectedReturn != null && er.sustainableGrowth != null
      ? "justified-pe"
      : "none";

  if (method === "equity-multiples" || method === "none") {
    return { justifiedPE: null, fairValue: null, marginOfSafety: null, method, available: false };
  }

  const r = er.expectedReturn!;
  const g = er.sustainableGrowth!;

  // Gordon undefined when r ≤ g
  if (r <= g) {
    return { justifiedPE: null, fairValue: null, marginOfSafety: null, method: "none", available: false };
  }

  const netIncome = is_.netIncome;
  if (netIncome == null || netIncome <= 0) {
    return { justifiedPE: null, fairValue: null, marginOfSafety: null, method, available: false };
  }

  const divYield = f.dividendYield ?? 0;
  const payout = divYield > 0 && f.marketCap > 0
    ? Math.min(divYield * f.marketCap / netIncome, 1)
    : 0.3; // default payout assumption when no dividend data

  const justifiedPE = payout * (1 + g) / (r - g);

  // EPS approximation: netIncome / (marketCap / price). Since we don't have
  // shares outstanding directly, use trailingPE to back out EPS if available.
  let eps: number | null = null;
  if (f.trailingPE != null && f.trailingPE > 0) {
    // price / trailingPE = EPS (approx, in $B units matching marketCap)
    // Actually: trailingPE = price/EPS, so EPS = marketCap/trailingPE (in $B)
    eps = f.marketCap / f.trailingPE;
  } else if (netIncome > 0) {
    eps = netIncome; // use total net income; fair value will be in $B units
  }

  if (eps == null || eps <= 0) {
    return { justifiedPE, fairValue: null, marginOfSafety: null, method, available: false };
  }

  const fairValue = justifiedPE * eps;
  const marginOfSafety = 1 - f.marketCap / fairValue;

  return {
    justifiedPE,
    fairValue,
    marginOfSafety,
    method,
    available: true,
  };
}
