/**
 * Holding-period (short/long-term) calendar math — the IRS ST/LT boundary, in
 * one place (FIX-874).
 *
 * A lot is LONG-term once held MORE than one year; sold on the day exactly one
 * year after acquisition it is still short-term, so the boundary is
 * `disposedDate > acquiredDate + 1 year`, exclusive. The count is
 * calendar-anniversary-based (NOT `days >= 365`) and uses TRADE date on both
 * ends.
 *
 * Browser-safe pure leaf (BP-019): imports nothing, so the realized-gains
 * derivation (`lots.ts`), the repository, and the Portfolio view's per-lot term
 * column (`components/portfolio/holding-term.ts`) all classify off ONE copy of
 * the rule rather than each re-encoding it (BP-034 — the duplicate that lived in
 * `holding-term.ts` now imports `longBoundary` from here).
 */

/** The UTC instant a lot crosses into long-term: one year after acquisition,
 *  exclusive (the anniversary day itself is still short). `acquiredDate` is ISO
 *  `YYYY-MM-DD`. */
export function longBoundary(acquiredDate: string): number {
  const [y, m, d] = acquiredDate.split("-").map(Number);
  return Date.UTC(y + 1, m - 1, d);
}

/** UTC midnight (ms) of an ISO `YYYY-MM-DD` — the calendar-date compare basis, so
 *  a same-day disposal never flips on a time-of-day component. */
function dateMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Classify a realized disposal's holding period from its acquisition and
 * disposal trade dates.
 *
 * - `"unknown"` when `acquiredDate` is null — the acquisition date is unknowable
 *   (a transfer-in, or an unmatched over-sell). Never guessed into a term.
 * - `"long"` when the disposal is strictly AFTER the one-year anniversary.
 * - `"short"` otherwise (including a sale on the anniversary day itself).
 */
export function classifyTerm(
  acquiredDate: string | null,
  disposedDate: string,
): "short" | "long" | "unknown" {
  if (acquiredDate === null) return "unknown";
  return dateMs(disposedDate) > longBoundary(acquiredDate) ? "long" : "short";
}
