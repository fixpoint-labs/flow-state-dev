/**
 * Unit tests for the hard critical-financials validator (FIX-898) — the
 * real-money gate every recovered candidate must clear before it can touch the
 * valuation spine.
 *
 * Relocated from `prospectus-financials.spec.ts` when the deterministic parser
 * was removed (FIX-913): the validator is unchanged and tier-agnostic, so its
 * gate matrix must survive the parser's deletion. Intent encoded: wrong company,
 * non-SEC source, non-USD, stale period, an insufficient set, and an unreconciled
 * FCF triple are all rejected — no zero-fill, no magnitude guessing.
 */
import { describe, expect, it } from "vitest";
import { type FinancialCandidate } from "../flows/analysis/lib/financial-candidate";
import { validateFinancialCandidate } from "../flows/analysis/lib/validate-financial-candidate";

const validateCtx = {
  ticker: "SPCX",
  expectedCik: 1750000,
  asOfDate: "2026-05-06",
  expectedName: "SpaceCo Exploration Inc.",
};

/** A valid baseline candidate the reject cases each mutate one field of. */
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

describe("validateFinancialCandidate — hard reject gates", () => {
  it("accepts the baseline candidate", () => {
    expect(validateFinancialCandidate(baseCandidate(), validateCtx).ok).toBe(true);
  });

  it("accepts an exact short-token company name (empty 4-char token set)", () => {
    // "XP Inc." → no 4+-char tokens, but the candidate name is copied from the
    // same submissions record as expectedName, so an exact match must agree.
    const r = validateFinancialCandidate(
      { ...baseCandidate(), companyName: "XP Inc." },
      { ...validateCtx, expectedName: "XP Inc." },
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a wrong-company CIK", () => {
    const r = validateFinancialCandidate({ ...baseCandidate(), cik: 999 }, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/wrong-company/);
  });

  it("rejects a non-SEC (open-web) source URL", () => {
    const r = validateFinancialCandidate(
      { ...baseCandidate(), sourceUrl: "https://spaceco.example.com/ir/prospectus" },
      validateCtx,
    );
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/non-sec-source/);
  });

  it("rejects a non-USD candidate", () => {
    const r = validateFinancialCandidate({ ...baseCandidate(), currency: "EUR" }, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/non-usd/);
  });

  it("rejects a decades-stale period end", () => {
    const r = validateFinancialCandidate({ ...baseCandidate(), periodEnd: "2015-12-31" }, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/stale/);
  });

  it("rejects an insufficient set (missing operating income)", () => {
    const c = baseCandidate();
    c.income.operatingIncome = null;
    const r = validateFinancialCandidate(c, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/missing-operating-income/);
  });

  it("rejects an unreconciled operating/capex/FCF triple", () => {
    const c = baseCandidate();
    // stated FCF wildly off from operating − |capex| (= −1.5B).
    c.cashflow.freeCashFlow = 5_000_000_000;
    const r = validateFinancialCandidate(c, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/unreconciled-fcf/);
  });

  it("accepts a reconciled operating/capex/FCF triple within tolerance", () => {
    const c = baseCandidate();
    c.cashflow.freeCashFlow = -1_500_000_000; // exactly operating − |capex|
    expect(validateFinancialCandidate(c, validateCtx).ok).toBe(true);
  });

  it("accepts common US-dollar currency spellings, rejects NON-USD", () => {
    for (const cur of ["USD", "$", "US dollars", "U.S. dollars", "United States dollars"]) {
      expect(validateFinancialCandidate({ ...baseCandidate(), currency: cur }, validateCtx).ok).toBe(true);
    }
    expect(validateFinancialCandidate({ ...baseCandidate(), currency: "NON-USD" }, validateCtx).ok).toBe(false);
  });
});
