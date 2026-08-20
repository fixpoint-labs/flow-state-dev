/**
 * Pure-function technical-indicator math. Consumed by the `compute_indicators`
 * tool handler when running in live mode — indicators aren't *fetched*, they're
 * derived from OHLC bars, so they belong outside the data-source layer.
 *
 * Wraps the `trading-signals` library (MIT) for the standard set, plus a
 * hand-rolled VWMA and a KDJ derived from the Stochastic Oscillator's K/D.
 *
 * All routines accept the canonical `bars` shape from `get_price_history` and
 * return a finite number or `null`. When the input series is too short to
 * compute a given indicator the routine returns `null` — the indicator was not
 * measured (FIX-1063). It previously returned `0`, which a stock with three
 * months of history turned into a 200-day average of zero and, through
 * `trendLabel`, into a "flat" trend the desk never read. `null` reaches the
 * analyst prompts as `null`, which they already handle as missing signal.
 *
 * `trailingReturn` is a simpler helper used by sector/peer tools to compute
 * period returns from daily close arrays.
 */
import {
  ATR,
  BollingerBands,
  EMA,
  MACD,
  OBV,
  RSI,
  SMA,
  StochasticOscillator,
} from "trading-signals";

export type Bar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IndicatorOutput = {
  rsi14: number | null;
  macd: { line: number | null; signal: number | null; histogram: number | null };
  atr14: number | null;
  trend: "up" | "down" | "flat" | null;
  sma50: number | null;
  sma200: number | null;
  bollinger: { upper: number | null; middle: number | null; lower: number | null };
  vwma20: number | null;
  stoch: { k: number | null; d: number | null };
  kdj: { k: number | null; d: number | null; j: number | null };
  obv: number | null;
};

/**
 * Coerces non-finite numbers (NaN, ±Infinity) to `null`. `trading-signals`
 * returns finite numbers under normal use, but defensive coercion keeps the
 * schema contract honest if a future upstream change ever leaks NaN through.
 * `null` rather than `0` on the same reasoning as the short-history returns: a
 * value the math could not produce is unobserved, not zero (FIX-1063).
 */
function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Last value of a running indicator that consumes one input per bar. `null`
 *  when the indicator never emitted one. */
function lastResult<I>(
  indicator: { add: (input: I) => unknown },
  inputs: readonly I[],
): number | null {
  let last: number | null = null;
  for (const input of inputs) {
    const out = indicator.add(input);
    if (typeof out === "number") last = out;
  }
  return finite(last);
}

export function simpleMovingAverage(
  values: ReadonlyArray<number>,
  period: number,
): number | null {
  if (values.length < period) return null;
  return lastResult(new SMA(period), values);
}

/**
 * Volume-weighted moving average over `period` bars. Hand-rolled because
 * `trading-signals` ships VWAP (typical price × volume, cumulative) but not
 * a fixed-window VWMA. Returns `null` if fewer than `period` bars or if the
 * window has zero total volume (nothing traded — no volume-weighted price
 * exists to report).
 */
export function vwma(bars: ReadonlyArray<Bar>, period: number): number | null {
  if (bars.length < period) return null;
  const window = bars.slice(bars.length - period);
  let numerator = 0;
  let denominator = 0;
  for (const b of window) {
    numerator += b.close * b.volume;
    denominator += b.volume;
  }
  return denominator === 0 ? null : finite(numerator / denominator);
}

/** Wilder's RSI over `period` (default 14). */
export function rsi(closes: ReadonlyArray<number>, period = 14): number | null {
  if (closes.length <= period) return null;
  return lastResult(new RSI(period), closes);
}

/**
 * MACD with the conventional 12/26/9 parameters. Line is EMA12 - EMA26;
 * signal is EMA9 of that line; histogram is line - signal.
 */
export function macd(closes: ReadonlyArray<number>): {
  line: number | null;
  signal: number | null;
  histogram: number | null;
} {
  const unmeasured = { line: null, signal: null, histogram: null };
  if (closes.length < 35) return unmeasured;
  const ind = new MACD(new EMA(12), new EMA(26), new EMA(9));
  let last: { macd: number; signal: number; histogram: number } | null = null;
  for (const c of closes) {
    const out = ind.add(c);
    if (out) last = out;
  }
  if (!last) return unmeasured;
  return {
    line: finite(last.macd),
    signal: finite(last.signal),
    histogram: finite(last.histogram),
  };
}

/** Wilder's Average True Range over `period` (default 14). */
export function atr(bars: ReadonlyArray<Bar>, period = 14): number | null {
  if (bars.length <= period) return null;
  return lastResult(new ATR(period), bars);
}

/** Bollinger Bands (period 20, 2 standard deviations) on closing prices. */
export function bollinger(
  closes: ReadonlyArray<number>,
  period = 20,
  deviation = 2,
): { upper: number | null; middle: number | null; lower: number | null } {
  const unmeasured = { upper: null, middle: null, lower: null };
  if (closes.length < period) return unmeasured;
  const ind = new BollingerBands(period, deviation);
  let last: { upper: number; middle: number; lower: number } | null = null;
  for (const c of closes) {
    const out = ind.add(c);
    if (out) last = out;
  }
  if (!last) return unmeasured;
  return { upper: finite(last.upper), middle: finite(last.middle), lower: finite(last.lower) };
}

/**
 * Stochastic Oscillator with the conventional 14/3/3 parameters.
 * `k` is %K (smoothed), `d` is %D (SMA of %K).
 */
export function stochastic(
  bars: ReadonlyArray<Bar>,
  n = 14,
  m = 3,
  p = 3,
): { k: number | null; d: number | null } {
  if (bars.length < n + m + p) return { k: null, d: null };
  const ind = new StochasticOscillator(n, m, p);
  let last: { stochK: number; stochD: number } | null = null;
  for (const b of bars) {
    const out = ind.add(b);
    if (out) last = out;
  }
  if (!last) return { k: null, d: null };
  return { k: finite(last.stochK), d: finite(last.stochD) };
}

/**
 * KDJ derived from the Stochastic Oscillator: J = 3K - 2D. Common in Asian
 * technical-analysis literature; surfaces divergence between %K and %D more
 * aggressively than %K alone.
 */
export function kdj(bars: ReadonlyArray<Bar>): {
  k: number | null;
  d: number | null;
  j: number | null;
} {
  const { k, d } = stochastic(bars);
  return { k, d, j: k == null || d == null ? null : finite(3 * k - 2 * d) };
}

/**
 * On-Balance Volume — cumulative running sum that adds the bar's volume on
 * up-closes and subtracts it on down-closes. Returns the latest accumulated
 * value, or `null` if fewer than 2 bars are available.
 */
export function obv(bars: ReadonlyArray<Bar>): number | null {
  if (bars.length < 2) return null;
  return lastResult(new OBV(2), bars);
}

/**
 * Trend label from SMA stack. `up` when latest close sits above the 50- and
 * 200-day SMAs and the 50 sits above the 200 (classic uptrend stack);
 * `down` is the mirror. `flat` is a MEASURED reading — the stack exists and is
 * neither up nor down.
 *
 * `null` when either moving average is unavailable (FIX-1063, decision 2): a
 * trend we could not measure is reported as no trend, never as "flat". The old
 * `sma50 === 0 || sma200 === 0 → "flat"` branch is exactly the fabrication —
 * a recently-listed name with no 200-day history was labelled a definite flat
 * trend on an average nobody computed.
 */
export function trendLabel(
  close: number | null,
  sma50: number | null,
  sma200: number | null,
): "up" | "down" | "flat" | null {
  if (close == null || sma50 == null || sma200 == null) return null;
  if (close > sma50 && sma50 > sma200) return "up";
  if (close < sma50 && sma50 < sma200) return "down";
  return "flat";
}

export function computeIndicators(bars: ReadonlyArray<Bar>): IndicatorOutput {
  const closes = bars.map((b) => b.close);
  const sma50 = simpleMovingAverage(closes, 50);
  const sma200 = simpleMovingAverage(closes, 200);
  // No bars → no last close. `?? 0` would have made `trendLabel` compare
  // against a price that was never quoted.
  const lastClose = closes[closes.length - 1] ?? null;
  return {
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(bars, 14),
    trend: trendLabel(lastClose, sma50, sma200),
    sma50,
    sma200,
    bollinger: bollinger(closes),
    vwma20: vwma(bars, 20),
    stoch: stochastic(bars),
    kdj: kdj(bars),
    obv: obv(bars),
  };
}

/** Compute trailing return from daily bars: (last close - first close) / first close. */
export function trailingReturn(bars: Array<{ close: number }>): number | null {
  if (bars.length < 2) return null;
  const first = bars[0].close;
  const last = bars[bars.length - 1].close;
  if (first === 0) return null;
  return (last - first) / first;
}
