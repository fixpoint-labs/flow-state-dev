/**
 * Unit tests for cross-method valuation triangulation (FIX-807).
 *
 * Drives the 0/1/2-method cases off real fixtures (NVDA → DCF-only single
 * method; AAPL → both methods, divergent; JPM → neither, unavailable) plus a
 * synthetic convergent case under the divergence threshold.
 */
import { describe, expect, it } from "vitest";
import { computeTriangulation, DIVERGENCE_THRESHOLD } from "../flows/analysis/lib/triangulation";
import { computeDcfValue, type DcfValue } from "../flows/analysis/lib/dcf";
import { computeFairValue, type FairValue } from "../flows/analysis/lib/fair-value";
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

function legsFor(f: any, b: any, i: any, c: any, sector: string) {
  const er = computeExpectedReturn({ fundamentals: f, balanceSheet: b, incomeStatement: i, cashflow: c });
  const valuation = computeValuation({ fundamentals: f, balanceSheet: b, incomeStatement: i, cashflow: c });
  const fairValue = computeFairValue({ fundamentals: f, incomeStatement: i, expectedReturn: er, sector });
  const dcf = computeDcfValue({ fundamentals: f, incomeStatement: i, cashflow: c, expectedReturn: er, valuation, sector });
  return { fairValue, dcf };
}

describe("computeTriangulation", () => {
  it("NVDA: only DCF available → single-method, consensus = DCF MoS", () => {
    const { fairValue, dcf } = legsFor(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow, "Technology");
    expect(fairValue.available).toBe(false);
    expect(dcf.available).toBe(true);
    const tri = computeTriangulation({ fairValue, dcf });
    expect(tri.divergence).toBe("single-method");
    expect(tri.methodsUsed).toEqual(["dcf"]);
    expect(tri.marginOfSafety).toBeCloseTo(dcf.marginOfSafety!, 10);
    expect(tri.spread).toBeNull();
  });

  it("AAPL: both methods available and far apart → divergent, consensus = mean", () => {
    const { fairValue, dcf } = legsFor(aaplFundamentals, aaplBalanceSheet, aaplIncome, aaplCashflow, "Technology");
    expect(fairValue.available).toBe(true);
    expect(dcf.available).toBe(true);
    const tri = computeTriangulation({ fairValue, dcf });
    expect(tri.divergence).toBe("divergent");
    expect(tri.methodsUsed).toEqual(["justified-pe", "dcf"]);
    expect(tri.marginOfSafety).toBeCloseTo((fairValue.marginOfSafety! + dcf.marginOfSafety!) / 2, 10);
    expect(tri.spread!).toBeGreaterThan(DIVERGENCE_THRESHOLD);
    expect(tri.spread).toBeCloseTo(Math.abs(fairValue.marginOfSafety! - dcf.marginOfSafety!), 10);
  });

  it("JPM (financial): neither method available → unavailable, consensus null", () => {
    const { fairValue, dcf } = legsFor(jpmFundamentals, jpmBalanceSheet, jpmIncome, jpmCashflow, "Financial Services");
    expect(fairValue.available).toBe(false);
    expect(dcf.available).toBe(false);
    const tri = computeTriangulation({ fairValue, dcf });
    expect(tri.divergence).toBe("unavailable");
    expect(tri.marginOfSafety).toBeNull();
    expect(tri.methodsUsed).toEqual([]);
  });

  it("two readings within the threshold → convergent", () => {
    const fairValue = { marginOfSafety: 0.10, available: true } as FairValue;
    const dcf = { marginOfSafety: 0.05, available: true } as DcfValue;
    const tri = computeTriangulation({ fairValue, dcf });
    expect(tri.divergence).toBe("convergent");
    expect(tri.spread).toBeCloseTo(0.05, 10);
    expect(tri.marginOfSafety).toBeCloseTo(0.075, 10);
  });

  it("spread exactly at the threshold is convergent (inclusive boundary)", () => {
    const fairValue = { marginOfSafety: 0.25, available: true } as FairValue;
    const dcf = { marginOfSafety: 0.0, available: true } as DcfValue;
    const tri = computeTriangulation({ fairValue, dcf });
    expect(tri.spread).toBeCloseTo(DIVERGENCE_THRESHOLD, 10);
    expect(tri.divergence).toBe("convergent");
  });
});
