/**
 * Tests for the pure cross-asset-flow math.
 *
 * These functions turn raw trailing-return spreads into a risk-on/off reading
 * and a financial-conditions trend. The only real nuance is the deadband: a
 * spread inside ±deadband reads "neutral", not a directional lean — so the
 * tests pin the boundary behaviour, not just the obvious cases.
 */
import { describe, expect, it } from "vitest";
import {
  classifyLeaning,
  riskAppetite,
  trend3,
} from "../src/flows/trading-desk/phase-1/tools/cross-asset-math";

describe("classifyLeaning", () => {
  it("reads a spread above the deadband as risk-on", () => {
    expect(classifyLeaning(0.03, 0.005)).toBe("risk-on");
  });

  it("reads a spread below the negative deadband as risk-off", () => {
    expect(classifyLeaning(-0.03, 0.005)).toBe("risk-off");
  });

  it("reads a spread inside the deadband as neutral", () => {
    expect(classifyLeaning(0.002, 0.005)).toBe("neutral");
    expect(classifyLeaning(-0.002, 0.005)).toBe("neutral");
  });

  it("cannot classify a null spread", () => {
    expect(classifyLeaning(null, 0.005)).toBeNull();
  });
});

describe("riskAppetite", () => {
  it("averages the resolved spreads and classifies the composite", () => {
    const result = riskAppetite([0.04, 0.02, 0.06], 0.005);
    expect(result?.score).toBeCloseTo(0.04, 5);
    expect(result?.appetite).toBe("risk-on");
  });

  it("ignores null spreads when averaging", () => {
    const result = riskAppetite([0.04, null, null], 0.005);
    expect(result?.score).toBeCloseTo(0.04, 5);
    expect(result?.appetite).toBe("risk-on");
  });

  it("classifies a small mixed average as neutral", () => {
    const result = riskAppetite([0.01, -0.012], 0.005);
    expect(result?.appetite).toBe("neutral");
  });

  it("returns null when no spread resolved", () => {
    expect(riskAppetite([null, null], 0.005)).toBeNull();
    expect(riskAppetite([], 0.005)).toBeNull();
  });
});

describe("trend3", () => {
  it("reads a rise beyond the deadband as rising", () => {
    expect(trend3(0.5, 0.2, 0.05)).toBe("rising");
  });

  it("reads a fall beyond the deadband as falling", () => {
    expect(trend3(0.2, 0.5, 0.05)).toBe("falling");
  });

  it("reads a change inside the deadband as flat", () => {
    expect(trend3(0.51, 0.5, 0.05)).toBe("flat");
  });

  it("returns null when either endpoint is missing", () => {
    expect(trend3(null, 0.5, 0.05)).toBeNull();
    expect(trend3(0.5, null, 0.05)).toBeNull();
  });
});
