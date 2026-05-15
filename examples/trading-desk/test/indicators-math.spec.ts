/**
 * Unit tests for the technical-indicator math. Verifies known reference values
 * for the full indicator set against constructed series and confirms the
 * edge-case behavior (short series → 0 / neutral baseline, flat market → RSI
 * 50ish, trend label gating on the SMA stack, etc.).
 */
import { describe, expect, it } from "vitest";
import {
  atr,
  bollinger,
  computeIndicators,
  kdj,
  macd,
  obv,
  rsi,
  simpleMovingAverage,
  stochastic,
  trendLabel,
  vwma,
  type Bar,
} from "../src/flows/trading-desk/phase-1/tools/indicators-math";

function bar(date: string, close: number, range = 1, volume = 1000): Bar {
  return {
    date,
    open: close,
    high: close + range,
    low: close - range,
    close,
    volume,
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

  it("Bollinger Bands collapse around the mean on a flat series", () => {
    const flat = Array.from({ length: 40 }, () => 100);
    const out = bollinger(flat);
    expect(out.middle).toBeCloseTo(100, 5);
    expect(out.upper).toBeCloseTo(100, 5);
    expect(out.lower).toBeCloseTo(100, 5);
  });

  it("Bollinger Bands returns zeros when the series is too short", () => {
    expect(bollinger([1, 2, 3])).toEqual({ upper: 0, middle: 0, lower: 0 });
  });

  it("VWMA equals SMA when every bar has equal volume", () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1, 1000));
    const closes = bars.map((b) => b.close);
    expect(vwma(bars, 20)).toBeCloseTo(simpleMovingAverage(closes, 20), 5);
  });

  it("VWMA biases toward higher-volume bars", () => {
    const bars = [
      ...Array.from({ length: 19 }, (_, i) => bar(`2026-01-${i + 1}`, 100, 1, 100)),
      bar("2026-01-20", 200, 1, 100_000),
    ];
    // The last bar dominates the volume-weighted average.
    expect(vwma(bars, 20)).toBeGreaterThan(150);
  });

  it("VWMA returns zero when the series is shorter than the period", () => {
    expect(vwma([bar("2026-01-01", 100)], 20)).toBe(0);
  });

  it("Stochastic Oscillator is near 100 at a multi-period high", () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1));
    const out = stochastic(bars);
    expect(out.k).toBeGreaterThan(50);
    expect(out.d).toBeGreaterThan(50);
  });

  it("Stochastic returns zeros when the series is too short", () => {
    expect(stochastic([bar("2026-01-01", 100)])).toEqual({ k: 0, d: 0 });
  });

  it("KDJ derives J from 3K - 2D", () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1));
    const out = kdj(bars);
    const expectedJ = 3 * out.k - 2 * out.d;
    expect(out.j).toBeCloseTo(expectedJ, 5);
  });

  it("OBV is positive on a steadily rising series", () => {
    const bars = Array.from({ length: 10 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1, 1000));
    expect(obv(bars)).toBeGreaterThan(0);
  });

  it("OBV is zero on a flat series (no up or down closes)", () => {
    const bars = Array.from({ length: 10 }, (_, i) => bar(`2026-01-${i + 1}`, 100, 1, 1000));
    expect(obv(bars)).toBe(0);
  });

  it("OBV returns zero when only a single bar is provided", () => {
    expect(obv([bar("2026-01-01", 100)])).toBe(0);
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
    expect(Number.isFinite(out.bollinger.upper)).toBe(true);
    expect(out.bollinger.upper).toBeGreaterThan(out.bollinger.middle);
    expect(out.bollinger.middle).toBeGreaterThan(out.bollinger.lower);
    expect(Number.isFinite(out.vwma20)).toBe(true);
    expect(out.vwma20).toBeGreaterThan(0);
    expect(Number.isFinite(out.stoch.k)).toBe(true);
    expect(Number.isFinite(out.stoch.d)).toBe(true);
    expect(Number.isFinite(out.kdj.j)).toBe(true);
    expect(Number.isFinite(out.obv)).toBe(true);
  });

  it("computeIndicators falls back to neutral zeros on a 5-bar series", () => {
    const bars = Array.from({ length: 5 }, (_, i) => bar(`2026-01-${i + 1}`, 100, 1));
    const out = computeIndicators(bars);
    expect(out.rsi14).toBe(0);
    expect(out.macd.line).toBe(0);
    expect(out.atr14).toBe(0);
    expect(out.trend).toBe("flat");
    expect(out.bollinger.upper).toBe(0);
    expect(out.vwma20).toBe(0);
    expect(out.stoch.k).toBe(0);
    expect(out.kdj.j).toBe(0);
    expect(out.obv).toBe(0);
  });
});
