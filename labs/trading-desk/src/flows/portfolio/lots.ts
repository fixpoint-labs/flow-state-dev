/**
 * Pure FIFO cost-basis reconstruction from the transaction ledger (FIX-774).
 *
 * `deriveLots` is a pure reduction over an ordered event stream — no DB, no IO
 * (BP-019 leaf), so it is unit-testable in isolation and reusable by any caller
 * that holds ledger rows. It turns the "basis becomes derived" outcome into
 * code: lots reconstruct from the share-moving events, average cost is the
 * weighted mean over open lots, and `acquiredDate` is the earliest open lot's
 * date.
 *
 * Lot moves are driven by the sign of `quantity`, not the event's `type` label,
 * so a buy, a transfer-in, and a reinvested dividend all add lots uniformly and
 * a sell or transfer-out consumes them oldest-first. Cash events (null/zero
 * quantity — cash dividends, interest, deposits, fees) never touch lots.
 *
 * FIFO is the IRS default when shares are not specifically identified, so it is
 * the correct v1. Specific-lot sales, wash sales, and corporate-action basis
 * allocation are deferred (they need data this stream does not carry). A lot
 * with no acquisition record (a transfer-in flagged `basisUnknown`, or a buy
 * with no price) carries `costPerShare: null` and is flagged — NEVER zero-filled
 * (zero-fill would massively overstate realized gains).
 */
import type { LedgerRow } from "./ledger-schema";

/** Floating-point tolerance for treating a residual share quantity as closed. */
const QTY_EPSILON = 1e-9;

/** One open acquisition lot: a dated parcel of shares at a per-share cost. */
export type Lot = {
  ticker: string;
  quantity: number;
  /** Per-share cost in the account currency; null when the basis is unknown. */
  costPerShare: number | null;
  /** ISO `YYYY-MM-DD` the lot was acquired (the event's trade date). */
  acquiredDate: string;
  /** True when this lot has no acquisition basis (a flagged transfer-in / no price). */
  basisUnknown: boolean;
};

/** A current position derived from the open lots of one ticker. */
export type DerivedPosition = {
  ticker: string;
  /** Net open share quantity (sum of remaining open-lot quantities). */
  quantity: number;
  /** Weighted average cost across the KNOWN-cost open lots; null when none of
   *  the open lots carry a basis. Honest over the known portion — never zero. */
  avgCost: number | null;
  /** Earliest open-lot acquisition date; null when there are no open lots. */
  acquiredDate: string | null;
  /** True when any open lot has an unknown basis (the gap is surfaced, not hidden). */
  hasUnknownBasis: boolean;
};

/** A mutable open lot used while reducing the event stream. */
type OpenLot = { quantity: number; costPerShare: number | null; acquiredDate: string };

/**
 * Reduce a ledger event stream into current positions and their open lots.
 *
 * Voided rows (tombstones) and cash events are ignored. Share-adding events
 * enqueue a lot; share-removing events consume open lots oldest-first (an
 * over-sell beyond the held quantity is clamped — bad data never produces a
 * negative position). The returned `positions` carry only tickers with a
 * remaining open quantity; a fully-closed position is omitted.
 */
export function deriveLots(events: LedgerRow[]): {
  positions: DerivedPosition[];
  lots: Lot[];
} {
  // Order by trade date; within a single day, process acquisitions before
  // disposals so a same-day sell consumes that day's buy rather than over-selling
  // into a phantom position — FIFO still draws from the OLDEST open lot at the
  // front of the queue, so a same-day buy never jumps ahead of an older lot.
  // Remaining ties keep the input order, which the repository supplies
  // deterministically (`ORDER BY trade_date, created_at, id`). Intraday sequence
  // within one batch is best-effort (there is no intraday timestamp), not
  // tax-grade.
  const ordered = events
    .filter((e) => e.voidedAt === null && e.quantity !== null && Math.abs(e.quantity) > QTY_EPSILON)
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      if (a.e.tradeDate !== b.e.tradeDate) return a.e.tradeDate < b.e.tradeDate ? -1 : 1;
      const aAcq = (a.e.quantity as number) > 0;
      const bAcq = (b.e.quantity as number) > 0;
      if (aAcq !== bAcq) return aAcq ? -1 : 1;
      return a.idx - b.idx;
    });

  const open = new Map<string, OpenLot[]>();

  for (const { e } of ordered) {
    const ticker = e.ticker;
    const qty = e.quantity as number;
    if (ticker === null) continue; // a share move with no security is not a lot

    if (qty > 0) {
      // Acquisition: cost is the unit price, else derived from amount/qty, but a
      // flagged basis-unknown transfer-in stays null (never inferred).
      const derivedCost =
        e.unitPrice ?? (e.amount !== 0 ? Math.abs(e.amount / qty) : null);
      const costPerShare = e.basisUnknown !== null ? null : derivedCost;
      const lots = open.get(ticker) ?? [];
      lots.push({ quantity: qty, costPerShare, acquiredDate: e.tradeDate });
      open.set(ticker, lots);
    } else {
      // Disposal: consume open lots oldest-first.
      let remaining = -qty;
      const lots = open.get(ticker) ?? [];
      while (remaining > QTY_EPSILON && lots.length > 0) {
        const lot = lots[0];
        if (lot.quantity <= remaining + QTY_EPSILON) {
          remaining -= lot.quantity;
          lots.shift();
        } else {
          lot.quantity -= remaining;
          remaining = 0;
        }
      }
      open.set(ticker, lots);
    }
  }

  const lots: Lot[] = [];
  const positions: DerivedPosition[] = [];
  for (const [ticker, openLots] of open) {
    if (openLots.length === 0) continue;
    let totalQty = 0;
    let knownQty = 0;
    let knownCost = 0;
    let acquiredDate: string | null = null;
    let hasUnknownBasis = false;
    for (const lot of openLots) {
      totalQty += lot.quantity;
      if (lot.costPerShare === null) {
        hasUnknownBasis = true;
      } else {
        knownQty += lot.quantity;
        knownCost += lot.quantity * lot.costPerShare;
      }
      if (acquiredDate === null || lot.acquiredDate < acquiredDate) acquiredDate = lot.acquiredDate;
      lots.push({
        ticker,
        quantity: lot.quantity,
        costPerShare: lot.costPerShare,
        acquiredDate: lot.acquiredDate,
        basisUnknown: lot.costPerShare === null,
      });
    }
    if (totalQty <= QTY_EPSILON) continue; // fully closed — no current position
    positions.push({
      ticker,
      quantity: totalQty,
      avgCost: knownQty > QTY_EPSILON ? knownCost / knownQty : null,
      acquiredDate,
      hasUnknownBasis,
    });
  }

  return { positions, lots };
}
