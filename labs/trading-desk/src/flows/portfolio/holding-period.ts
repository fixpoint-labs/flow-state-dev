/**
 * Shared holding-period (short/long-term) boundary math.
 *
 * The pure IRS-rule leaf used by both the Portfolio Holdings Term column
 * (`components/portfolio/holding-term.ts`) and realized-gains classification.
 * US capital-gains rule: a lot is LONG-term once held MORE than one year — a
 * lot disposed exactly one year after acquisition is still SHORT-term, so the
 * boundary is exclusive. This is CALENDAR-anniversary based (add one year to
 * the acquisition date), not a 365-day count, so leap years land correctly.
 *
 * Dates are ISO `YYYY-MM-DD` strings, parsed and compared as UTC calendar
 * dates (never local time / time-of-day) to avoid timezone drift.
 */

/** Parse an ISO `YYYY-MM-DD` string to its UTC midnight instant (ms). */
function parseIsoDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The UTC instant a lot acquired on `acquiredDate` crosses into long-term:
 *  one year after acquisition, EXCLUSIVE — the anniversary day itself is
 *  still short. A disposal instant strictly after this boundary is long. */
export function longBoundary(acquiredDate: string): number {
  const [y, m, d] = acquiredDate.split("-").map(Number);
  return Date.UTC(y + 1, m - 1, d);
}

/** Classify one lot's term from its acquisition and disposal dates. A `null`
 *  `acquiredDate` (unknown acquisition) is never guessed into a term —
 *  it reads `"unknown"`. Exactly one year held is still `"short"` (the
 *  boundary is exclusive, per {@link longBoundary}). */
export function classifyTerm(
  acquiredDate: string | null,
  disposedDate: string,
): "short" | "long" | "unknown" {
  if (acquiredDate === null) return "unknown";
  const disposed = parseIsoDate(disposedDate);
  return disposed > longBoundary(acquiredDate) ? "long" : "short";
}
