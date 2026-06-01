/**
 * Unit tests for computeValuation and formatValuation — pins the derived
 * valuation math against NVDA (growth/net-cash) and JPM (leveraged/income)
 * fixtures, plus null-propagation edge cases.
 */
import { describe, expect, it } from "vitest";
import {
  computeValuation,
  formatValuation,
  type DerivedValuation,
} from "../src/flows/trading-desk/lib/valuation";

import nvdaFundamentals from "../fixtures/NVDA/2026-05-06/fundamentals.json";
import nvdaBalanceSheet from "../fixtures/NVDA/2026-05-06/balance-sheet.json";
import nvdaIncome from "../fixtures/NVDA/2026-05-06/income-statement.json";
import nvdaCashflow from "../fixtures/NVDA/2026-05-06/cashflow.json";

import jpmFundamentals from "../fixtures/JPM/2026-05-06/fundamentals.json";
import jpmBalanceSheet from "../fixtures/JPM/2026-05-06/balance-sheet.json";
import jpmIncome from "../fixtures/JPM/2026-05-06/income-statement.json";
import jpmCashflow from "../fixtures/JPM/2026-05-06/cashflow.json";

const nvda = () =>
  computeValuation({
    fundamentals: nvdaFundamentals as any,
    balanceSheet: nvdaBalanceSheet as any,
    incomeStatement: nvdaIncome as any,
    cashflow: nvdaCashflow as any,
  });

const jpm = () =>
  computeValuation({
    fundamentals: jpmFundamentals as any,
    balanceSheet: jpmBalanceSheet as any,
    incomeStatement: jpmIncome as any,
    cashflow: jpmCashflow as any,
  });

describe("computeValuation — NVDA fixture", () => {
  let v: DerivedValuation;
  v = nvda();

  it("computes enterprise value", () => {
    // EV = 2950 + 11 - 38.5 = 2922.5
    expect(v.enterpriseValue.value).toBeCloseTo(2922.5, 1);
  });

  it("computes EV multiples", () => {
    expect(v.evToSales.value).toBeCloseTo(22.39, 1);
    expect(v.evToEbit.value).toBeCloseTo(36.08, 1);
    expect(v.evToEbit.proxy).toBe("operating income used as EBIT proxy");
    expect(v.evToFcf.value).toBeCloseTo(45.66, 1);
  });

  it("computes equity multiples and yields", () => {
    // P/B = 2950 / 73.6 = 40.08
    expect(v.priceToBook.value).toBeCloseTo(40.08, 1);
    // FCF yield = 64 / 2950 = 0.0217
    expect(v.fcfYield.value).toBeCloseTo(0.0217, 3);
    // P/FCF = 2950 / 64 = 46.09
    expect(v.priceToFcf.value).toBeCloseTo(46.09, 1);
    // Earnings yield = 70 / 2950 = 0.0237
    expect(v.earningsYield.value).toBeCloseTo(0.0237, 3);
  });

  it("computes ROA and leverage", () => {
    // ROA = 70 / 96 = 0.729
    expect(v.returnOnAssets.value).toBeCloseTo(0.729, 2);
    // Net debt = 11 - 38.5 = -27.5 (net cash)
    expect(v.netDebt.value).toBeCloseTo(-27.5, 1);
    expect(v.netDebt.note).toBe("net cash");
    // Net leverage = -27.5 / 81 = -0.34
    expect(v.netLeverage.value).toBeCloseTo(-0.34, 1);
  });

  it("computes ROIC with tax proxy", () => {
    // ROIC = 81 * 0.79 / (11 + 73.6 - 38.5) = 63.99 / 46.1 = 1.388
    expect(v.roic.value).toBeCloseTo(1.388, 2);
    expect(v.roic.proxy).toBe("approx — 21% tax assumption");
  });

  it("computes growth-adjusted multiples", () => {
    // PEG = 68.0 / (0.42 * 100) = 68 / 42 = 1.619
    expect(v.peg.value).toBeCloseTo(1.62, 1);
    expect(v.peg.proxy).toBe("revenue growth used in place of EPS growth");
    // PEGY ≈ 68 / (42 + 0.02) ≈ 1.619 (divYield negligible)
    expect(v.pegy.value).toBeCloseTo(1.62, 1);
    expect(v.pegy.proxy).toBe("revenue growth used in place of EPS growth");
  });

  it("labels EV net-cash note when EV is still positive", () => {
    // NVDA EV = 2922.5 > 0, so no net-cash note on EV itself
    expect(v.enterpriseValue.note).toBeUndefined();
  });
});

describe("computeValuation — JPM fixture (leveraged/income regression case)", () => {
  let v: DerivedValuation;
  v = jpm();

  it("computes enterprise value", () => {
    // EV = 615 + 410 - 575 = 450
    expect(v.enterpriseValue.value).toBeCloseTo(450, 1);
  });

  it("computes bank-realistic P/B", () => {
    // P/B = 615 / 335 = 1.836
    expect(v.priceToBook.value).toBeCloseTo(1.84, 1);
    expect(v.priceToBook.value!).toBeLessThan(10);
  });

  it("computes dividend yield and PEGY as non-null", () => {
    // PEG = 13.1 / (0.04 * 100) = 13.1 / 4 = 3.275
    expect(v.peg.value).toBeCloseTo(3.275, 2);
    // PEGY = 13.1 / (4 + 2.2) = 13.1 / 6.2 = 2.113
    expect(v.pegy.value).toBeCloseTo(2.113, 2);
    expect(v.pegy.value).not.toBeNull();
  });

  it("computes net debt", () => {
    // Net debt = 410 - 575 = -165 (net cash for this fixture)
    expect(v.netDebt.value).toBeCloseTo(-165, 1);
  });

  it("computes FCF yield and earnings yield", () => {
    // FCF yield = 24 / 615 = 0.039
    expect(v.fcfYield.value).toBeCloseTo(0.039, 2);
    // Earnings yield = 56 / 615 = 0.091
    expect(v.earningsYield.value).toBeCloseTo(0.091, 2);
  });
});

describe("computeValuation — null propagation", () => {
  const base = {
    fundamentals: { ...nvdaFundamentals, source: "fixture" } as any,
    balanceSheet: nvdaBalanceSheet as any,
    incomeStatement: nvdaIncome as any,
    cashflow: nvdaCashflow as any,
  };

  it("nulls EV multiples when EV <= 0", () => {
    const v = computeValuation({
      ...base,
      fundamentals: { ...base.fundamentals, marketCap: 0 },
    });
    expect(v.evToSales.value).toBeNull();
    expect(v.evToEbit.value).toBeNull();
    expect(v.evToFcf.value).toBeNull();
    expect(v.enterpriseValue.note).toBeDefined();
  });

  it("nulls operatingIncome-dependent metrics when operatingIncome <= 0", () => {
    const v = computeValuation({
      ...base,
      incomeStatement: { ...base.incomeStatement, operatingIncome: -5 },
    });
    expect(v.evToEbit.value).toBeNull();
    expect(v.netLeverage.value).toBeNull();
    expect(v.roic.value).toBeNull();
  });

  it("nulls FCF-dependent metrics when freeCashFlow <= 0", () => {
    const v = computeValuation({
      ...base,
      cashflow: { ...base.cashflow, freeCashFlow: -2 },
    });
    expect(v.evToFcf.value).toBeNull();
    expect(v.fcfYield.value).toBeNull();
    expect(v.priceToFcf.value).toBeNull();
  });

  it("nulls priceToBook when totalEquity <= 0", () => {
    const v = computeValuation({
      ...base,
      balanceSheet: { ...base.balanceSheet, totalEquity: -10 },
    });
    expect(v.priceToBook.value).toBeNull();
  });

  it("nulls earningsYield when netIncome <= 0 but keeps ROA (real negative)", () => {
    const v = computeValuation({
      ...base,
      incomeStatement: { ...base.incomeStatement, netIncome: -3 },
    });
    expect(v.earningsYield.value).toBeNull();
    expect(v.returnOnAssets.value).toBeCloseTo(-3 / 96, 4);
  });

  it("nulls PEG and PEGY when trailingPE is null", () => {
    const v = computeValuation({
      ...base,
      fundamentals: { ...base.fundamentals, trailingPE: null },
    });
    expect(v.peg.value).toBeNull();
    expect(v.pegy.value).toBeNull();
  });

  it("nulls PEG and PEGY when yoyRevenueGrowth <= 0", () => {
    const v = computeValuation({
      ...base,
      incomeStatement: { ...base.incomeStatement, yoyRevenueGrowth: -0.05 },
    });
    expect(v.peg.value).toBeNull();
    expect(v.pegy.value).toBeNull();
  });

  it("falls back PEGY to growth-only denominator when dividendYield is null", () => {
    const v = computeValuation({
      ...base,
      fundamentals: { ...base.fundamentals, dividendYield: null },
    });
    // PEG = 68 / 42 = 1.619
    expect(v.peg.value).toBeCloseTo(1.619, 2);
    // PEGY with null div → same as PEG (growth-only denom)
    expect(v.pegy.value).toBeCloseTo(1.619, 2);
  });
});

describe("computeValuation — meaningful negatives are kept", () => {
  const base = {
    fundamentals: nvdaFundamentals as any,
    balanceSheet: nvdaBalanceSheet as any,
    incomeStatement: nvdaIncome as any,
    cashflow: nvdaCashflow as any,
  };

  it("keeps negative net debt (net cash)", () => {
    const v = computeValuation(base);
    expect(v.netDebt.value).toBeLessThan(0);
    expect(v.netDebt.note).toBe("net cash");
  });

  it("keeps negative ROA on loss-making name", () => {
    const v = computeValuation({
      ...base,
      incomeStatement: { ...base.incomeStatement, netIncome: -5 },
    });
    expect(v.returnOnAssets.value).toBeLessThan(0);
    expect(v.returnOnAssets.value).not.toBeNull();
  });
});

describe("proxy and note labels", () => {
  const v = nvda();

  it("evToEbit carries EBIT proxy label", () => {
    expect(v.evToEbit.proxy).toBe("operating income used as EBIT proxy");
  });

  it("roic carries tax proxy label", () => {
    expect(v.roic.proxy).toBe("approx — 21% tax assumption");
  });

  it("peg and pegy carry revenue-growth proxy label", () => {
    expect(v.peg.proxy).toBe("revenue growth used in place of EPS growth");
    expect(v.pegy.proxy).toBe("revenue growth used in place of EPS growth");
  });

  it("net-cash entries carry note", () => {
    expect(v.netDebt.note).toBe("net cash");
  });
});

describe("formatValuation", () => {
  it("renders n/a for null values and appends proxy/note suffixes", () => {
    const v = nvda();
    const output = formatValuation(v);

    expect(output).toContain("Enterprise value: $2922.5B");
    expect(output).toContain("EV/EBIT:");
    expect(output).toContain("proxy: operating income used as EBIT proxy");
    expect(output).toContain("Net debt: $-27.5B (net cash)");
    expect(output).toContain("PEG:");
    expect(output).toContain("proxy: revenue growth used in place of EPS growth");
  });

  it("renders n/a when metrics are null", () => {
    const v = computeValuation({
      fundamentals: { ...nvdaFundamentals, marketCap: 0, trailingPE: null } as any,
      balanceSheet: nvdaBalanceSheet as any,
      incomeStatement: nvdaIncome as any,
      cashflow: nvdaCashflow as any,
    });
    const output = formatValuation(v);

    expect(output).toContain("PEG: n/a");
    expect(output).toContain("PEGY: n/a");
  });
});
