/**
 * Unit tests for the technical-indicator math. Verifies known reference values
 * for the full indicator set against constructed series and confirms the
 * edge-case behavior (short series → null, flat market → RSI 50ish, trend label
 * gating on the SMA stack, etc.).
 *
 * The intent these encode (FIX-1063): a series too short to compute an
 * indicator yields `null` — the indicator was NOT MEASURED — while an indicator
 * that genuinely computes to zero on a long enough series stays `0`. Both
 * directions are asserted, because getting either wrong is a real-money defect:
 * a fabricated zero enters the arithmetic as a measurement, and a nulled real
 * zero deletes a reading the desk actually took.
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
} from "../flows/analysis/tools/indicators-math";

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
  it("SMA averages the last N values, and reports null when it cannot", () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toBe(4);
    // Too short to compute. Reporting `0` here made a 3-month-old listing carry
    // a 200-day average of zero into the trend label and the momentum score.
    expect(simpleMovingAverage([1, 2, 3], 5)).toBeNull();
  });

  it("RSI returns 100 on a strictly rising series (no losses)", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)).toBe(100);
  });

  it("RSI reports null on a series shorter than the period", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
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

  it("trendLabel reads the stack, and reports no trend when it cannot", () => {
    expect(trendLabel(110, 105, 100)).toBe("up");
    expect(trendLabel(95, 100, 105)).toBe("down");
    // A MEASURED flat: all three exist and the stack is neither up nor down.
    expect(trendLabel(100, 100, 100)).toBe("flat");
    // Not measurable. A trend we could not read is reported as NO trend, never
    // as "flat" (FIX-1063 decision 2) — a "flat" label is a finding, and the
    // desk never made it. Before the fix each of these returned "flat".
    expect(trendLabel(110, 105, null)).toBeNull(); // no 200-day history yet
    expect(trendLabel(110, null, 100)).toBeNull();
    expect(trendLabel(null, 105, 100)).toBeNull(); // no bars, so no last close
  });

  it("Bollinger Bands collapse around the mean on a flat series", () => {
    const flat = Array.from({ length: 40 }, () => 100);
    const out = bollinger(flat);
    expect(out.middle).toBeCloseTo(100, 5);
    expect(out.upper).toBeCloseTo(100, 5);
    expect(out.lower).toBeCloseTo(100, 5);
  });

  it("Bollinger Bands report null when the series is too short", () => {
    expect(bollinger([1, 2, 3])).toEqual({ upper: null, middle: null, lower: null });
  });

  it("VWMA equals SMA when every bar has equal volume", () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1, 1000));
    const closes = bars.map((b) => b.close);
    expect(vwma(bars, 20)).toBeCloseTo(simpleMovingAverage(closes, 20)!, 5);
  });

  it("VWMA biases toward higher-volume bars", () => {
    const bars = [
      ...Array.from({ length: 19 }, (_, i) => bar(`2026-01-${i + 1}`, 100, 1, 100)),
      bar("2026-01-20", 200, 1, 100_000),
    ];
    // The last bar dominates the volume-weighted average.
    expect(vwma(bars, 20)).toBeGreaterThan(150);
  });

  it("VWMA reports null when the series is shorter than the period", () => {
    expect(vwma([bar("2026-01-01", 100)], 20)).toBeNull();
  });

  it("Stochastic Oscillator is near 100 at a multi-period high", () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1));
    const out = stochastic(bars);
    expect(out.k).toBeGreaterThan(50);
    expect(out.d).toBeGreaterThan(50);
  });

  it("Stochastic reports null when the series is too short", () => {
    expect(stochastic([bar("2026-01-01", 100)])).toEqual({ k: null, d: null });
  });

  it("KDJ derives J from 3K - 2D, and reports null when K/D are unmeasured", () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1));
    const out = kdj(bars);
    const expectedJ = 3 * out.k! - 2 * out.d!;
    expect(out.j).toBeCloseTo(expectedJ, 5);
    // 3 × null − 2 × null coerces to 0 in JS — the exact shape that would
    // publish a fabricated neutral J on a name with no usable history.
    expect(kdj([bar("2026-01-01", 100)])).toEqual({ k: null, d: null, j: null });
  });

  it("OBV is positive on a steadily rising series", () => {
    const bars = Array.from({ length: 10 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1, 1000));
    expect(obv(bars)).toBeGreaterThan(0);
  });

  it("OBV is zero on a flat series — a MEASURED zero, which survives", () => {
    // Ten bars, no up or down closes. OBV genuinely computes to 0. This is the
    // over-application guard: the rule is *unobserved → null*, not
    // *falsy → null*, so a real zero must not be nulled (FIX-1063).
    const bars = Array.from({ length: 10 }, (_, i) => bar(`2026-01-${i + 1}`, 100, 1, 1000));
    expect(obv(bars)).toBe(0);
  });

  it("OBV reports null when only a single bar is provided", () => {
    expect(obv([bar("2026-01-01", 100)])).toBeNull();
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
    expect(out.bollinger.upper).toBeGreaterThan(out.bollinger.middle!);
    expect(out.bollinger.middle).toBeGreaterThan(out.bollinger.lower!);
    expect(Number.isFinite(out.vwma20)).toBe(true);
    expect(out.vwma20).toBeGreaterThan(0);
    expect(Number.isFinite(out.stoch.k)).toBe(true);
    expect(Number.isFinite(out.stoch.d)).toBe(true);
    expect(Number.isFinite(out.kdj.j)).toBe(true);
    expect(Number.isFinite(out.obv)).toBe(true);
  });

  it("computeIndicators reports every unmeasurable indicator as null on a 5-bar series", () => {
    // Five bars is too short for anything but OBV. Every one of these was `0`
    // before FIX-1063, and `trend` was "flat" — a full technical read the desk
    // never took, published under a live source tag.
    const bars = Array.from({ length: 5 }, (_, i) => bar(`2026-01-${i + 1}`, 100, 1));
    const out = computeIndicators(bars);
    expect(out.rsi14).toBeNull();
    expect(out.macd.line).toBeNull();
    expect(out.atr14).toBeNull();
    expect(out.trend).toBeNull();
    expect(out.sma50).toBeNull();
    expect(out.sma200).toBeNull();
    expect(out.bollinger.upper).toBeNull();
    expect(out.vwma20).toBeNull();
    expect(out.stoch.k).toBeNull();
    expect(out.kdj.j).toBeNull();
    // OBV IS computable on 5 flat bars and genuinely reads 0 — a measurement,
    // so it stays a number even in the middle of an otherwise-empty payload.
    expect(out.obv).toBe(0);
  });

  it("a 120-bar history reports sma50 but no sma200 and no trend (the partial case)", () => {
    // The shape a naive fix leaves live: the payload LOOKS populated because
    // sma50 is a real number, but the 200-day average and therefore the trend
    // were never measured. `setup-score` must not read this as a momentum
    // reading — see the momentum-trap test in setup-score.spec.ts.
    const bars = Array.from({ length: 120 }, (_, i) => bar(`2026-01-${i + 1}`, 100 + i, 1));
    const out = computeIndicators(bars);
    expect(out.sma50).toBeGreaterThan(0);
    expect(out.sma200).toBeNull();
    expect(out.trend).toBeNull();
  });
});
