/**
 * Unit tests for the multi-stage DCF intrinsic-value method (FIX-807).
 *
 * Fixture-exact pins for NVDA/AAPL (forward DCF + reverse-DCF), every
 * abstention gate with its structured `unavailableReason`, and the reverse-DCF
 * bracket cases (solved / below-terminal / above-bracket). Pins were captured
 * from the implementation against the committed fixtures; the spec's worked
 * example (NVDA intrinsic ≈ $1,112B, MoS ≈ −165%, TV share ≈ 70%) is the
 * sanity anchor.
 */
import { describe, expect, it } from "vitest";
import { computeDcfValue } from "../flows/analysis/lib/dcf";
import { computeExpectedReturn } from "../flows/analysis/lib/expected-return";
import { computeValuation } from "../flows/analysis/lib/valuation";

import nvdaFundamentals from "../fixtures/NVDA/2026-05-06/fundamentals.json";
import nvdaBalanceSheet from "../fixtures/NVDA/2026-05-06/balance-sheet.json";
import nvdaIncome from "../fixtures/NVDA/2026-05-06/income-statement.json";
import nvdaCashflow from "../fixtures/NVDA/2026-05-06/cashflow.json";

import aaplFundamentals from "../fixtures/AAPL/2026-05-06/fundamentals.json";
import aaplBalanceSheet from "../fixtures/AAPL/2026-05-06/balance-sheet.json";
import aaplIncome from "../fixtures/AAPL/2026-05-06/income-statement.json";
import aaplCashflow from "../fixtures/AAPL/2026-05-06/cashflow.json";

import jpmFundamentals from "../fixtures/JPM/2026-05-06/fundamentals.json";
import jpmBalanceSheet from "../fixtures/JPM/2026-05-06/balance-sheet.json";
import jpmIncome from "../fixtures/JPM/2026-05-06/income-statement.json";
import jpmCashflow from "../fixtures/JPM/2026-05-06/cashflow.json";

function dcfFor(f: any, b: any, i: any, c: any, sector: string | null, overrides: any = {}) {
  const er = overrides.expectedReturn ?? computeExpectedReturn({
    fundamentals: f, balanceSheet: b, incomeStatement: i, cashflow: c,
  });
  const valuation = "valuation" in overrides
    ? overrides.valuation
    : computeValuation({ fundamentals: f, balanceSheet: b, incomeStatement: i, cashflow: c });
  return computeDcfValue({
    fundamentals: overrides.fundamentals ?? f,
    incomeStatement: i,
    cashflow: overrides.cashflow ?? c,
    expectedReturn: er,
    valuation,
    sector,
  });
}

describe("computeDcfValue — forward DCF (fixture-exact)", () => {
  it("NVDA: high-growth name gets a real intrinsic value where justified-PE abstained", () => {
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology");
    expect(dcf.available).toBe(true);
    expect(dcf.method).toBe("dcf");
    expect(dcf.unavailableReason).toBeNull();
    expect(dcf.intrinsicValue).toBeCloseTo(1111.5, 0);
    expect(dcf.marginOfSafety).toBeCloseTo(-1.654, 3);
    expect(dcf.discountRate).toBeCloseTo(0.10, 10);
    expect(dcf.stage1Growth).toBeCloseTo(0.15, 10); // 25% sustainable capped to the 15% DCF stage-1 cap
    // TV share within the reliable band [50%, 85%] — the linear fade keeps it sane.
    expect(dcf.terminalValueShare!).toBeGreaterThan(0.5);
    expect(dcf.terminalValueShare!).toBeLessThanOrEqual(0.85);
    expect(dcf.terminalValueShare).toBeCloseTo(0.700, 2);
    expect(dcf.reliability).toBe("ok");
  });

  it("AAPL: mature grower gets a DCF intrinsic value distinct from justified-PE", () => {
    const dcf = dcfFor(aaplFundamentals, aaplBalanceSheet, aaplIncome, aaplCashflow, "Technology");
    expect(dcf.available).toBe(true);
    expect(dcf.intrinsicValue).toBeCloseTo(1395.5, 0);
    expect(dcf.marginOfSafety).toBeCloseTo(-1.014, 3);
    expect(dcf.stage1Growth).toBeCloseTo(0.05, 10);
    expect(dcf.terminalValueShare!).toBeGreaterThan(0.5);
    expect(dcf.terminalValueShare!).toBeLessThanOrEqual(0.85);
    expect(dcf.reliability).toBe("ok");
  });
});

describe("computeDcfValue — reverse DCF", () => {
  it("NVDA: solves for an implied stage-1 growth above the modeled 15%, positive expectations gap", () => {
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology");
    expect(dcf.reverseDcfStatus).toBe("solved");
    expect(dcf.impliedGrowth).toBeCloseTo(0.697, 2);
    expect(dcf.expectationsGap).toBeCloseTo(0.547, 2);
    expect(dcf.expectationsGap!).toBeGreaterThan(0); // the market prices in more growth than fundamentals support
  });

  it("AAPL: solves with a positive expectations gap", () => {
    const dcf = dcfFor(aaplFundamentals, aaplBalanceSheet, aaplIncome, aaplCashflow, "Technology");
    expect(dcf.reverseDcfStatus).toBe("solved");
    expect(dcf.impliedGrowth).toBeCloseTo(0.390, 2);
    expect(dcf.expectationsGap!).toBeGreaterThan(0);
  });

  it("a deeply-cheap name → below-terminal (market implies sub-terminal growth)", () => {
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology", {
      fundamentals: { ...nvdaFundamentals, marketCap: 10 },
    });
    expect(dcf.available).toBe(true);
    expect(dcf.reverseDcfStatus).toBe("below-terminal");
    expect(dcf.impliedGrowth).toBeCloseTo(0.02, 10); // pinned at terminal
    expect(dcf.expectationsGap).toBeCloseTo(-0.13, 10); // terminal − stage1 = 0.02 − 0.15
  });

  it("a richly-priced name → above-bracket (null gap, market beyond 100% growth)", () => {
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology", {
      fundamentals: { ...nvdaFundamentals, marketCap: 100000 },
    });
    expect(dcf.available).toBe(true);
    expect(dcf.reverseDcfStatus).toBe("above-bracket");
    expect(dcf.impliedGrowth).toBeNull();
    expect(dcf.expectationsGap).toBeNull();
  });
});

describe("computeDcfValue — abstention gates (structured unavailableReason)", () => {
  it("financial sector → 'financial-sector', abstains before the discount lookup", () => {
    const dcf = dcfFor(jpmFundamentals, jpmBalanceSheet, jpmIncome, jpmCashflow, "Financial Services");
    expect(dcf.available).toBe(false);
    expect(dcf.method).toBe("none");
    expect(dcf.unavailableReason).toBe("financial-sector");
    expect(dcf.reverseDcfStatus).toBe("unavailable");
  });

  it("non-positive FCF → 'non-positive-fcf'", () => {
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology", {
      cashflow: { ...nvdaCashflow, freeCashFlow: 0 },
    });
    expect(dcf.available).toBe(false);
    expect(dcf.unavailableReason).toBe("non-positive-fcf");
  });

  it("null net debt (null valuation) → 'missing-net-debt'", () => {
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology", {
      valuation: null,
    });
    expect(dcf.available).toBe(false);
    expect(dcf.unavailableReason).toBe("missing-net-debt");
  });

  it("null sustainable growth → 'missing-growth'", () => {
    const er = computeExpectedReturn({
      fundamentals: nvdaFundamentals as any, balanceSheet: nvdaBalanceSheet as any,
      incomeStatement: nvdaIncome as any, cashflow: nvdaCashflow as any,
    });
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology", {
      expectedReturn: { ...er, sustainableGrowth: null },
    });
    expect(dcf.available).toBe(false);
    expect(dcf.unavailableReason).toBe("missing-growth");
  });

  it("net debt so large equity value is non-positive → 'negative-equity-value'", () => {
    const valuation = computeValuation({
      fundamentals: nvdaFundamentals as any, balanceSheet: nvdaBalanceSheet as any,
      incomeStatement: nvdaIncome as any, cashflow: nvdaCashflow as any,
    });
    const dcf = dcfFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology", {
      valuation: { ...valuation, netDebt: { value: 5000 }, netLeverage: { value: null } },
    });
    expect(dcf.available).toBe(false);
    expect(dcf.unavailableReason).toBe("negative-equity-value");
  });
});
