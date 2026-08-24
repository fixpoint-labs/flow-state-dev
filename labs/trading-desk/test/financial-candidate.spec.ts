/**
 * Unit tests for `promoteCandidate` — the recovered-candidate → statement
 * mapping (FIX-898), separate from `validate-financial-candidate.spec.ts`
 * (the gate) since this file only ever runs on a candidate that already
 * cleared validation.
 */
import { describe, expect, it } from "vitest";
import { promoteCandidate, type FinancialCandidate } from "../flows/analysis/lib/financial-candidate";

/** A validated baseline candidate — mirrors
 *  `validate-financial-candidate.spec.ts`'s `baseCandidate`. Every income and
 *  cashflow figure the validator requires is present; both balance figures
 *  are present here too, but the balance section is the one the validator
 *  never requires anything from. */
function baseCandidate(): FinancialCandidate {
  return {
    ticker: "SPCX",
    cik: 1750000,
    companyName: "SpaceCo Exploration Inc.",
    form: "424B4",
    filingDate: "2026-02-10",
    periodEnd: "2025-12-31",
    scale: 1_000,
    currency: "USD",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm",
    income: { revenue: 8_500_000_000, operatingIncome: 1_200_000_000 },
    cashflow: { operating: 2_000_000_000, capitalExpenditure: -3_500_000_000, freeCashFlow: null },
    balance: { cashAndEquivalents: 4_000_000_000, totalDebt: 1_000_000_000 },
  };
}

describe("promoteCandidate — periodEnd only stamps a statement that actually carries figures (Codex review, FIX-1113)", () => {
  it("THE BUG: a candidate whose balance section extracted nothing leaves balanceSheet.periodEnd null", () => {
    // Candidate validation requires revenue, operatingIncome, and FCF — NOT
    // any balance figure (`validate-financial-candidate.ts`'s completeness
    // gate). A validated candidate can therefore carry a fully empty balance
    // section: both fields the extractor could have populated are absent.
    const c: FinancialCandidate = {
      ...baseCandidate(),
      balance: { cashAndEquivalents: null, totalDebt: null },
    };
    const { incomeStatement, balanceSheet, cashflow } = promoteCandidate(c);
    // The period is still read as one value for the response (unchanged) —
    // income and cashflow, which the validator DID require figures for,
    // still carry it.
    expect(incomeStatement.periodEnd).toBe(c.periodEnd);
    expect(cashflow.periodEnd).toBe(c.periodEnd);
    // The balance sheet has nothing — the label must not attach to it.
    expect(balanceSheet.periodEnd).toBeNull();
    expect(balanceSheet.totalAssets).toBeNull();
    expect(balanceSheet.cashAndEquivalents).toBeNull();
    expect(balanceSheet.totalDebt).toBeNull();
  });

  it("control: a candidate with a fully populated balance section still stamps all three statements", () => {
    const { incomeStatement, balanceSheet, cashflow } = promoteCandidate(baseCandidate());
    expect(incomeStatement.periodEnd).not.toBeNull();
    expect(balanceSheet.periodEnd).not.toBeNull();
    expect(cashflow.periodEnd).not.toBeNull();
  });

  it("control: a balance section with only cashAndEquivalents populated still stamps (one figure is enough)", () => {
    const c: FinancialCandidate = {
      ...baseCandidate(),
      balance: { cashAndEquivalents: 500_000_000, totalDebt: null },
    };
    const { balanceSheet } = promoteCandidate(c);
    expect(balanceSheet.periodEnd).toBe(c.periodEnd);
    expect(balanceSheet.cashAndEquivalents).toBeCloseTo(0.5, 3);
  });

  it("control: an explicit zero in the balance section still counts as a figure, not absence", () => {
    const c: FinancialCandidate = {
      ...baseCandidate(),
      balance: { cashAndEquivalents: 0, totalDebt: null },
    };
    const { balanceSheet } = promoteCandidate(c);
    expect(balanceSheet.periodEnd).toBe(c.periodEnd);
    expect(balanceSheet.cashAndEquivalents).toBe(0);
  });

  it("asOf is untouched by any of this — it keeps its own filingDate fallback regardless of periodEnd", () => {
    const c: FinancialCandidate = {
      ...baseCandidate(),
      periodEnd: "",
      balance: { cashAndEquivalents: null, totalDebt: null },
    };
    const { incomeStatement, balanceSheet, cashflow } = promoteCandidate(c);
    expect(incomeStatement.asOf).toBe(c.filingDate);
    expect(balanceSheet.asOf).toBe(c.filingDate);
    expect(cashflow.asOf).toBe(c.filingDate);
    expect(balanceSheet.periodEnd).toBeNull();
  });
});
