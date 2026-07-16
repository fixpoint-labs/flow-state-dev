import { describe, expect, it } from "vitest";
import {
  altmanZDoublePrime,
  piotroskiFScore,
  type StatementPeriod,
} from "../flows/analysis/tools/data/composite-math";

const fullPeriod: StatementPeriod = {
  totalAssets: 1000,
  totalCurrentAssets: 400,
  totalCurrentLiabilities: 200,
  totalLiabilities: 500,
  retainedEarnings: 300,
  totalEquity: 500,
  totalRevenue: 800,
  costOfRevenue: 500,
  grossProfit: 300,
  operatingIncome: 150,
  netIncome: 100,
  cfo: 120,
  capitalExpenditures: -50,
  sharesOutstanding: 1000000,
};

describe("composite-math", () => {
  describe("altmanZDoublePrime", () => {
    it("computes Z'' for a full statement period", () => {
      const result = altmanZDoublePrime(fullPeriod);
      expect(result).not.toBeNull();
      // X1 = (400 - 200) / 1000 = 0.2
      // X2 = 300 / 1000 = 0.3
      // X3 = 150 / 1000 = 0.15
      // X4 = 500 / 500 = 1.0
      // Z'' = 6.56*0.2 + 3.26*0.3 + 6.72*0.15 + 1.05*1.0
      //     = 1.312 + 0.978 + 1.008 + 1.05 = 4.348
      expect(result!.score).toBeCloseTo(4.35, 1);
      expect(result!.zone).toBe("safe");
    });

    it("returns null when totalAssets is null", () => {
      expect(altmanZDoublePrime({ ...fullPeriod, totalAssets: null })).toBeNull();
    });

    it("returns null when totalLiabilities is null", () => {
      expect(altmanZDoublePrime({ ...fullPeriod, totalLiabilities: null })).toBeNull();
    });

    it("handles missing retainedEarnings (partial)", () => {
      const result = altmanZDoublePrime({ ...fullPeriod, retainedEarnings: null });
      expect(result).not.toBeNull();
      expect(result!.missingInputs).toContain("retainedEarnings");
      // X2 contribution is 0; score is lower
      expect(result!.score).toBeLessThan(4.35);
    });

    it("classifies distress zone", () => {
      const distressed: StatementPeriod = {
        ...fullPeriod,
        totalCurrentAssets: 50,
        totalCurrentLiabilities: 400,
        retainedEarnings: -200,
        operatingIncome: -50,
        totalEquity: 100,
        totalLiabilities: 900,
      };
      const result = altmanZDoublePrime(distressed);
      expect(result).not.toBeNull();
      expect(result!.zone).toBe("distress");
    });
  });

  describe("piotroskiFScore", () => {
    it("scores a healthy company with full data", () => {
      const prior: StatementPeriod = {
        ...fullPeriod,
        netIncome: 80,
        totalLiabilities: 550,
        totalCurrentAssets: 350,
        totalCurrentLiabilities: 250,
        totalRevenue: 750,
        costOfRevenue: 500,
        grossProfit: 250,
      };
      const result = piotroskiFScore(fullPeriod, prior);
      expect(result.score).toBeGreaterThan(0);
      expect(result.computable).toBeGreaterThan(0);
      expect(result.breakdown).toHaveLength(9);
    });

    it("marks criteria null when prior is null", () => {
      const result = piotroskiFScore(fullPeriod, null);
      const nullCriteria = result.breakdown.filter((c) => c.passed === null);
      // Change-based criteria (3,5,6,7,8,9) should be null without prior
      expect(nullCriteria.length).toBeGreaterThanOrEqual(5);
    });

    it("handles ROA > 0 correctly", () => {
      const result = piotroskiFScore(fullPeriod, null);
      const roaCriterion = result.breakdown.find((c) => c.criterion === "ROA > 0");
      expect(roaCriterion).toBeDefined();
      expect(roaCriterion!.passed).toBe(true); // NI=100, TA=1000 → ROA=0.1 > 0
    });

    it("handles CFO > 0 correctly", () => {
      const result = piotroskiFScore(fullPeriod, null);
      const cfoCriterion = result.breakdown.find((c) => c.criterion === "CFO > 0");
      expect(cfoCriterion!.passed).toBe(true); // CFO=120 > 0
    });

    it("handles negative ROA", () => {
      const negative = { ...fullPeriod, netIncome: -50 };
      const result = piotroskiFScore(negative, null);
      const roaCriterion = result.breakdown.find((c) => c.criterion === "ROA > 0");
      expect(roaCriterion!.passed).toBe(false);
    });
  });
});
