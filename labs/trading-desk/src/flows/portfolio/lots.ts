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
import { classifyTerm } from "./holding-period";

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

/**
 * One realized disposal: a sale's gain against ONE consumed FIFO lot (or the
 * unmatched remainder of an over-sell, which has no lot → unknown acquisition).
 * Emitted ONLY for `sell` events — a `transfer`-out consumes lots but is not a
 * taxable disposition.
 *
 * TWO INDEPENDENT provenance axes drive the nullable fields, never conflated:
 *   - acquisition-DATE axis → `acquiredDate` / `term`. Known only for a `buy`
 *     (its trade date IS the acquisition); a transfer-in's date is when it
 *     arrived, not when it was acquired → `acquiredDate: null`, `term: "unknown"`
 *     even when the broker basis is known.
 *   - BASIS axis → `costBasis` / `gain`. Null when the consumed lot has no cost
 *     (a flagged basis-unknown transfer-in or a no-price buy) or on a
 *     currency mismatch. Independent of the date axis.
 */
export type RealizedDisposal = {
  ticker: string;
  /** The sell event's `tradeDate` (ISO `YYYY-MM-DD`). */
  disposedDate: string;
  /** The consumed lot's acquisition date; null when unknowable (any transfer-in
   *  lot, or an unmatched over-sell). A buy — even a no-price buy — has a date. */
  acquiredDate: string | null;
  /** Shares consumed from THIS lot (or the unmatched remainder). */
  quantity: number;
  /** `(quantity / totalSellQty) × sellEvent.amount` — always known (amount taken
   *  at face value, so an `amount: 0` sell yields `0`). */
  proceeds: number;
  /** `quantity × lot.costPerShare`; null when the lot's basis is unknown or on a
   *  currency mismatch. */
  costBasis: number | null;
  /** `proceeds − costBasis`; null whenever `costBasis` is null. */
  gain: number | null;
  /** `classifyTerm(acquiredDate, disposedDate)` — "unknown" iff `acquiredDate` is null. */
  term: "short" | "long" | "unknown";
  /** The SELL event's currency. */
  currency: string;
  /** Reason the basis is unknown (mirrors the lot's flag / "no-price-buy" /
   *  "no-acquisition-lot" / "currency-mismatch"); null on a known-basis row. */
  basisUnknown: string | null;
  /** The sell ledger event id (provenance). */
  disposalEventId: string;
  /** 0-based ordinal of the consumed lot within this sell (FIFO order); the
   *  unmatched remainder gets the next index. `(disposalEventId, lotIndex)` is a
   *  stable identity across re-derivation. */
  lotIndex: number;
};

/**
 * A mutable open lot used while reducing the event stream. Carries two provenance
 * flags the disposal emission needs but the open-lot/position projection ignores:
 * `acquisitionDateKnown` (true only for a `buy`) and `currency` (the acquisition
 * event's), plus `basisUnknownReason` (the reason string when `costPerShare` is null).
 */
type OpenLot = {
  quantity: number;
  costPerShare: number | null;
  acquiredDate: string;
  acquisitionDateKnown: boolean;
  currency: string;
  basisUnknownReason: string | null;
};

/** Build one realized-disposal row from a sell event and the lot it consumed. */
function realizedRow(
  sell: LedgerRow,
  lot: OpenLot,
  quantity: number,
  totalSellQty: number,
  lotIndex: number,
): RealizedDisposal {
  const proceeds = (quantity / totalSellQty) * sell.amount;
  const acquiredDate = lot.acquisitionDateKnown ? lot.acquiredDate : null;
  let costBasis: number | null;
  let basisUnknown: string | null;
  if (sell.currency !== lot.currency) {
    // USD proceeds − EUR basis is a nonsense figure — null both, never a mix.
    costBasis = null;
    basisUnknown = "currency-mismatch";
  } else if (lot.costPerShare === null) {
    costBasis = null;
    basisUnknown = lot.basisUnknownReason;
  } else {
    costBasis = quantity * lot.costPerShare;
    basisUnknown = null;
  }
  return {
    ticker: sell.ticker as string,
    disposedDate: sell.tradeDate,
    acquiredDate,
    quantity,
    proceeds,
    costBasis,
    gain: costBasis === null ? null : proceeds - costBasis,
    term: classifyTerm(acquiredDate, sell.tradeDate),
    currency: sell.currency,
    basisUnknown,
    disposalEventId: sell.id,
    lotIndex,
  };
}

/**
 * Reduce a ledger event stream into current positions, their open lots, and the
 * realized disposals produced along the way.
 *
 * Voided rows (tombstones) and cash events are ignored. Share-adding events
 * enqueue a lot; share-removing events consume open lots oldest-first (an
 * over-sell beyond the held quantity is clamped — bad data never produces a
 * negative position). The returned `positions` carry only tickers with a
 * remaining open quantity; a fully-closed position is omitted.
 *
 * `disposals` records one realized row per (SELL event × consumed lot), plus one
 * per unmatched over-sell remainder. Lot CONSUMPTION stays sign-driven (a
 * transfer-out consumes lots too); only the realized-record EMISSION is gated on
 * `type === "sell"`, since a transfer-out is not a taxable disposition.
 */
export function deriveLots(events: LedgerRow[]): {
  positions: DerivedPosition[];
  lots: Lot[];
  disposals: RealizedDisposal[];
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
  const disposals: RealizedDisposal[] = [];

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
      const basisUnknownReason =
        e.basisUnknown !== null ? e.basisUnknown : costPerShare === null ? "no-price-buy" : null;
      const lots = open.get(ticker) ?? [];
      lots.push({
        quantity: qty,
        costPerShare,
        acquiredDate: e.tradeDate,
        // Only a buy's trade date is a real acquisition date; a transfer-in's is
        // when it arrived, not when it was originally acquired.
        acquisitionDateKnown: e.type === "buy",
        currency: e.currency,
        basisUnknownReason,
      });
      open.set(ticker, lots);
    } else {
      // Disposal: consume open lots oldest-first. Only a sell realizes a gain;
      // a transfer-out still consumes lots but emits no realized record.
      const isSell = e.type === "sell";
      const totalSellQty = -qty;
      let remaining = totalSellQty;
      let lotIndex = 0;
      const lots = open.get(ticker) ?? [];
      while (remaining > QTY_EPSILON && lots.length > 0) {
        const lot = lots[0];
        const consumed = lot.quantity <= remaining + QTY_EPSILON ? lot.quantity : remaining;
        if (isSell) {
          disposals.push(realizedRow(e, lot, consumed, totalSellQty, lotIndex));
          lotIndex += 1;
        }
        if (lot.quantity <= remaining + QTY_EPSILON) {
          remaining -= lot.quantity;
          lots.shift();
        } else {
          lot.quantity -= remaining;
          remaining = 0;
        }
      }
      // Unmatched over-sell remainder: shares sold beyond the held quantity have
      // no acquisition lot → unknown date and unknown basis, real pro-rata proceeds.
      if (isSell && remaining > QTY_EPSILON) {
        const proceeds = (remaining / totalSellQty) * e.amount;
        disposals.push({
          ticker,
          disposedDate: e.tradeDate,
          acquiredDate: null,
          quantity: remaining,
          proceeds,
          costBasis: null,
          gain: null,
          term: "unknown",
          currency: e.currency,
          basisUnknown: "no-acquisition-lot",
          disposalEventId: e.id,
          lotIndex,
        });
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

  return { positions, lots, disposals };
}
