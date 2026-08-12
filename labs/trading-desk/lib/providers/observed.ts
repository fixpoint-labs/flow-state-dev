/**
 * Absence-aware numeric coercion shared by the provider adapters (FIX-1063).
 *
 * The data-honesty contract's rule is **unobserved → null, NOT falsy → null**.
 * A provider that answers successfully but omits a field must surface that gap
 * as `null`; a finite `0` it actually returned is a measurement and stays `0`.
 *
 * This lives in one place because the failure it prevents is Yahoo and Finnhub
 * DIVERGING on the edge cases — `unknown` vs `number | undefined`, `NaN`, the
 * Yahoo `{ raw }` wrapper. Two hand-written copies drift silently, and a drifted
 * copy fabricates on exactly the inputs the other one rejects.
 */

/** A price bar before its fields have been proven observed. */
export type ObservedBarCandidate = {
  date: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

/** A price bar whose every OHLCV field was actually observed. */
export type ObservedBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Coerces a raw provider field to a finite number, or `null` when the provider
 * did not observe it.
 *
 * Keys on whether the provider answered at all, never on the value being
 * falsy. Absent, non-numeric, and non-finite (`NaN`, `±Infinity`) all read
 * `null`; a finite `0` reads `0`. Unwraps Yahoo's `{ raw }` envelope, the one
 * shape difference between the two adapters.
 *
 * Do NOT use this for the P/E and dividend fields, where a zero is itself
 * non-physical for a going concern — those keep the `!== 0` helpers (FIX-692).
 */
export function observedFinite(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "object" && "raw" in raw) {
    const v = (raw as { raw?: unknown }).raw;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether every OHLCV field on a candidate bar was observed.
 *
 * The bar is the unit of observation: the OHLC consumers (ATR, the stochastic
 * oscillator, OBV, VWMA) need the whole tuple, so a bar missing any leg cannot
 * be repaired by defaulting the gap to `0` — that publishes a fabricated zero
 * low, or a zero-volume day, under a live provider tag. An incomplete bar is
 * therefore DROPPED, which is the same rule the Yahoo adapter already applied
 * to `open`/`close`, now covering the whole tuple and both providers.
 */
export function isObservedBar(bar: ObservedBarCandidate): bar is ObservedBar {
  return (
    bar.date != null &&
    bar.open != null &&
    bar.high != null &&
    bar.low != null &&
    bar.close != null &&
    bar.volume != null
  );
}

/**
 * A provider timestamp as an ISO `YYYY-MM-DD` day, or `null` when it is not a
 * usable date.
 *
 * A bar with no readable date cannot be placed in a series, so it is dropped
 * like any other incomplete bar. This is also why it returns `null` rather
 * than throwing: `toISOString()` on an Invalid Date throws a `RangeError`, and
 * one malformed timestamp taking down the whole price fetch would turn a
 * partial answer into a total provider outage.
 */
export function observedIsoDay(raw: unknown): string | null {
  const d = raw instanceof Date ? raw : new Date(raw as string | number);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}
