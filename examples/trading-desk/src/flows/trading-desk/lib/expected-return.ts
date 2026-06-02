/**
 * Expected-return computation from already-fetched fundamentals.
 *
 * E[r] ≈ shareholder_yield + sustainable_growth (Gordon rearranged).
 * Shareholder yield = FCF/marketCap (preferred — FCF encompasses
 * distribution capacity) or earnings/marketCap + dividend yield (fallback). Sustainable growth = min(revenueGrowth,
 * retention × ROE), capped at [terminal, GROWTH_CAP].
 */
import type { z } from "zod";
import type {
  balanceSheetSchema,
  cashflowSchema,
  fundamentalsSchema,
  incomeStatementSchema,
} from "../phase-1/tools/schemas";

type Fundamentals = z.infer<typeof fundamentalsSchema>;
type BalanceSheet = z.infer<typeof balanceSheetSchema>;
type IncomeStatement = z.infer<typeof incomeStatementSchema>;
type Cashflow = z.infer<typeof cashflowSchema>;

export const HURDLE_RATE = 0.09;
const TERMINAL_GROWTH = 0.02;
const GROWTH_CAP = 0.25;

export type ReturnBasis = "fcf" | "earnings" | "none";

export interface ExpectedReturn {
  shareholderYield: number | null;
  sustainableGrowth: number | null;
  expectedReturn: number | null;
  hurdle: number;
  excessReturn: number | null;
  basis: ReturnBasis;
  lowConfidence: boolean;
}

export function computeExpectedReturn(args: {
  fundamentals: Fundamentals;
  incomeStatement: IncomeStatement;
  cashflow: Cashflow;
  balanceSheet: BalanceSheet;
}): ExpectedReturn {
  const { fundamentals: f, incomeStatement: is_, cashflow: cf } = args;

  const marketCap = f.marketCap;
  const divYield = f.dividendYield ?? 0;

  // Shareholder yield: prefer FCF, fall back to earnings
  let basis: ReturnBasis = "none";
  let shareholderYield: number | null = null;

  const fcf = cf.freeCashFlow;
  const netIncome = is_.netIncome;

  if (fcf != null && fcf > 0 && marketCap > 0) {
    shareholderYield = fcf / marketCap;
    basis = "fcf";
  } else if (netIncome != null && netIncome > 0 && marketCap > 0) {
    shareholderYield = netIncome / marketCap + divYield;
    basis = "earnings";
  }

  // Sustainable growth: min(revenueGrowth, retention × ROE), capped
  let sustainableGrowth: number | null = null;
  const roe = f.returnOnEquity;
  const revenueGrowth = is_.yoyRevenueGrowth;

  if (revenueGrowth != null) {
    const retentionROE =
      roe > 0 && netIncome != null && netIncome > 0
        ? (1 - divYield * marketCap / netIncome) * roe
        : null;

    const growthEstimate = retentionROE != null
      ? Math.min(revenueGrowth, retentionROE)
      : revenueGrowth;

    sustainableGrowth = Math.max(TERMINAL_GROWTH, Math.min(growthEstimate, GROWTH_CAP));
  }

  // Expected return
  let expectedReturn: number | null = null;
  if (shareholderYield != null && sustainableGrowth != null) {
    expectedReturn = shareholderYield + sustainableGrowth;
  }

  const lowConfidence =
    (fcf == null || fcf <= 0) && (netIncome == null || netIncome <= 0);

  return {
    shareholderYield,
    sustainableGrowth,
    expectedReturn,
    hurdle: HURDLE_RATE,
    excessReturn: expectedReturn != null ? expectedReturn - HURDLE_RATE : null,
    basis,
    lowConfidence,
  };
}
