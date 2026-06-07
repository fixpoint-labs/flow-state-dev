/**
 * Unit tests for the pure options-chain math. These pin the judgment in
 * `get_options_chain`: where the ATM strike is located, how the 25-delta skew is
 * read, the term-structure flat band, and the null-not-zero degrade discipline.
 */
import { describe, expect, it } from "vitest";
import {
  atmIv,
  classifyTermStructure,
  distinctExpiries,
  putCallOiRatio,
  skew25Delta,
  sumField,
  type OptionContract,
} from "../src/flows/analysis/tools/data/options-math";

const c = (over: Partial<OptionContract>): OptionContract => ({
  type: "call",
  strike: 100,
  expiry: "2026-05-15",
  iv: 0.3,
  delta: 0.5,
  openInterest: 100,
  volume: 10,
  ...over,
});

describe("distinctExpiries", () => {
  it("returns unique expiries ascending", () => {
    const out = distinctExpiries([
      c({ expiry: "2026-06-19" }),
      c({ expiry: "2026-05-15" }),
      c({ expiry: "2026-05-15" }),
    ]);
    expect(out).toEqual(["2026-05-15", "2026-06-19"]);
  });
  it("is empty for no contracts", () => {
    expect(distinctExpiries([])).toEqual([]);
  });
});

describe("atmIv", () => {
  it("averages the call and put IV at the strike nearest spot", () => {
    const contracts = [
      c({ type: "call", strike: 100, iv: 0.30 }),
      c({ type: "put", strike: 100, iv: 0.34 }),
      c({ type: "call", strike: 120, iv: 0.50 }), // farther from spot, ignored
    ];
    expect(atmIv(contracts, 101, "2026-05-15")).toBeCloseTo(0.32, 6);
  });
  it("returns null when spot is null", () => {
    expect(atmIv([c({})], null, "2026-05-15")).toBeNull();
  });
  it("returns null when no contract on the expiry has a finite IV", () => {
    expect(atmIv([c({ iv: null })], 100, "2026-05-15")).toBeNull();
  });
});

describe("classifyTermStructure", () => {
  it("classifies a positive slope beyond the deadband as contango", () => {
    expect(classifyTermStructure(0.02, 0.005)).toBe("contango");
  });
  it("classifies a negative slope beyond the deadband as backwardation", () => {
    expect(classifyTermStructure(-0.02, 0.005)).toBe("backwardation");
  });
  it("treats a move inside the deadband as flat", () => {
    expect(classifyTermStructure(0.004, 0.005)).toBe("flat");
  });
  it("returns null when the slope is null (one expiry)", () => {
    expect(classifyTermStructure(null, 0.005)).toBeNull();
  });
});

describe("skew25Delta", () => {
  it("is put IV at -25d minus call IV at +25d, picking the nearest delta", () => {
    const contracts = [
      c({ type: "put", delta: -0.24, iv: 0.40 }),
      c({ type: "put", delta: -0.50, iv: 0.34 }), // farther from -0.25, ignored
      c({ type: "call", delta: 0.26, iv: 0.33 }),
    ];
    expect(skew25Delta(contracts, "2026-05-15")).toBeCloseTo(0.07, 6);
  });
  it("returns null when one wing is missing", () => {
    const contracts = [c({ type: "put", delta: -0.25, iv: 0.4 })]; // no call
    expect(skew25Delta(contracts, "2026-05-15")).toBeNull();
  });
});

describe("putCallOiRatio", () => {
  it("divides total put OI by total call OI", () => {
    const contracts = [
      c({ type: "call", openInterest: 200 }),
      c({ type: "put", openInterest: 100 }),
      c({ type: "put", openInterest: 60 }),
    ];
    expect(putCallOiRatio(contracts)).toBeCloseTo(0.8, 6);
  });
  it("returns null when there is no call open interest to divide by", () => {
    expect(putCallOiRatio([c({ type: "put", openInterest: 50 })])).toBeNull();
  });
});

describe("sumField", () => {
  it("sums a present field", () => {
    expect(sumField([c({ openInterest: 10 }), c({ openInterest: 5 })], "openInterest")).toBe(15);
  });
  it("returns null when no contract carries the field", () => {
    expect(sumField([c({ volume: null })], "volume")).toBeNull();
  });
});
