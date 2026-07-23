/**
 * Shared date + insider-window helpers for the desk's provider modules. Hoisted
 * so Finnhub, Alpha Vantage, and future insider-capable providers share one copy
 * (CLAUDE.md: common helpers live in one shared file, not duplicated per-file).
 */

/** Lookback window (calendar days) for the insider-transactions tool. */
export const INSIDER_WINDOW_DAYS = 90;

/** Cap on insider rows a provider returns, so a busy filer can't blow up the
 *  downstream prompt budget. Every insider provider honors the same cap. */
export const INSIDER_ROW_CAP = 50;

/** Subtracts `days` calendar days from a `YYYY-MM-DD` date string (UTC). */
export function isoDateDaysBefore(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
