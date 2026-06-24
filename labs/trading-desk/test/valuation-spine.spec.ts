/**
 * Unit tests for the valuation spine pure math libraries.
 *
 * Tests computeExpectedReturn, computeFairValue, computeSetupScore,
 * modelImpliedRating, clampRatingToBand, and buildValuationSpine against
 * the three real fixtures (NVDA, AAPL, JPM) plus synthetic edge cases
 * (loss-makers, negative FCF, r ≤ g, financials).
 */
import { describe, expect, it } from "vitest";
import { computeExpectedReturn, HURDLE_RATE } from "../src/flows/analysis/lib/expected-return";
import { computeFairValue, isFinancialSector } from "../src/flows/analysis/lib/fair-value";
import { computeSetupScore } from "../src/flows/analysis/lib/setup-score";
import {
  modelImpliedRating,
  clampRatingToBand,
  type FinalRating,
} from "../src/flows/analysis/lib/rating-engine";
import {
  buildValuationSpine,
  formatValuationSpine,
  formatRatingEnvelope,
} from "../src/flows/analysis/lib/valuation-spine";
import { computeValuation } from "../src/flows/analysis/lib/valuation";
import { valuationSpineStateSchema } from "../src/flows/analysis/valuation-spine-resource";

import nvdaFundamentals from "../fixtures/NVDA/2026-05-06/fundamentals.json";
import nvdaBalanceSheet from "../fixtures/NVDA/2026-05-06/balance-sheet.json";
import nvdaIncome from "../fixtures/NVDA/2026-05-06/income-statement.json";
import nvdaCashflow from "../fixtures/NVDA/2026-05-06/cashflow.json";
import nvdaQuantComposites from "../fixtures/NVDA/2026-05-06/quant-composites.json";
import nvdaFactorRanks from "../fixtures/NVDA/2026-05-06/factor-ranks.json";
import nvdaIndicators from "../fixtures/NVDA/2026-05-06/indicators.json";

import aaplFundamentals from "../fixtures/AAPL/2026-05-06/fundamentals.json";
import aaplBalanceSheet from "../fixtures/AAPL/2026-05-06/balance-sheet.json";
import aaplIncome from "../fixtures/AAPL/2026-05-06/income-statement.json";
import aaplCashflow from "../fixtures/AAPL/2026-05-06/cashflow.json";
import aaplQuantComposites from "../fixtures/AAPL/2026-05-06/quant-composites.json";
import aaplFactorRanks from "../fixtures/AAPL/2026-05-06/factor-ranks.json";
import aaplIndicators from "../fixtures/AAPL/2026-05-06/indicators.json";

import jpmFundamentals from "../fixtures/JPM/2026-05-06/fundamentals.json";
import jpmBalanceSheet from "../fixtures/JPM/2026-05-06/balance-sheet.json";
import jpmIncome from "../fixtures/JPM/2026-05-06/income-statement.json";
import jpmCashflow from "../fixtures/JPM/2026-05-06/cashflow.json";
import jpmQuantComposites from "../fixtures/JPM/2026-05-06/quant-composites.json";
import jpmFactorRanks from "../fixtures/JPM/2026-05-06/factor-ranks.json";
import jpmIndicators from "../fixtures/JPM/2026-05-06/indicators.json";

// ── Helpers ─────────────────────────────────────────────────────────

function makeFixture(
  fundamentals: any,
  balanceSheet: any,
  incomeStatement: any,
  cashflow: any,
) {
  return { fundamentals, balanceSheet, incomeStatement, cashflow };
}

const nvdaStatements = makeFixture(nvdaFundamentals, nvdaBalanceSheet, nvdaIncome, nvdaCashflow);
const aaplStatements = makeFixture(aaplFundamentals, aaplBalanceSheet, aaplIncome, aaplCashflow);
const jpmStatements = makeFixture(jpmFundamentals, jpmBalanceSheet, jpmIncome, jpmCashflow);

// ── Expected Return ─────────────────────────────────────────────────

describe("computeExpectedReturn", () => {
  it("NVDA: uses FCF basis with positive expected return", () => {
    const er = computeExpectedReturn(nvdaStatements);
    expect(er.basis).toBe("fcf");
    expect(er.lowConfidence).toBe(false);
    expect(er.shareholderYield).toBeGreaterThan(0);
    expect(er.sustainableGrowth).toBeGreaterThan(0);
    expect(er.expectedReturn).toBeGreaterThan(0);
    // NVDA: FCF yield = 64/2950 ≈ 2.17% (no divYield — FCF encompasses distributions)
    expect(er.shareholderYield).toBeCloseTo(0.0217, 3);
  });

  it("AAPL: uses FCF basis", () => {
    const er = computeExpectedReturn(aaplStatements);
    expect(er.basis).toBe("fcf");
    // AAPL: FCF yield = 105/2810 ≈ 3.74%
    expect(er.shareholderYield).toBeCloseTo(0.0374, 3);
  });

  it("JPM: uses FCF basis", () => {
    const er = computeExpectedReturn(jpmStatements);
    expect(er.basis).toBe("fcf");
    // JPM: FCF yield = 24/615 ≈ 3.90%
    expect(er.shareholderYield).toBeCloseTo(0.0390, 3);
  });

  it("negative FCF falls back to earnings", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      cashflow: { ...nvdaCashflow, freeCashFlow: -5 } as any,
    });
    expect(er.basis).toBe("earnings");
    expect(er.shareholderYield).toBeGreaterThan(0);
  });

  it("both FCF and earnings negative → lowConfidence, no expected return", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      cashflow: { ...nvdaCashflow, freeCashFlow: -5 } as any,
      incomeStatement: { ...nvdaIncome, netIncome: -10 } as any,
    });
    expect(er.basis).toBe("none");
    expect(er.lowConfidence).toBe(true);
    expect(er.shareholderYield).toBeNull();
    expect(er.expectedReturn).toBeNull();
    expect(er.excessReturn).toBeNull();
  });

  it("caps growth at GROWTH_CAP", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      incomeStatement: { ...nvdaIncome, yoyRevenueGrowth: 0.80 } as any,
    });
    expect(er.sustainableGrowth).toBeLessThanOrEqual(0.25);
  });

  it("floors growth at terminal rate", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      incomeStatement: { ...nvdaIncome, yoyRevenueGrowth: 0.005 } as any,
    });
    expect(er.sustainableGrowth).toBeGreaterThanOrEqual(0.02);
  });

  it("hurdle rate is 9%", () => {
    expect(HURDLE_RATE).toBe(0.09);
  });
});

// ── Fair Value ──────────────────────────────────────────────────────

describe("computeFairValue", () => {
  it("NVDA: high-growth name is outside the Gordon domain → honest n/a, never a collapsed figure", () => {
    // FIX-778 regression: growth capped at 25% vs the 9% hurdle means the
    // single-stage Gordon model does not apply. The old code emitted
    // justifiedPE 0.4856 / fairValue $21B / MoS −139.0 here.
    const er = computeExpectedReturn(nvdaStatements);
    const fv = computeFairValue({
      fundamentals: nvdaFundamentals as any,
      incomeStatement: nvdaIncome as any,
      expectedReturn: er,
      sector: "Technology",
    });
    expect(fv.method).toBe("none");
    expect(fv.justifiedPE).toBeNull();
    expect(fv.fairValue).toBeNull();
    expect(fv.marginOfSafety).toBeNull();
    expect(fv.available).toBe(false);
  });

  it("AAPL: mature grower gets a sane justified PE from the sustainable payout at the hurdle rate", () => {
    // FIX-778 regression: pins the hurdle-discounted, 1 − g/ROE payout math.
    // g = 5%, ROE = 1.65 → payout ≈ 0.970, justified PE ≈ 25.45× (vs trailing
    // 31.2×), fair cap ≈ $2,293B, MoS ≈ −22.6%. The old code emitted a 3.5×
    // justified PE and a −782% margin of safety.
    const er = computeExpectedReturn(aaplStatements);
    const fv = computeFairValue({
      fundamentals: aaplFundamentals as any,
      incomeStatement: aaplIncome as any,
      expectedReturn: er,
      sector: "Technology",
    });
    expect(fv.method).toBe("justified-pe");
    expect(fv.available).toBe(true);
    expect(fv.justifiedPE).toBeCloseTo(25.45, 1);
    expect(fv.fairValue).toBeCloseTo(2292.5, 0);
    expect(fv.marginOfSafety).toBeCloseTo(-0.2257, 3);
  });

  it("r − g spread below 200bps → n/a (denominator blow-up gate)", () => {
    const er = computeExpectedReturn(aaplStatements);
    const erOverride = { ...er, sustainableGrowth: 0.08 }; // hurdle 9% − 8% = 1pp
    const fv = computeFairValue({
      fundamentals: aaplFundamentals as any,
      incomeStatement: aaplIncome as any,
      expectedReturn: erOverride,
      sector: "Technology",
    });
    expect(fv.method).toBe("none");
    expect(fv.fairValue).toBeNull();
    expect(fv.available).toBe(false);
  });

  it("ROE ≤ g → n/a (growth not fundable from retention, implied payout ≤ 0)", () => {
    const er = computeExpectedReturn(aaplStatements);
    const erOverride = { ...er, sustainableGrowth: 0.05 };
    const fv = computeFairValue({
      fundamentals: { ...aaplFundamentals, returnOnEquity: 0.04 } as any,
      incomeStatement: aaplIncome as any,
      expectedReturn: erOverride,
      sector: "Technology",
    });
    expect(fv.method).toBe("none");
    expect(fv.fairValue).toBeNull();
    expect(fv.available).toBe(false);
  });

  it("JPM: uses equity-multiples for financials, no fair value computed", () => {
    const er = computeExpectedReturn(jpmStatements);
    const fv = computeFairValue({
      fundamentals: jpmFundamentals as any,
      incomeStatement: jpmIncome as any,
      expectedReturn: er,
      sector: "Financial Services",
    });
    expect(fv.method).toBe("equity-multiples");
    expect(fv.justifiedPE).toBeNull();
    expect(fv.fairValue).toBeNull();
    expect(fv.available).toBe(false);
  });

  it("r ≤ g → no fair value", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      incomeStatement: { ...nvdaIncome, yoyRevenueGrowth: 0.80 } as any,
    });
    // Force a case where yield + growth < growth (possible if yield is tiny)
    const erOverride = { ...er, expectedReturn: 0.03, sustainableGrowth: 0.25 };
    const fv = computeFairValue({
      fundamentals: nvdaFundamentals as any,
      incomeStatement: nvdaIncome as any,
      expectedReturn: erOverride,
      sector: "Technology",
    });
    expect(fv.method).toBe("none");
    expect(fv.fairValue).toBeNull();
  });

  it("negative earnings → no fair value", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      cashflow: { ...nvdaCashflow, freeCashFlow: -5 } as any,
      incomeStatement: { ...nvdaIncome, netIncome: -10 } as any,
    });
    const fv = computeFairValue({
      fundamentals: nvdaFundamentals as any,
      incomeStatement: { ...nvdaIncome, netIncome: -10 } as any,
      expectedReturn: er,
      sector: "Technology",
    });
    expect(fv.fairValue).toBeNull();
    expect(fv.available).toBe(false);
  });
});

describe("isFinancialSector", () => {
  it("recognizes financial sector variants", () => {
    expect(isFinancialSector("Financial Services")).toBe(true);
    expect(isFinancialSector("Financials")).toBe(true);
    expect(isFinancialSector("Banks")).toBe(true);
    expect(isFinancialSector("Technology")).toBe(false);
    expect(isFinancialSector(null)).toBe(false);
  });
});

// ── Setup Score ─────────────────────────────────────────────────────

describe("computeSetupScore", () => {
  it("NVDA: computes a score with all components", () => {
    const er = computeExpectedReturn(nvdaStatements);
    const fv = computeFairValue({
      fundamentals: nvdaFundamentals as any,
      incomeStatement: nvdaIncome as any,
      expectedReturn: er,
      sector: "Technology",
    });
    const ss = computeSetupScore({
      expectedReturn: er,
      marginOfSafety: fv.marginOfSafety,
      quantComposites: nvdaQuantComposites,
      factorRanks: nvdaFactorRanks,
      technicals: nvdaIndicators,
      valuation: computeValuation(nvdaStatements as any),
    });
    expect(ss.score).not.toBeNull();
    expect(ss.score!).toBeGreaterThanOrEqual(0);
    expect(ss.score!).toBeLessThanOrEqual(100);
    expect(ss.evidenceBasis).toBe("sufficient");
  });

  it("all null inputs → thin evidence, null score", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      cashflow: { ...nvdaCashflow, freeCashFlow: -5 } as any,
      incomeStatement: { ...nvdaIncome, netIncome: -10, yoyRevenueGrowth: null } as any,
    });
    const fv = computeFairValue({
      fundamentals: nvdaFundamentals as any,
      incomeStatement: { ...nvdaIncome, netIncome: -10 } as any,
      expectedReturn: er,
      sector: "Technology",
    });
    const ss = computeSetupScore({
      expectedReturn: er,
      marginOfSafety: fv.marginOfSafety,
      quantComposites: null,
      factorRanks: null,
      technicals: null,
      valuation: null,
    });
    expect(ss.evidenceBasis).toBe("thin");
  });
});

// ── Rating Engine ───────────────────────────────────────────────────

describe("modelImpliedRating", () => {
  function spineForTicker(
    statements: any,
    sector: string,
    quantComposites: any,
    factorRanks: any,
    technicals: any,
  ) {
    const er = computeExpectedReturn(statements);
    const fv = computeFairValue({
      fundamentals: statements.fundamentals,
      incomeStatement: statements.incomeStatement,
      expectedReturn: er,
      sector,
    });
    const ss = computeSetupScore({
      expectedReturn: er,
      marginOfSafety: fv.marginOfSafety,
      quantComposites,
      factorRanks,
      technicals,
      valuation: computeValuation(statements),
    });
    return modelImpliedRating({ expectedReturn: er, fairValue: fv, setupScore: ss });
  }

  const nvdaEnv = spineForTicker(nvdaStatements, "Technology", nvdaQuantComposites, nvdaFactorRanks, nvdaIndicators);
  const aaplEnv = spineForTicker(aaplStatements, "Technology", aaplQuantComposites, aaplFactorRanks, aaplIndicators);
  const jpmEnv = spineForTicker(jpmStatements, "Financial Services", jpmQuantComposites, jpmFactorRanks, jpmIndicators);

  it("produces envelopes for all three fixtures", () => {
    expect(nvdaEnv.implied).toBeDefined();
    expect(aaplEnv.implied).toBeDefined();
    expect(jpmEnv.implied).toBeDefined();
  });

  it("produces at least two distinct implied ratings across three fixtures", () => {
    const ratings = new Set([nvdaEnv.implied, aaplEnv.implied, jpmEnv.implied]);
    expect(ratings.size).toBeGreaterThanOrEqual(2);
  });

  it("envelope has valid floor ≤ implied ≤ ceiling", () => {
    const ladder: FinalRating[] = ["Sell", "Underweight", "Hold", "Overweight", "Buy"];
    for (const env of [nvdaEnv, aaplEnv, jpmEnv]) {
      expect(ladder.indexOf(env.floor)).toBeLessThanOrEqual(ladder.indexOf(env.implied));
      expect(ladder.indexOf(env.implied)).toBeLessThanOrEqual(ladder.indexOf(env.ceiling));
    }
  });

  it("JPM (financial) uses equity-multiples method, no EV-based garbage", () => {
    // Verify JPM's fair value method is equity-multiples
    const er = computeExpectedReturn(jpmStatements);
    const fv = computeFairValue({
      fundamentals: jpmFundamentals as any,
      incomeStatement: jpmIncome as any,
      expectedReturn: er,
      sector: "Financial Services",
    });
    expect(fv.method).toBe("equity-multiples");
  });

  it("low-confidence name centers on Hold with wider band", () => {
    const er = computeExpectedReturn({
      ...nvdaStatements,
      cashflow: { ...nvdaCashflow, freeCashFlow: -5 } as any,
      incomeStatement: { ...nvdaIncome, netIncome: -10, yoyRevenueGrowth: null } as any,
    });
    const fv = computeFairValue({
      fundamentals: nvdaFundamentals as any,
      incomeStatement: { ...nvdaIncome, netIncome: -10 } as any,
      expectedReturn: er,
      sector: "Technology",
    });
    const ss = computeSetupScore({
      expectedReturn: er,
      marginOfSafety: fv.marginOfSafety,
      quantComposites: null,
      factorRanks: null,
      technicals: null,
      valuation: null,
    });
    const env = modelImpliedRating({ expectedReturn: er, fairValue: fv, setupScore: ss });
    expect(env.implied).toBe("Hold");
    // Wider band for thin evidence
    const ladder: FinalRating[] = ["Sell", "Underweight", "Hold", "Overweight", "Buy"];
    const spread = ladder.indexOf(env.ceiling) - ladder.indexOf(env.floor);
    expect(spread).toBeGreaterThanOrEqual(2);
  });

  it("strong setup + missing valuation → implied Overweight, floor not below Hold", () => {
    // Regression (FIX-715 follow-up): the TSM case. Valuation/return is
    // uncomputable (excessReturn null, lowConfidence), but quality/factor/
    // momentum give a high setup score. The absolute axis is Hold ("no return
    // estimate"), the relative axis is Overweight (score ≥ 65) → combined
    // Overweight. Thin evidence must NOT widen the band downward: missing data
    // is absorbed by confidence, not by a lower rating. So the floor must be
    // Hold (implied − 1), never Underweight (implied − 2).
    const er = {
      shareholderYield: null,
      sustainableGrowth: null,
      expectedReturn: null,
      hurdle: HURDLE_RATE,
      excessReturn: null,
      basis: "none" as const,
      lowConfidence: true,
    };
    const fv = {
      justifiedPE: null,
      fairValue: null,
      marginOfSafety: null,
      method: "none" as const,
      available: false,
    };
    const ss = {
      score: 82,
      value: null,
      quality: 90,
      factor: 88,
      momentum: 75,
      evidenceBasis: "sufficient" as const,
    };
    const env = modelImpliedRating({ expectedReturn: er, fairValue: fv, setupScore: ss });
    expect(env.absoluteRating).toBe("Hold");
    expect(env.relativeRating).toBe("Overweight");
    expect(env.implied).toBe("Overweight");
    // The fix: floor is Hold, not Underweight — missing data cannot open a
    // path below the implied rating.
    expect(env.floor).toBe("Hold");
    // Upward room is preserved for thin evidence.
    expect(env.ceiling).toBe("Buy");
  });

  it("both absolute and relative ratings are present", () => {
    expect(nvdaEnv.absoluteRating).toBeDefined();
    expect(nvdaEnv.relativeRating).toBeDefined();
    expect(["Buy", "Hold", "Sell"]).toContain(nvdaEnv.absoluteRating);
    expect(["Overweight", "Equal Weight", "Underweight"]).toContain(nvdaEnv.relativeRating);
  });
});

// ── FIX-778: MoS floor fires only on valid readings ────────────────

describe("FIX-778 regression — low-payout growth envelope", () => {
  const baseEr = {
    shareholderYield: 0.022,
    sustainableGrowth: 0.25,
    expectedReturn: 0.272,
    hurdle: HURDLE_RATE,
    excessReturn: 0.182,
    basis: "fcf" as const,
    lowConfidence: false,
  };
  const unavailableFv = {
    justifiedPE: null,
    fairValue: null,
    marginOfSafety: null,
    method: "none" as const,
    available: false,
  };
  const supportiveSs = {
    score: 67,
    value: 70,
    quality: 75,
    factor: 60,
    momentum: 60,
    evidenceBasis: "sufficient" as const,
  };

  it("strong excess return + unavailable MoS → absolute Buy, return-anchored rationale", () => {
    const env = modelImpliedRating({
      expectedReturn: baseEr,
      fairValue: unavailableFv,
      setupScore: supportiveSs,
    });
    expect(env.absoluteRating).toBe("Buy");
    expect(env.rationale).toContain("margin of safety unavailable");
    expect(env.rationale).toContain("return-anchored");
  });

  it("strong excess return + VALID MoS below 25% → the Hold floor still binds", () => {
    const env = modelImpliedRating({
      expectedReturn: baseEr,
      fairValue: { ...unavailableFv, justifiedPE: 20, fairValue: 1000, marginOfSafety: 0.10, method: "justified-pe" as const, available: true },
      setupScore: supportiveSs,
    });
    expect(env.absoluteRating).toBe("Hold");
    expect(env.rationale).toContain("margin of safety 10% < 25%");
  });

  it("strong excess return + valid MoS ≥ 25% → Buy (unchanged confirmation path)", () => {
    const env = modelImpliedRating({
      expectedReturn: baseEr,
      fairValue: { ...unavailableFv, justifiedPE: 20, fairValue: 5000, marginOfSafety: 0.30, method: "justified-pe" as const, available: true },
      setupScore: supportiveSs,
    });
    expect(env.absoluteRating).toBe("Buy");
  });

  it("the NVDA-shaped case can clear Hold: implied rating is above Hold", () => {
    // The issue's acceptance criterion: a high-growth, low-payout name with a
    // strong excess return and supportive setup is no longer locked out of Buy.
    const env = modelImpliedRating({
      expectedReturn: baseEr,
      fairValue: unavailableFv,
      setupScore: supportiveSs,
    });
    const ladder: FinalRating[] = ["Sell", "Underweight", "Hold", "Overweight", "Buy"];
    expect(ladder.indexOf(env.implied)).toBeGreaterThan(ladder.indexOf("Hold"));
    expect(env.ceiling).toBe("Buy");
  });

  it("NVDA fixture end-to-end: spine carries no absurd figures and the envelope is Buy-capable", () => {
    const spine = buildValuationSpine({
      ticker: "NVDA",
      asOf: "2026-05-06",
      ...nvdaStatements,
      sector: "Technology",
      quantComposites: nvdaQuantComposites,
      factorRanks: nvdaFactorRanks,
      technicals: nvdaIndicators,
      valuation: computeValuation(nvdaStatements as any),
    });
    expect(spine.fairValue.available).toBe(false);
    expect(spine.fairValue.marginOfSafety).toBeNull();
    expect(spine.envelope.absoluteRating).toBe("Buy");
    expect(spine.envelope.ceiling).toBe("Buy");
    // The old defect printed "margin of safety -13902% < 25%" here — an absurd
    // 4+-digit figure from the collapsed justified-PE. The legitimate FIX-807
    // DCF consensus (−165%) is a real 3-digit read and must be allowed; only the
    // absurd magnitude is the defect signal.
    expect(spine.envelope.rationale).not.toMatch(/-\d{4,}%/);
  });
});

// ── Clamp ───────────────────────────────────────────────────────────

describe("clampRatingToBand", () => {
  const envelope = {
    absoluteRating: "Hold" as const,
    relativeRating: "Equal Weight" as const,
    implied: "Hold" as const,
    floor: "Underweight" as const,
    ceiling: "Overweight" as const,
    rationale: "test",
  };

  it("within-band rating passes through", () => {
    const result = clampRatingToBand("Hold", envelope, "");
    expect(result.final).toBe("Hold");
    expect(result.clamped).toBe(false);
  });

  it("floor-edge rating passes through", () => {
    const result = clampRatingToBand("Underweight", envelope, "");
    expect(result.final).toBe("Underweight");
    expect(result.clamped).toBe(false);
  });

  it("ceiling-edge rating passes through", () => {
    const result = clampRatingToBand("Overweight", envelope, "");
    expect(result.final).toBe("Overweight");
    expect(result.clamped).toBe(false);
  });

  it("above-band without reason → clamped to ceiling", () => {
    const result = clampRatingToBand("Buy", envelope, "");
    expect(result.final).toBe("Overweight");
    expect(result.clamped).toBe(true);
  });

  it("below-band without reason → clamped to floor", () => {
    const result = clampRatingToBand("Sell", envelope, "");
    expect(result.final).toBe("Underweight");
    expect(result.clamped).toBe(true);
  });

  it("above-band with reason → preserved", () => {
    const result = clampRatingToBand("Buy", envelope, "Model misses the catalyst.");
    expect(result.final).toBe("Buy");
    expect(result.clamped).toBe(false);
  });

  it("below-band with reason → preserved", () => {
    const result = clampRatingToBand("Sell", envelope, "Model misses the risk.");
    expect(result.final).toBe("Sell");
    expect(result.clamped).toBe(false);
  });

  it("whitespace-only reason counts as no reason", () => {
    const result = clampRatingToBand("Buy", envelope, "   ");
    expect(result.clamped).toBe(true);
  });
});

// ── Build + Format ──────────────────────────────────────────────────

describe("buildValuationSpine", () => {
  it("builds a complete spine from NVDA fixture data", () => {
    const spine = buildValuationSpine({
      ticker: "NVDA",
      asOf: "2026-05-06",
      ...nvdaStatements,
      sector: "Technology",
      quantComposites: nvdaQuantComposites,
      factorRanks: nvdaFactorRanks,
      technicals: nvdaIndicators,
      valuation: computeValuation(nvdaStatements as any),
    });
    expect(spine.ticker).toBe("NVDA");
    expect(spine.envelope.implied).toBeDefined();
    expect(spine.expectedReturn.basis).toBe("fcf");
    expect(spine.valuationMethod).toBe("ev-multiples");
  });

  it("JPM spine uses equity-multiples method", () => {
    const spine = buildValuationSpine({
      ticker: "JPM",
      asOf: "2026-05-06",
      ...jpmStatements,
      sector: "Financial Services",
      quantComposites: jpmQuantComposites,
      factorRanks: jpmFactorRanks,
      technicals: jpmIndicators,
      valuation: computeValuation(jpmStatements as any),
    });
    expect(spine.valuationMethod).toBe("equity-multiples");
  });
});

describe("formatValuationSpine", () => {
  it("renders without throwing", () => {
    const spine = buildValuationSpine({
      ticker: "NVDA",
      asOf: "2026-05-06",
      ...nvdaStatements,
      sector: "Technology",
      quantComposites: nvdaQuantComposites,
      factorRanks: nvdaFactorRanks,
      technicals: nvdaIndicators,
      valuation: computeValuation(nvdaStatements as any),
    });
    const text = formatValuationSpine(spine);
    expect(text).toContain("<valuationSpine");
    expect(text).toContain("Expected return:");
    expect(text).toContain("Setup score:");
  });
});

describe("formatRatingEnvelope", () => {
  it("renders without throwing", () => {
    const spine = buildValuationSpine({
      ticker: "NVDA",
      asOf: "2026-05-06",
      ...nvdaStatements,
      sector: "Technology",
      quantComposites: nvdaQuantComposites,
      factorRanks: nvdaFactorRanks,
      technicals: nvdaIndicators,
      valuation: computeValuation(nvdaStatements as any),
    });
    const text = formatRatingEnvelope(spine.envelope);
    expect(text).toContain("<ratingEnvelope>");
    expect(text).toContain("Absolute rating");
    expect(text).toContain("Relative rating");
    expect(text).toContain("Permitted band:");
  });
});

// ── FIX-807: DCF + triangulation spine integration ──────────────────

function buildSpine(ticker: string, statements: any, sector: string, quant: any, factor: any, tech: any) {
  return buildValuationSpine({
    ticker,
    asOf: "2026-05-06",
    ...statements,
    sector,
    quantComposites: quant,
    factorRanks: factor,
    technicals: tech,
    valuation: computeValuation(statements),
  });
}

describe("FIX-807 — DCF + triangulation wired into the spine", () => {
  const nvda = buildSpine("NVDA", nvdaStatements, "Technology", nvdaQuantComposites, nvdaFactorRanks, nvdaIndicators);
  const aapl = buildSpine("AAPL", aaplStatements, "Technology", aaplQuantComposites, aaplFactorRanks, aaplIndicators);
  const jpm = buildSpine("JPM", jpmStatements, "Financial Services", jpmQuantComposites, jpmFactorRanks, jpmIndicators);

  it("NVDA: DCF fills the value axis justified-PE abstained on, single-method triangulation", () => {
    expect(nvda.fairValue.available).toBe(false); // justified-PE still abstains
    expect(nvda.dcf.available).toBe(true);
    expect(nvda.dcf.marginOfSafety).toBeCloseTo(-1.654, 3);
    expect(nvda.triangulation.divergence).toBe("single-method");
    expect(nvda.triangulation.methodsUsed).toEqual(["dcf"]);
  });

  it("NVDA: absolute Buy gate stays anchored to justified-PE — Buy preserved (FIX-778)", () => {
    // The conservative DCF reads NVDA −165% on intrinsic value, but the hard gate
    // is return-anchored, so NVDA stays Buy-capable (Open Q1: soft-only).
    expect(nvda.envelope.absoluteRating).toBe("Buy");
    expect(nvda.envelope.implied).toBe("Buy");
    // The consensus number is surfaced in the rationale (not in the gate).
    expect(nvda.envelope.rationale).toContain("consensus margin of safety");
  });

  it("AAPL: value sub-score reflects the more-bearish triangulated MoS, implied rating unchanged", () => {
    expect(aapl.triangulation.divergence).toBe("divergent");
    // Value sub-score routed through the consensus (−62%) vs justified-PE alone (−22.6%):
    const peOnly = computeSetupScore({
      expectedReturn: aapl.expectedReturn,
      marginOfSafety: aapl.fairValue.marginOfSafety, // justified-PE only
      quantComposites: aaplQuantComposites,
      factorRanks: aaplFactorRanks,
      technicals: aaplIndicators,
      valuation: computeValuation(aaplStatements as any),
    });
    expect(aapl.setupScore.value!).toBeLessThan(peOnly.value!); // triangulation is strictly more bearish
    // …but the shift is bounded and does NOT flip the implied rating.
    expect(aapl.envelope.implied).toBe("Hold");
  });

  it("JPM (financial): DCF abstains with a structured reason, triangulation unavailable", () => {
    expect(jpm.dcf.available).toBe(false);
    expect(jpm.dcf.unavailableReason).toBe("financial-sector");
    expect(jpm.triangulation.divergence).toBe("unavailable");
    expect(jpm.triangulation.marginOfSafety).toBeNull();
  });

  it("formatter surfaces the DCF + triangulation + reverse-DCF lines to the prompt", () => {
    const text = formatValuationSpine(nvda);
    expect(text).toContain("Intrinsic value (DCF): $1111.5B");
    expect(text).toContain("DCF margin of safety: -165.4%");
    expect(text).toContain("stage-1 growth 15%");
    expect(text).toContain("terminal-value share 70%");
    expect(text).toContain("Triangulation: single-method");
    expect(text).toContain("reverse-DCF implies 70%");
    expect(text).toContain("expectations gap +55pp");
  });

  it("formatter renders an abstained DCF + triangulation as n/a with the reason", () => {
    const text = formatValuationSpine(jpm);
    expect(text).toContain("Intrinsic value (DCF): n/a (financial-sector)");
    expect(text).toContain("Triangulation: n/a");
  });

  it("formatter renders a divergent triangulation line (AAPL)", () => {
    const text = formatValuationSpine(aapl);
    expect(text).toContain("Triangulation: divergent");
    expect(text).toContain("reverse-DCF implies 39%");
  });

  it("formatter renders the ⚠ terminal-value-dominated flag when reliability trips", () => {
    // The flag is a defensive guard the production constants (15% stage-1 cap,
    // 6.5% rate floor, conservative linear fade) keep below 0.85 — so assert the
    // RENDERING against a spine whose DCF leg carries the flag.
    const flagged = { ...nvda, dcf: { ...nvda.dcf, reliability: "tv-dominated" as const } };
    expect(formatValuationSpine(flagged)).toContain("⚠ terminal-value-dominated");
  });
});

describe("FIX-807 — resource backward compatibility", () => {
  it("a pre-FIX-807 spine object (no dcf/triangulation keys) parses with both defaulting to null", () => {
    const spine = buildSpine("NVDA", nvdaStatements, "Technology", nvdaQuantComposites, nvdaFactorRanks, nvdaIndicators);
    // Strip the new keys to simulate a session persisted before this change.
    const { dcf: _dcf, triangulation: _tri, ...legacy } = spine;
    const parsed = valuationSpineStateSchema.parse(legacy);
    expect(parsed.dcf).toBeNull();
    expect(parsed.triangulation).toBeNull();
    // The rest of the spine still round-trips.
    expect(parsed.ticker).toBe("NVDA");
    expect(parsed.envelope.absoluteRating).toBe("Buy");
  });

  it("a current spine round-trips through the schema with the new blocks populated", () => {
    const spine = buildSpine("AAPL", aaplStatements, "Technology", aaplQuantComposites, aaplFactorRanks, aaplIndicators);
    const parsed = valuationSpineStateSchema.parse(spine);
    expect(parsed.dcf?.available).toBe(true);
    expect(parsed.triangulation?.divergence).toBe("divergent");
  });
});
