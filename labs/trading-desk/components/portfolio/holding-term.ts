/**
 * Holding-period (short/long-term) math for the Portfolio view.
 *
 * US capital-gains terms: a lot is LONG-term once held MORE than one year
 * (sold on the day exactly one year after acquisition it is still short-term),
 * so the boundary is `asOf > acquiredDate + 1 year`. Classification is PER LOT
 * — a position bought across dates is honestly mixed, not labeled by its
 * earliest lot. Lots come from the FIFO derivation (`deriveLots`) for
 * ledger-backed positions; a CSV-snapshot-only holding degrades to one pseudo-
 * lot at its declared `acquiredDate`, and undated shares are UNKNOWN — never
 * guessed into a term.
 *
 * Browser-safe pure functions (the `portfolio-format` precedent): the caller
 * supplies `asOf`, so tests pin dates and the UI passes `new Date()`.
 */

import { longBoundary } from "@/src/domain/portfolio/math/holding-period";
import { DASH, formatQuantity } from "./portfolio-format";

/** One dated parcel of shares for term math. `acquiredDate` is ISO
 *  `YYYY-MM-DD`; null means the acquisition date is unknown. */
export type TermLot = { quantity: number; acquiredDate: string | null };

/** The per-holding term breakdown. Quantities partition the position. */
export type TermSummary = {
  /** Shares held more than one year. */
  longQty: number;
  /** Shares held one year or less. */
  shortQty: number;
  /** Shares with no acquisition date — term unknowable. */
  unknownQty: number;
  /** Whole months until the LAST short lot turns long (ceiling; ≥ 1), i.e.
   *  when the entire dated position is long. Null when nothing is short. */
  monthsToAllLong: number | null;
};

/** Whole calendar months from `from` up to `to` (both UTC ms), ceiling — a
 *  partial month counts as one, and anything in the future is at least 1. So
 *  "long on 2027-04-04" reads as 9 months from 2026-07-04, not a mean-month
 *  10. */
function monthsUntil(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() > a.getUTCDate()) months += 1;
  return Math.max(1, months);
}

/** Classify a position's lots into long / short / unknown shares as of a date,
 *  with the months remaining until the whole dated position is long. */
export function computeHoldingTerm(lots: TermLot[], asOf: Date): TermSummary {
  // Compare by CALENDAR DATE, not instant. `asOf` from the UI is `new Date()`
  // (carries the current time) and `longBoundary` is midnight UTC on the
  // anniversary, so a raw `getTime()` compare would flip a lot to long any time
  // after 00:00 UTC on the anniversary day — but that day is itself still short
  // (the boundary is exclusive). Normalize `asOf` to UTC midnight of its date.
  const now = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  let longQty = 0;
  let shortQty = 0;
  let unknownQty = 0;
  let latestBoundary: number | null = null;
  for (const lot of lots) {
    if (lot.acquiredDate === null) {
      unknownQty += lot.quantity;
      continue;
    }
    const boundary = longBoundary(lot.acquiredDate);
    if (now > boundary) {
      longQty += lot.quantity;
    } else {
      shortQty += lot.quantity;
      if (latestBoundary === null || boundary > latestBoundary) {
        latestBoundary = boundary;
      }
    }
  }
  const monthsToAllLong =
    latestBoundary === null ? null : monthsUntil(now, latestBoundary);
  return { longQty, shortQty, unknownQty, monthsToAllLong };
}

/**
 * Render a {@link TermSummary} as one compact cell string:
 *
 *   "Long"                   — every dated share is long
 *   "Short · 7 mo to long"   — every dated share is short
 *   "60L / 40S · 7 mo"       — mixed lots (the honest case a single date hides)
 *   "—"                      — no dated shares at all
 *
 * Undated shares alongside dated ones append " · 10 undated" so the unknown
 * portion is surfaced, not silently folded into a term.
 */
export function formatTerm(term: TermSummary): string {
  const { longQty, shortQty, unknownQty, monthsToAllLong } = term;
  if (longQty === 0 && shortQty === 0) return DASH;
  const undatedSuffix =
    unknownQty > 0 ? ` · ${formatQuantity(unknownQty)} undated` : "";
  if (shortQty === 0) return `Long${undatedSuffix}`;
  if (longQty === 0) {
    return `Short · ${monthsToAllLong} mo to long${undatedSuffix}`;
  }
  return `${formatQuantity(longQty)}L / ${formatQuantity(shortQty)}S · ${monthsToAllLong} mo${undatedSuffix}`;
}
