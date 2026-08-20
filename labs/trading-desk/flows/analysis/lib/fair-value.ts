/**
 * Fair-value computation via justified P/E multiple (Gordon growth model).
 *
 * justified_PE = payout × (1 + g) / (r − g), where r = the REQUIRED return
 * (the desk hurdle — never the expected return, which is the IRR implied by
 * the current price and would make fair value circular) and g = sustainable
 * growth. Payout is the SUSTAINABLE payout implied by the stable-growth
 * identity g = retention × ROE, i.e. payout = 1 − g/ROE — not the actual
 * dividend payout, which collapses the multiple for low-payout compounders
 * (FIX-778). fair_value = justified_PE × trailing earnings, a company-level
 * figure in marketCap units ($B) — NOT a per-share price. Margin of safety
 * = 1 − marketCap / fair_value.
 *
 * Nullable honesty: the method reports n/a (all nulls, available: false)
 * whenever its assumptions don't hold — r − g spread under 200bps (Gordon
 * blows up near r = g; high-growth names are outside the single-stage
 * domain), ROE ≤ g (growth not fundable from retention), or non-positive
 * earnings — rather than emitting an absurd figure. An UNOBSERVED ROE or
 * market cap is treated the same way (FIX-1063): with no market cap the
 * justified multiple and fair value still stand, but the margin of safety —
 * the discount to what the market is actually paying — reports null rather
 * than measuring against a fabricated zero.
 *
 * Financials (banks, insurance) switch to equity-multiples only — EV-based
 * metrics are meaningless for balance-sheet-intensive businesses.
 */
import type { z } from "zod";
import type {
  fundamentalsSchema,
  incomeStatementSchema,
} from "../tools/schemas";
import type { ExpectedReturn } from "./expected-return";

type Fundamentals = z.infer<typeof fundamentalsSchema>;
type IncomeStatement = z.infer<typeof incomeStatementSchema>;

export type ValuationMethod = "justified-pe" | "equity-multiples" | "none";

// Minimum r − g spread (200bps): below this the Gordon denominator makes the
// multiple hypersensitive to inputs, and at/below zero it is undefined. With
// the 9% hurdle this also scopes the method to names growing ≤ ~7% — the
// single-stage model's textbook domain — and bounds justified PE at ~53×.
const MIN_GORDON_SPREAD = 0.02;

const FINANCIAL_SECTORS = new Set([
  "financial services",
  "financials",
  "banks",
  "insurance",
  "financial",
]);

export interface FairValue {
  justifiedPE: number | null;
  /** Fair MARKET CAP in $B (marketCap units) — never a per-share price. */
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

  // Discount at the required return. Using er.expectedReturn here would be
  // circular: it is the return implied by the current price.
  const r = er.hurdle;
  const g = er.sustainableGrowth!;

  // Gordon needs r meaningfully above g; high-growth names are outside the
  // single-stage domain and get an honest n/a instead of a collapsed figure.
  if (r - g < MIN_GORDON_SPREAD) {
    return { justifiedPE: null, fairValue: null, marginOfSafety: null, method: "none", available: false };
  }

  const netIncome = is_.netIncome;
  if (netIncome == null || netIncome <= 0) {
    return { justifiedPE: null, fairValue: null, marginOfSafety: null, method, available: false };
  }

  // Sustainable payout from the stable-growth identity g = retention × ROE.
  // ROE ≤ g means retention alone cannot fund the assumed growth — the model
  // is internally inconsistent for this name.
  // An unobserved ROE is not a failing ROE — but the model cannot run without
  // one either way, so it abstains (FIX-1063).
  const roe = f.returnOnEquity;
  if (roe == null || roe <= 0 || roe <= g) {
    return { justifiedPE: null, fairValue: null, marginOfSafety: null, method: "none", available: false };
  }
  const sustainablePayout = 1 - g / roe;

  const justifiedPE = sustainablePayout * (1 + g) / (r - g);

  // Company-level trailing earnings in $B: marketCap / trailingPE keeps the
  // earnings basis consistent with the quoted multiple; netIncome is the
  // fallback. Either way the product below is a fair market cap, not a price.
  const marketCap = f.marketCap;
  let trailingEarnings: number | null = null;
  if (marketCap != null && f.trailingPE != null && f.trailingPE > 0) {
    trailingEarnings = marketCap / f.trailingPE;
  } else if (netIncome > 0) {
    trailingEarnings = netIncome;
  }

  if (trailingEarnings == null || trailingEarnings <= 0) {
    return { justifiedPE, fairValue: null, marginOfSafety: null, method, available: false };
  }

  const fairValue = justifiedPE * trailingEarnings;
  // Margin of safety compares the fair value to what the market is ACTUALLY
  // paying. With no market cap there is no such comparison — the justified
  // multiple still stands, the discount to it does not.
  const marginOfSafety = marketCap == null ? null : 1 - marketCap / fairValue;

  return {
    justifiedPE,
    fairValue,
    marginOfSafety,
    method,
    available: true,
  };
}
