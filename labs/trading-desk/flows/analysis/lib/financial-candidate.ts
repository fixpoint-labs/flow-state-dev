/**
 * The typed shape a critical-financials recovery produces before validation
 * (FIX-898), plus the promote mapping into the statement schemas.
 *
 * Both the deterministic prospectus extractor and the bounded LLM extractor
 * emit a `FinancialCandidate`: line items in RAW USD (after the `scale`
 * multiplier is applied), with a source URL and per-field provenance. The
 * validator (`validate-financial-candidate.ts`) is the only thing allowed to
 * turn a candidate into a spine write; the promote helpers here normalize to
 * USD billions so the recovered payload is byte-comparable with the
 * companyfacts / Yahoo mappers and the DCF consumer.
 */
import type {
  balanceSheetSchema,
  cashflowSchema,
  incomeStatementSchema,
} from "../tools/schemas";
import type { z } from "zod";

type IncomeStatement = z.infer<typeof incomeStatementSchema>;
type BalanceSheet = z.infer<typeof balanceSheetSchema>;
type Cashflow = z.infer<typeof cashflowSchema>;

/** Multiplier applied to table integers to reach raw USD. Parsed from the
 *  table header ("in thousands"/"in millions") — never inferred from the
 *  magnitude of a number (that is the scale-ambiguity reject case). */
export type CandidateScale = 1 | 1_000 | 1_000_000 | 1_000_000_000;

export type FinancialCandidate = {
  ticker: string;
  cik: number;
  companyName: string;
  form: string;
  filingDate: string;
  /** Fiscal period end the statements cover (from the filing context). */
  periodEnd: string;
  scale: CandidateScale;
  /** v1: USD only; a non-USD candidate is rejected. */
  currency: string;
  sourceUrl: string;
  /** Line items in RAW USD (scale already applied). */
  income: {
    revenue: number | null;
    operatingIncome: number | null;
  };
  cashflow: {
    /** Maps to `cashflowSchema.operating` on promote. */
    operating: number | null;
    /** Extract-only: derives `freeCashFlow` when FCF is not stated. Reported as
     *  a positive outflow (the EDGAR/companyfacts convention). Not a spine
     *  field. */
    capitalExpenditure: number | null;
    freeCashFlow: number | null;
  };
  balance: {
    cashAndEquivalents: number | null;
    totalDebt: number | null;
  };
  fieldProvenance: Record<string, { sourceUrl: string; excerpt?: string }>;
};

const USD_BILLION = 1_000_000_000;

/** Raw USD → USD billions, preserving null. */
function toBillions(raw: number | null): number | null {
  return raw == null ? null : raw / USD_BILLION;
}

/** Free cash flow in raw USD: the stated value, else operating − |capex|. */
export function candidateFreeCashFlowRaw(c: FinancialCandidate): number | null {
  if (c.cashflow.freeCashFlow != null) return c.cashflow.freeCashFlow;
  if (c.cashflow.operating != null && c.cashflow.capitalExpenditure != null) {
    return c.cashflow.operating - Math.abs(c.cashflow.capitalExpenditure);
  }
  return null;
}

/**
 * Map a VALIDATED candidate into the three statement payloads, in USD billions
 * and tagged `source: "edgar-prospectus"`. Only run after
 * `validateFinancialCandidate` passes — this does no gating, only normalization.
 * Fields the prospectus did not disclose stay `null` (never zero-filled).
 */
export function promoteCandidate(c: FinancialCandidate): {
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashflow: Cashflow;
} {
  const asOf = c.periodEnd || c.filingDate;
  return {
    incomeStatement: {
      source: "edgar-prospectus",
      ticker: c.ticker,
      asOf,
      revenue: toBillions(c.income.revenue),
      grossProfit: null,
      operatingIncome: toBillions(c.income.operatingIncome),
      netIncome: null,
      yoyRevenueGrowth: null,
      unit: "USD billions",
    },
    balanceSheet: {
      source: "edgar-prospectus",
      ticker: c.ticker,
      asOf,
      totalAssets: null,
      totalLiabilities: null,
      totalEquity: null,
      cashAndEquivalents: toBillions(c.balance.cashAndEquivalents),
      totalDebt: toBillions(c.balance.totalDebt),
      unit: "USD billions",
    },
    cashflow: {
      source: "edgar-prospectus",
      ticker: c.ticker,
      asOf,
      operating: toBillions(c.cashflow.operating),
      investing: null,
      financing: null,
      freeCashFlow: toBillions(candidateFreeCashFlowRaw(c)),
      unit: "USD billions",
    },
  };
}
