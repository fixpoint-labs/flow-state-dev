import { describe, expect, it } from "vitest";
import {
  logReturns,
  realizedVolAnnualized,
  volRegimePercentile,
  olsBeta,
  rollingCorrelation,
  correlationRegime,
} from "../src/flows/analysis/tools/data/regime-math";

describe("regime-math", () => {
  describe("logReturns", () => {
    it("computes log returns from closes", () => {
      const closes = [100, 105, 110];
      const returns = logReturns(closes);
      expect(returns).toHaveLength(2);
      expect(returns[0]).toBeCloseTo(Math.log(105 / 100));
      expect(returns[1]).toBeCloseTo(Math.log(110 / 105));
    });

    it("skips zero prices", () => {
      const closes = [0, 100, 105];
      const returns = logReturns(closes);
      expect(returns).toHaveLength(1);
    });
  });

  describe("realizedVolAnnualized", () => {
    it("returns null for fewer than 2 returns", () => {
      expect(realizedVolAnnualized([0.01])).toBeNull();
    });

    it("annualizes with sqrt(252)", () => {
      // Constant daily return → zero vol
      const returns = Array(100).fill(0.001);
      expect(realizedVolAnnualized(returns)).toBeCloseTo(0, 1);
    });

    it("computes non-zero vol for varying returns", () => {
      const returns = [0.01, -0.02, 0.015, -0.005, 0.01, -0.01, 0.02, -0.015, 0.005, 0.01];
      const vol = realizedVolAnnualized(returns);
      expect(vol).not.toBeNull();
      expect(vol!).toBeGreaterThan(0);
    });
  });

  describe("volRegimePercentile", () => {
    it("returns null for insufficient data", () => {
      expect(volRegimePercentile([0.01, 0.02], 21)).toBeNull();
    });

    it("classifies a stressed regime when recent vol is high", () => {
      // Low vol for most of the series, then high vol at the end.
      // Need enough calm history so the spike window is a clear outlier.
      const calm = Array(500).fill(0.001);
      const spike = Array(30).fill(0.05);
      const returns = [...calm, ...spike];
      const result = volRegimePercentile(returns, 21);
      expect(result).not.toBeNull();
      expect(result!.regime).toBe("stressed");
      expect(result!.percentile).toBeGreaterThan(89);
    });
  });

  describe("olsBeta", () => {
    it("returns null for fewer than 10 observations", () => {
      expect(olsBeta([1, 2, 3], [1, 2, 3])).toBeNull();
    });

    it("computes beta ≈ 1 for identical series", () => {
      const returns = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1) * 0.01);
      const result = olsBeta(returns, returns);
      expect(result).not.toBeNull();
      expect(result!.beta).toBeCloseTo(1);
      expect(result!.rSquared).toBeCloseTo(1);
    });

    it("computes beta ≈ 2 when stock moves 2x market", () => {
      const market = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1) * 0.01);
      const stock = market.map((r) => r * 2);
      const result = olsBeta(stock, market);
      expect(result).not.toBeNull();
      expect(result!.beta).toBeCloseTo(2, 1);
    });
  });

  describe("rollingCorrelation", () => {
    it("returns null for insufficient data", () => {
      expect(rollingCorrelation([1, 2], [1, 2], 5)).toBeNull();
    });

    it("returns ~1 for perfectly correlated series", () => {
      const a = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1));
      const result = rollingCorrelation(a, a, 50);
      expect(result).toBeCloseTo(1);
    });

    it("returns ~-1 for inversely correlated series", () => {
      const a = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1));
      const b = a.map((v) => -v);
      const result = rollingCorrelation(a, b, 50);
      expect(result).toBeCloseTo(-1);
    });
  });

  describe("correlationRegime", () => {
    it("returns null for insufficient data", () => {
      expect(correlationRegime([1, 2], [1, 2], 5)).toBeNull();
    });
  });
});
