/**
 * Pure-function technical-indicator math. Consumed by the `compute_indicators`
 * tool handler when running in live mode — indicators aren't *fetched*, they're
 * derived from OHLC bars, so they belong outside the data-source layer.
 *
 * Wraps the `trading-signals` library (MIT) for the standard set, plus a
 * hand-rolled VWMA and a KDJ derived from the Stochastic Oscillator's K/D.
 *
 * All routines accept the canonical `bars` shape from `get_price_history` and
 * return finite numbers. When the input series is too short to compute a given
 * indicator the routine returns `0` (or the neutral baseline) rather than
 * throwing — analyst prompts already handle missing-signal cases.
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
  rsi14: number;
  macd: { line: number; signal: number; histogram: number };
  atr14: number;
  trend: "up" | "down" | "flat";
  sma50: number;
  sma200: number;
  bollinger: { upper: number; middle: number; lower: number };
  vwma20: number;
  stoch: { k: number; d: number };
  kdj: { k: number; d: number; j: number };
  obv: number;
};

/**
 * Coerces non-finite numbers (NaN, ±Infinity) to `0`. `trading-signals` returns
 * finite numbers under normal use, but defensive coercion keeps the schema
 * contract honest if a future upstream change ever leaks NaN through.
 */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Last value of a running indicator that consumes one input per bar. */
function lastResult<I>(
  indicator: { add: (input: I) => unknown; getResult: () => number | null },
  inputs: readonly I[],
): number {
  let last: number | null = null;
  for (const input of inputs) {
    const out = indicator.add(input);
    if (typeof out === "number") last = out;
  }
  return finite(last ?? 0);
}

export function simpleMovingAverage(values: ReadonlyArray<number>, period: number): number {
  if (values.length < period) return 0;
  return finite(lastResult(new SMA(period), values));
}

/**
 * Volume-weighted moving average over `period` bars. Hand-rolled because
 * `trading-signals` ships VWAP (typical price × volume, cumulative) but not
 * a fixed-window VWMA. Returns 0 if fewer than `period` bars or if the window
 * has zero total volume.
 */
export function vwma(bars: ReadonlyArray<Bar>, period: number): number {
  if (bars.length < period) return 0;
  const window = bars.slice(bars.length - period);
  let numerator = 0;
  let denominator = 0;
  for (const b of window) {
    numerator += b.close * b.volume;
    denominator += b.volume;
  }
  return denominator === 0 ? 0 : finite(numerator / denominator);
}

/** Wilder's RSI over `period` (default 14). */
export function rsi(closes: ReadonlyArray<number>, period = 14): number {
  if (closes.length <= period) return 0;
  return finite(lastResult(new RSI(period), closes));
}

/**
 * MACD with the conventional 12/26/9 parameters. Line is EMA12 - EMA26;
 * signal is EMA9 of that line; histogram is line - signal.
 */
export function macd(closes: ReadonlyArray<number>): {
  line: number;
  signal: number;
  histogram: number;
} {
  if (closes.length < 35) return { line: 0, signal: 0, histogram: 0 };
  const ind = new MACD(new EMA(12), new EMA(26), new EMA(9));
  let last: { macd: number; signal: number; histogram: number } | null = null;
  for (const c of closes) {
    const out = ind.add(c);
    if (out) last = out;
  }
  if (!last) return { line: 0, signal: 0, histogram: 0 };
  return {
    line: finite(last.macd),
    signal: finite(last.signal),
    histogram: finite(last.histogram),
  };
}

/** Wilder's Average True Range over `period` (default 14). */
export function atr(bars: ReadonlyArray<Bar>, period = 14): number {
  if (bars.length <= period) return 0;
  return finite(lastResult(new ATR(period), bars));
}

/** Bollinger Bands (period 20, 2 standard deviations) on closing prices. */
export function bollinger(
  closes: ReadonlyArray<number>,
  period = 20,
  deviation = 2,
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const ind = new BollingerBands(period, deviation);
  let last: { upper: number; middle: number; lower: number } | null = null;
  for (const c of closes) {
    const out = ind.add(c);
    if (out) last = out;
  }
  if (!last) return { upper: 0, middle: 0, lower: 0 };
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
): { k: number; d: number } {
  if (bars.length < n + m + p) return { k: 0, d: 0 };
  const ind = new StochasticOscillator(n, m, p);
  let last: { stochK: number; stochD: number } | null = null;
  for (const b of bars) {
    const out = ind.add(b);
    if (out) last = out;
  }
  if (!last) return { k: 0, d: 0 };
  return { k: finite(last.stochK), d: finite(last.stochD) };
}

/**
 * KDJ derived from the Stochastic Oscillator: J = 3K - 2D. Common in Asian
 * technical-analysis literature; surfaces divergence between %K and %D more
 * aggressively than %K alone.
 */
export function kdj(bars: ReadonlyArray<Bar>): { k: number; d: number; j: number } {
  const { k, d } = stochastic(bars);
  if (k === 0 && d === 0) return { k: 0, d: 0, j: 0 };
  return { k, d, j: finite(3 * k - 2 * d) };
}

/**
 * On-Balance Volume — cumulative running sum that adds the bar's volume on
 * up-closes and subtracts it on down-closes. Returns the latest accumulated
 * value, or 0 if fewer than 2 bars are available.
 */
export function obv(bars: ReadonlyArray<Bar>): number {
  if (bars.length < 2) return 0;
  return finite(lastResult(new OBV(2), bars));
}

/**
 * Trend label from SMA stack. `up` when latest close sits above the 50- and
 * 200-day SMAs and the 50 sits above the 200 (classic uptrend stack);
 * `down` is the mirror. Everything else is `flat`.
 */
export function trendLabel(close: number, sma50: number, sma200: number): "up" | "down" | "flat" {
  if (sma50 === 0 || sma200 === 0) return "flat";
  if (close > sma50 && sma50 > sma200) return "up";
  if (close < sma50 && sma50 < sma200) return "down";
  return "flat";
}

export function computeIndicators(bars: ReadonlyArray<Bar>): IndicatorOutput {
  const closes = bars.map((b) => b.close);
  const sma50 = simpleMovingAverage(closes, 50);
  const sma200 = simpleMovingAverage(closes, 200);
  const lastClose = closes[closes.length - 1] ?? 0;
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
