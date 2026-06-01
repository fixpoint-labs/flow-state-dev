/**
 * Shared multi-period statement shape for the composite scores
 * (`get_quant_composites`).
 *
 * Altman Z'' and the Piotroski F-Score need a richer, multi-period view than
 * the single-period statement tools expose: working capital (current assets −
 * current liabilities), retained earnings, and a prior period for the
 * change-based Piotroski criteria. Both the EDGAR companyfacts mapper
 * (`edgar-companyfacts.ts`) and the Yahoo `fundamentals-timeseries` mapper
 * (`yahoo-timeseries.ts`) produce arrays of this shape, newest period first.
 * A line item a provider doesn't report reads `null` (honest unobserved),
 * never 0.
 */

/** One annual statement period, monetary values in USD billions. */
export type FinancialPeriod = {
  /** Fiscal-period end date (`YYYY-MM-DD`); empty string when unknown. */
  endDate: string;
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
};
