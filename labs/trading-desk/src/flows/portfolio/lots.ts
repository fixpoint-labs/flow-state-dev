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
 * the correct v1. Specific-lot sales and wash sales are deferred (they need data
 * this stream does not carry). Stock splits ARE handled: a `split` event scales
 * the ticker's open lots at the split date (quantity × ratio, cost ÷ ratio), so
 * pre-split basis lines up with post-split proceeds — without it FIFO matches a
 * ~$48 pre-split lot to a ~$24 post-split sale and fabricates a ~50% loss (and
 * the extra post-split shares over-sell into basis-unknown remainders). Other
 * corporate actions (return-of-capital, spinoffs) remain deferred. A lot with no
 * acquisition record (a transfer-in flagged `basisUnknown`, or a buy with no
 * price) carries `costPerShare: null` and is flagged — NEVER zero-filled
 * (zero-fill would massively overstate realized gains).
 */
import { classifyTerm } from "./holding-period";
import type { LedgerRow } from "./ledger-schema";
import type { RealizedDisposal } from "./realized-gains";

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

/** A mutable open lot used while reducing the event stream. Beyond the fields
 *  the open-position rollup needs, it carries the provenance a realized
 *  disposal reads when the lot is consumed: whether the acquisition DATE is a
 *  true acquisition (a `buy`) vs an arrival (`transfer`-in → unknown term), the
 *  acquisition currency (a differing sell currency nulls the gain), and the
 *  basis-unknown reason string. */
type OpenLot = {
  quantity: number;
  costPerShare: number | null;
  acquiredDate: string;
  acquisitionDateKnown: boolean;
  currency: string;
  basisUnknownReason: string | null;
};

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
  // A `split` carries a ratio, not a share `quantity`, so it survives the filter
  // on its own predicate. Within a day it sorts AFTER acquisitions and BEFORE
  // disposals (phase 1): shares bought that day are already in the lot queue when
  // the split scales them, and that day's sells then draw on the split-adjusted
  // lots. FIFO order among lots is unchanged (a split scales every open lot).
  const phase = (e: LedgerRow): 0 | 1 | 2 =>
    e.type === "split" ? 1 : (e.quantity as number) > 0 ? 0 : 2;
  const ordered = events
    .filter((e) =>
      e.voidedAt === null &&
      (e.type === "split"
        ? e.splitRatio !== null && e.splitRatio > 0 && e.ticker !== null
        : e.quantity !== null && Math.abs(e.quantity) > QTY_EPSILON),
    )
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      if (a.e.tradeDate !== b.e.tradeDate) return a.e.tradeDate < b.e.tradeDate ? -1 : 1;
      const pa = phase(a.e);
      const pb = phase(b.e);
      if (pa !== pb) return pa - pb;
      return a.idx - b.idx;
    });

  const open = new Map<string, OpenLot[]>();
  const disposals: RealizedDisposal[] = [];

  for (const { e } of ordered) {
    const ticker = e.ticker;
    if (ticker === null) continue; // a share move with no security is not a lot

    if (e.type === "split") {
      // Scale every open lot of this ticker: a 2:1 split doubles shares and halves
      // per-share cost (total basis is preserved). An unknown-basis lot keeps its
      // null cost — only the share count scales. A split before the position ever
      // opens (no lots yet) is a no-op. `splitRatio` is filtered non-null/positive.
      const ratio = e.splitRatio as number;
      const lots = open.get(ticker);
      if (lots !== undefined) {
        for (const lot of lots) {
          lot.quantity *= ratio;
          if (lot.costPerShare !== null) lot.costPerShare /= ratio;
        }
      }
      continue;
    }

    const qty = e.quantity as number;
    if (qty > 0) {
      // Acquisition: cost is the unit price, else derived from amount/qty, but a
      // flagged basis-unknown transfer-in stays null (never inferred). A `buy`'s
      // trade date IS the acquisition; a `transfer`-in's is only when it arrived
      // in this account, so its consumed disposals classify term "unknown".
      const derivedCost =
        e.unitPrice ?? (e.amount !== 0 ? Math.abs(e.amount / qty) : null);
      const costPerShare = e.basisUnknown !== null ? null : derivedCost;
      const lots = open.get(ticker) ?? [];
      lots.push({
        quantity: qty,
        costPerShare,
        acquiredDate: e.tradeDate,
        acquisitionDateKnown: e.type === "buy",
        currency: e.currency,
        basisUnknownReason: e.basisUnknown,
      });
      open.set(ticker, lots);
    } else {
      // Disposal: consume open lots oldest-first. A realized record is emitted
      // ONLY for a `sell` (a taxable disposition); a `transfer`-out consumes
      // lots but produces no gain. Consumption stays sign-driven for both.
      const isSell = e.type === "sell";
      const totalSellQty = -qty;
      let remaining = totalSellQty;
      let lotIndex = 0;
      const lots = open.get(ticker) ?? [];
      while (remaining > QTY_EPSILON && lots.length > 0) {
        const lot = lots[0];
        const consumed = Math.min(lot.quantity, remaining);
        if (isSell) {
          disposals.push(makeDisposal(e, lot, consumed, totalSellQty, lotIndex));
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
      // Unmatched over-sell remainder (no open lot): surface the taxable sale
      // with an unknown acquisition rather than dropping it.
      if (isSell && remaining > QTY_EPSILON) {
        disposals.push(makeUnmatchedDisposal(e, remaining, totalSellQty, lotIndex));
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

/** Allocate a sell's proceeds to one consumed lot and classify the outcome. The
 *  two provenance axes stay separate: `term` follows the acquisition-DATE axis
 *  (`acquisitionDateKnown`), `costBasis`/`gain` follow the basis axis, and a
 *  currency mismatch (a differing-currency sell consuming this lot) nulls the
 *  basis side so a `USD proceeds − EUR basis` non-number is never surfaced. A
 *  proceeds-unknown import placeholder nulls proceeds (and therefore gain),
 *  keeping any known basis. */
function makeDisposal(
  e: LedgerRow,
  lot: OpenLot,
  consumed: number,
  totalSellQty: number,
  lotIndex: number,
): RealizedDisposal {
  const proceeds =
    e.proceedsUnknown !== null ? null : (consumed / totalSellQty) * e.amount;
  const acquiredDate = lot.acquisitionDateKnown ? lot.acquiredDate : null;
  let costBasis: number | null;
  let gain: number | null;
  let basisUnknown: string | null;
  if (lot.currency !== e.currency) {
    costBasis = null;
    gain = null;
    basisUnknown = "currency-mismatch";
  } else if (lot.costPerShare === null) {
    costBasis = null;
    gain = null;
    basisUnknown = lot.basisUnknownReason ?? "basis-unknown";
  } else {
    costBasis = consumed * lot.costPerShare;
    if (proceeds === null) {
      gain = null;
      basisUnknown = e.proceedsUnknown;
    } else {
      gain = proceeds - costBasis;
      basisUnknown = null;
    }
  }
  return {
    ticker: e.ticker as string,
    disposedDate: e.tradeDate,
    acquiredDate,
    quantity: consumed,
    proceeds,
    costBasis,
    gain,
    term: classifyTerm(acquiredDate, e.tradeDate),
    currency: e.currency,
    basisUnknown,
    disposalEventId: e.id,
    lotIndex,
  };
}

/** The unmatched remainder of an over-sell — real proceeds, no acquisition lot,
 *  so acquisition/term/basis are all unknown but the sale stays visible. */
function makeUnmatchedDisposal(
  e: LedgerRow,
  remaining: number,
  totalSellQty: number,
  lotIndex: number,
): RealizedDisposal {
  const proceeds =
    e.proceedsUnknown !== null ? null : (remaining / totalSellQty) * e.amount;
  return {
    ticker: e.ticker as string,
    disposedDate: e.tradeDate,
    acquiredDate: null,
    quantity: remaining,
    proceeds,
    costBasis: null,
    gain: null,
    term: "unknown",
    currency: e.currency,
    basisUnknown: e.proceedsUnknown ?? "no-acquisition-lot",
    disposalEventId: e.id,
    lotIndex,
  };
}
