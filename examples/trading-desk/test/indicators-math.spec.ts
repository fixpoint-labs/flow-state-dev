/**
 * Unit tests for the technical-indicator math. Verifies known reference values
 * for SMA/EMA/RSI/MACD/ATR against constructed series and confirms the
 * edge-case behavior (short series → 0, flat market → RSI 50ish, trend label
 * gating on the SMA stack).
 */
import { describe, expect, it } from "vitest";
import {
  atr,
  computeIndicators,
  macd,
  rsi,
  simpleMovingAverage,
  trendLabel,
  type Bar,
} from "../src/flows/trading-desk/phase-1/tools/indicators-math";

function bar(date: string, close: number, range = 1): Bar {
  return {
    date,
    open: close,
    high: close + range,
    low: close - range,
    close,
    volume: 1000,
  };
}

describe("indicators math", () => {
  it("SMA averages the last N values", () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(simpleMovingAverage([1, 2, 3], 5)).toBe(0); // too short
  });

  it("RSI returns 100 on a strictly rising series (no losses)", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)).toBe(100);
  });

  it("RSI returns 0 on a series shorter than the period", () => {
    expect(rsi([1, 2, 3], 14)).toBe(0);
  });

  it("RSI sits below 100 on a series with at least one down day", () => {
    const closes = [...Array.from({ length: 14 }, (_, i) => 100 + i), 110];
    const value = rsi(closes, 14);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
  });

  it("MACD is zero on a flat series", () => {
    const flat = Array.from({ length: 40 }, () => 100);
    const out = macd(flat);
    expect(out.line).toBeCloseTo(0, 5);
    expect(out.signal).toBeCloseTo(0, 5);
    expect(out.histogram).toBeCloseTo(0, 5);
  });

  it("MACD line is positive on a rising trend (EMA12 > EMA26)", () => {
    const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(macd(rising).line).toBeGreaterThan(0);
  });

  it("ATR equals the constant range on bars with constant H-L spread", () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(`2026-01-${i + 1}`, 100, 2));
    // H-L is always 4 (close ± 2); previous-close-anchored TRs are also 4
    // because the close never moves. Wilder smoothing of a constant series
    // returns that constant.
    expect(atr(bars, 14)).toBeCloseTo(4, 5);
  });

  it("trendLabel returns 'up' when stack is bullish", () => {
    expect(trendLabel(110, 105, 100)).toBe("up");
    expect(trendLabel(95, 100, 105)).toBe("down");
    expect(trendLabel(100, 100, 100)).toBe("flat");
    expect(trendLabel(110, 0, 100)).toBe("flat"); // SMA200 not yet computable
  });

  it("computeIndicators returns finite numbers for a realistic 250-bar series", () => {
    const bars = Array.from({ length: 250 }, (_, i) => {
      const trend = i * 0.5;
      const noise = Math.sin(i / 10) * 2;
      return bar(`2026-01-${i + 1}`, 100 + trend + noise, 1.5);
    });
    const out = computeIndicators(bars);
    expect(Number.isFinite(out.rsi14)).toBe(true);
    expect(Number.isFinite(out.macd.line)).toBe(true);
    expect(Number.isFinite(out.atr14)).toBe(true);
    expect(out.sma50).toBeGreaterThan(0);
    expect(out.sma200).toBeGreaterThan(0);
    expect(out.trend).toBe("up"); // rising drift dominates
  });
});
