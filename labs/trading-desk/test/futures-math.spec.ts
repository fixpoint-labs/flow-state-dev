/**
 * Unit tests for the pure futures-curve math: the session-change and
 * front-vs-next spread arithmetic, the contango/backwardation flat band, and the
 * composite equity-vs-gold risk tone — including the null-not-zero degrade.
 */
import { describe, expect, it } from "vitest";
import {
  changePct,
  classifyTermStructure,
  frontNextSpreadPct,
  riskTone,
  type RiskToneLeg,
} from "../flows/analysis/tools/data/futures-math";

describe("changePct", () => {
  it("computes the fractional session change", () => {
    expect(changePct(102, 100)).toBeCloseTo(0.02, 6);
  });
  it("returns null when a price is missing", () => {
    expect(changePct(null, 100)).toBeNull();
    expect(changePct(102, null)).toBeNull();
  });
  it("returns null when the prior close is non-positive", () => {
    expect(changePct(102, 0)).toBeNull();
  });
});

describe("frontNextSpreadPct", () => {
  it("is (next - front) / front", () => {
    expect(frontNextSpreadPct(100, 101)).toBeCloseTo(0.01, 6);
  });
  it("returns null when the next price is missing", () => {
    expect(frontNextSpreadPct(100, null)).toBeNull();
  });
});

describe("classifyTermStructure", () => {
  it("classifies a deferred-richer spread as contango", () => {
    expect(classifyTermStructure(0.01, 0.001)).toBe("contango");
  });
  it("classifies a deferred-cheaper spread as backwardation", () => {
    expect(classifyTermStructure(-0.01, 0.001)).toBe("backwardation");
  });
  it("treats a spread inside the deadband as flat", () => {
    expect(classifyTermStructure(0.0005, 0.001)).toBe("flat");
  });
  it("returns null when the spread is null", () => {
    expect(classifyTermStructure(null, 0.001)).toBeNull();
  });
});

describe("riskTone", () => {
  const leg = (assetClass: RiskToneLeg["assetClass"], changePct: number | null): RiskToneLeg => ({
    assetClass,
    changePct,
  });

  it("reads equity up + gold down as risk-on", () => {
    const out = riskTone([leg("equity-index", 0.01), leg("metal", -0.01)], 0.002);
    expect(out).toBe("risk-on");
  });
  it("reads equity down + gold up as risk-off", () => {
    const out = riskTone([leg("equity-index", -0.01), leg("metal", 0.01)], 0.002);
    expect(out).toBe("risk-off");
  });
  it("reads a small net move as neutral", () => {
    const out = riskTone([leg("equity-index", 0.001), leg("metal", 0.0005)], 0.002);
    expect(out).toBe("neutral");
  });
  it("returns null when neither equity-index nor metal legs priced", () => {
    expect(riskTone([leg("energy", 0.05), leg("rates", null)], 0.002)).toBeNull();
  });
});
