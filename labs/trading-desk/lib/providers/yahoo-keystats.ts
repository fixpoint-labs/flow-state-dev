/**
 * Yahoo `defaultKeyStatistics` short-interest mapper (pure).
 *
 * Short interest was single-sourced on Finnhub's `/stock/short-interest`,
 * which is commonly premium-gated and thin for ADRs — TSM returned
 * `unavailable`. Yahoo's `defaultKeyStatistics` module (already fetched for
 * `get_fundamentals`) carries the same signal free and with ADR coverage:
 * `sharesShort`, `shortRatio` (days-to-cover, pre-computed), and
 * `shortPercentOfFloat`. This module is the pure mapping layer; the
 * `quoteSummary` fetch lives in `yahoo.ts`. A field a filer/module doesn't
 * report maps to `null` (honest unobserved), never 0.
 */
/** Unwrap Yahoo's `{ raw }` or plain-number shapes; `null` when absent. */
function num(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "object" && "raw" in raw) {
    const v = (raw as { raw?: unknown }).raw;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

/** Format Yahoo's `dateShortInterest` (epoch seconds, Date, or string) to
 *  `YYYY-MM-DD`; `null` when absent or unparseable. */
function asDate(raw: unknown): string | null {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "string") return raw.slice(0, 10);
  if (typeof raw === "object" && raw !== null && "raw" in raw) {
    const v = (raw as { raw?: unknown }).raw;
    if (typeof v === "number") return new Date(v * 1000).toISOString().slice(0, 10);
  }
  if (typeof raw === "number") return new Date(raw * 1000).toISOString().slice(0, 10);
  return null;
}

/**
 * Map a raw `defaultKeyStatistics` object to the short-interest payload.
 * Yahoo reports `shortPercentOfFloat` as a fraction (0.062); the schema and
 * the memo use a percentage (6.2), so it is scaled by 100. `daysToCover` comes
 * straight from `shortRatio`. `shortInterest === null` signals "no usable
 * Yahoo data" to the fetcher, which then falls through to Finnhub.
 */
export function mapYahooShortInterest(
  stats: Record<string, unknown>,
  ticker: string,
  date: string,
) {
  const shortInterest = num(stats.sharesShort);
  const ratio = num(stats.shortRatio);
  const pctFraction = num(stats.shortPercentOfFloat);
  return {
    source: "yahoo" as const,
    ticker,
    asOf: date,
    shortInterest,
    shortInterestPctFloat:
      pctFraction != null ? Math.round(pctFraction * 100 * 100) / 100 : null,
    daysToCover: ratio != null ? Math.round(ratio * 10) / 10 : null,
    settlementDate: asDate(stats.dateShortInterest),
  };
}
