/**
 * Pure-function technical-indicator math. Consumed by the `compute_indicators`
 * tool handler when running in live mode — indicators aren't *fetched*, they're
 * derived from OHLC bars, so they belong outside the data-source layer.
 *
 * All routines accept the canonical `bars` shape from `get_price_history` and
 * return finite numbers. When the input series is too short to compute a given
 * indicator, the routine returns `0` (or the neutral baseline) rather than
 * throwing — analyst prompts already handle missing-signal cases.
 */

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
};

export function simpleMovingAverage(values: ReadonlyArray<number>, period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(values.length - period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Exponential moving average. Seeded with the SMA of the first `period` values,
 * then iterated through the rest of the series. Returns 0 if the series is
 * shorter than `period`.
 */
function ema(values: ReadonlyArray<number>, period: number): number {
  if (values.length < period) return 0;
  const k = 2 / (period + 1);
  let result = simpleMovingAverage(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    result = values[i]! * k + result * (1 - k);
  }
  return result;
}

/** Full EMA series — needed for MACD's signal line (EMA of MACD line). */
function emaSeries(values: ReadonlyArray<number>, period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  const seed = simpleMovingAverage(values.slice(0, period), period);
  out.push(seed);
  for (let i = period; i < values.length; i++) {
    const prev = out[out.length - 1]!;
    out.push(values[i]! * k + prev * (1 - k));
  }
  return out;
}

/**
 * Wilder's RSI over 14 periods. The classic recursive smoothing — average
 * gain/loss seeded from the first 14 closes, then each subsequent bar
 * smoothed with weight 1/period. Returns 50 (neutral) on a flat market and
 * 0 when the series is too short.
 */
export function rsi(closes: ReadonlyArray<number>, period = 14): number {
  if (closes.length <= period) return 0;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
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
  const ema12Series = emaSeries(closes, 12);
  const ema26Series = emaSeries(closes, 26);
  // Align series tails — EMA12 starts earlier so trim from the front.
  const offset = ema12Series.length - ema26Series.length;
  const macdSeries = ema26Series.map((v, i) => ema12Series[i + offset]! - v);
  const line = macdSeries[macdSeries.length - 1] ?? 0;
  const signal = ema(macdSeries, 9);
  return { line, signal, histogram: line - signal };
}

/**
 * Wilder's Average True Range over 14 periods. True range per bar is the
 * max of (high-low, |high-prevClose|, |low-prevClose|). ATR is the
 * Wilder-smoothed mean of those.
 */
export function atr(bars: ReadonlyArray<Bar>, period = 14): number {
  if (bars.length <= period) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const prev = bars[i - 1]!;
    const tr = Math.max(
      b.high - b.low,
      Math.abs(b.high - prev.close),
      Math.abs(b.low - prev.close),
    );
    trueRanges.push(tr);
  }
  let result = simpleMovingAverage(trueRanges.slice(0, period), period);
  for (let i = period; i < trueRanges.length; i++) {
    result = (result * (period - 1) + trueRanges[i]!) / period;
  }
  return result;
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
  };
}
