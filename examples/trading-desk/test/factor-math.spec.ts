import { describe, expect, it } from "vitest";
import {
  momentum12m1,
  earningsYield,
  bookToPrice,
  fcfYield,
  grossProfitsToAssets,
  accruals,
  logMarketCap,
  crossSectionalPercentile,
  crossSectionalZScore,
  crossSectionalRank,
  gatedZScore,
  MIN_Z_CROSS_SECTION,
} from "../src/flows/trading-desk/phase-1/tools/factor-math";

describe("factor-math — small-sample reframe (ordinal rank + gated z)", () => {
  describe("crossSectionalRank", () => {
    it("ranks the highest value 1 and the lowest value N", () => {
      const vals = [10, 30, 20, 50, 40];
      expect(crossSectionalRank(50, vals)).toEqual({ rank: 1, outOf: 5 });
      expect(crossSectionalRank(10, vals)).toEqual({ rank: 5, outOf: 5 });
      expect(crossSectionalRank(30, vals)).toEqual({ rank: 3, outOf: 5 });
    });

    it("reports outOf as the count actually ranked (not the nominal peer count)", () => {
      // Only 3 names had a value for this factor → 'rank of 3', honest at any n.
      expect(crossSectionalRank(5, [5, 1, 9])).toEqual({ rank: 2, outOf: 3 });
    });
  });

  describe("gatedZScore", () => {
    it("omits the z-score for a small peer set (the n~7 case)", () => {
      const seven = [1, 2, 3, 4, 5, 6, 7];
      expect(gatedZScore(7, seven)).toBeNull();
      expect(seven.length).toBeLessThan(MIN_Z_CROSS_SECTION);
    });

    it("reports a z-score once the cross-section is large enough", () => {
      const big = Array.from({ length: MIN_Z_CROSS_SECTION }, (_, i) => i);
      const z = gatedZScore(big[big.length - 1], big);
      expect(z).not.toBeNull();
      expect(z!).toBeGreaterThan(0);
    });
  });
});

describe("factor-math", () => {
  describe("momentum12m1", () => {
    it("returns null for fewer than 252 bars", () => {
      expect(momentum12m1(Array(251).fill(100))).toBeNull();
    });

    it("computes 12-1 skip-month momentum correctly", () => {
      // 252 bars: first bar = 100, bar at index 230 (length-22) = 120
      const closes = Array(252).fill(100);
      closes[230] = 120; // This is closes[length - 22] = closes[230]
      const result = momentum12m1(closes);
      // (120 / 100) - 1 = 0.2
      expect(result).toBeCloseTo(0.2);
    });

    it("returns null when year-ago price is zero", () => {
      const closes = Array(252).fill(100);
      closes[0] = 0;
      expect(momentum12m1(closes)).toBeNull();
    });
  });

  describe("earningsYield", () => {
    it("computes NI / market cap", () => {
      expect(earningsYield(10, 200)).toBeCloseTo(0.05);
    });
    it("returns null on zero market cap", () => {
      expect(earningsYield(10, 0)).toBeNull();
    });
    it("returns null on null inputs", () => {
      expect(earningsYield(null, 200)).toBeNull();
    });
  });

  describe("bookToPrice", () => {
    it("computes book / market cap", () => {
      expect(bookToPrice(50, 200)).toBeCloseTo(0.25);
    });
  });

  describe("fcfYield", () => {
    it("computes (CFO + capex) / market cap", () => {
      // capex is negative from Yahoo: -10
      expect(fcfYield(30, -10, 200)).toBeCloseTo(0.1);
    });
  });

  describe("grossProfitsToAssets", () => {
    it("computes (revenue − COGS) / totalAssets", () => {
      expect(grossProfitsToAssets(100, 60, 500)).toBeCloseTo(0.08);
    });
    it("uses revenue when COGS is null", () => {
      expect(grossProfitsToAssets(100, null, 500)).toBeCloseTo(0.2);
    });
  });

  describe("accruals", () => {
    it("computes (NI − CFO) / totalAssets", () => {
      expect(accruals(20, 30, 500)).toBeCloseTo(-0.02);
    });
  });

  describe("logMarketCap", () => {
    it("returns log of market cap", () => {
      expect(logMarketCap(1000)).toBeCloseTo(Math.log(1000));
    });
    it("returns null for zero or negative", () => {
      expect(logMarketCap(0)).toBeNull();
      expect(logMarketCap(-5)).toBeNull();
    });
  });

  describe("crossSectionalPercentile", () => {
    it("returns 50 for single-element set", () => {
      expect(crossSectionalPercentile(5, [5])).toBe(50);
    });

    it("computes percentile in a 7-element set", () => {
      const values = [10, 20, 30, 40, 50, 60, 70];
      // 70 is the highest → 6 values below → 6/(7-1)*100 = 100
      expect(crossSectionalPercentile(70, values)).toBe(100);
      // 10 is the lowest → 0 values below → 0
      expect(crossSectionalPercentile(10, values)).toBe(0);
      // 40 → 3 below → 3/6*100 = 50
      expect(crossSectionalPercentile(40, values)).toBe(50);
    });
  });

  describe("crossSectionalZScore", () => {
    it("returns null for fewer than 2 values", () => {
      expect(crossSectionalZScore(5, [5])).toBeNull();
    });

    it("computes z-score correctly", () => {
      const values = [10, 20, 30, 40, 50];
      const mean = 30;
      const std = Math.sqrt(((20**2 + 10**2 + 0 + 10**2 + 20**2) / 4));
      const expected = (50 - mean) / std;
      expect(crossSectionalZScore(50, values)).toBeCloseTo(expected);
    });

    it("returns null when std is zero", () => {
      expect(crossSectionalZScore(5, [5, 5, 5])).toBeNull();
    });
  });
});
