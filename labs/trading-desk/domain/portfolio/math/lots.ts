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
 * A `split` (FIX-876) is the one event recognized by its `type`, not its sign:
 * it multiplies the OPEN lots of its ticker by the split ratio (`quantity ×
 * ratio`, `costPerShare ÷ ratio`) while PRESERVING each lot's acquisition date
 * (the IRS holding period is unchanged by a split). Forward and reverse splits
 * both flow through this one rebasing rule.
 *
 * FIFO is the IRS default when shares are not specifically identified, so it is
 * the correct v1. Specific-lot sales, wash sales, and non-split corporate-action
 * basis allocation are deferred (they need data this stream does not carry). A lot
 * with no acquisition record (a transfer-in flagged `basisUnknown`, or a buy
 * with no price) carries `costPerShare: null` and is flagged — NEVER zero-filled
 * (zero-fill would massively overstate realized gains).
 */
import { classifyTerm } from "./holding-period";
import { splitRatio, type LedgerRow } from "../schema/ledger-schema";
import type { RealizedDisposal } from "./realized-gains";

/** Floating-point tolerance for treating a residual share quantity as closed. */
const QTY_EPSILON = 1e-9;

/** `basisUnknown` reason stamped on the MATCHED disposals of an over-sold sale
 *  (FIX-876). An over-sell means an unaccounted corporate action (usually a
 *  missing split), so the lots the sale consumed are in mismatched units and
 *  their gains are phantom — nulled so the tax estimate (which keys on
 *  `gain !== null`) excludes them until the split is backfilled and the sale
 *  reconciles. The proceeds (real cash received) are kept. */
const OVERSOLD_BASIS_UNKNOWN = "oversold-unreconciled";

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
  /** True when any open lot that carries a `lotKey` (an imported tax-lot lot,
   *  FIX-895) has an unknown basis. `materializePositions` reads this for D5: the
   *  aggregate holding basis is nulled — not shown as a partial average — when an
   *  imported lot lacks basis. Gated on keyed lots so unkeyed FIFO feeds keep their
   *  established honest-over-known partial average (BP-030). */
  hasUnknownKeyedBasis: boolean;
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
  /** Lot identity (FIX-895) carried from the acquiring buy's `lotKey`. Null for
   *  every feed with no lot identity (OFX / Plaid / manual). A keyed disposal
   *  consumes the lot whose key matches; the split branch skips keyed lots. */
  lotKey: string | null;
};

/**
 * Reduce a ledger event stream into current positions and their open lots.
 *
 * Voided rows (tombstones) and cash events are ignored. Share-adding events
 * enqueue a lot; share-removing events consume open lots oldest-first; a `split`
 * rebases the ticker's open lots by its ratio (FIX-876). An over-sell beyond the
 * held quantity is clamped to no negative position AND records the ticker in the
 * returned `oversold` set — the post-rebase inconsistency signal a legitimately-
 * split position never trips (a raw negative sum would). The returned `positions`
 * carry only tickers with a remaining open quantity; a fully-closed position is
 * omitted.
 */
export function deriveLots(events: LedgerRow[]): {
  positions: DerivedPosition[];
  lots: Lot[];
  disposals: RealizedDisposal[];
  oversold: Set<string>;
} {
  // Order by trade date; within a single day, a split is applied FIRST (it is
  // effective at the market open, so same-day trades are already in post-split
  // units — applying it after them would double-adjust), then acquisitions before
  // disposals so a same-day sell consumes that day's buy rather than over-selling
  // into a phantom position. FIFO still draws from the OLDEST open lot at the
  // front of the queue, so a same-day buy never jumps ahead of an older lot.
  // Remaining ties keep the input order, which the repository supplies
  // deterministically (`ORDER BY trade_date, created_at, id`). Intraday sequence
  // within one batch is best-effort (there is no intraday timestamp), not
  // tax-grade.
  const rank = (e: LedgerRow): 0 | 1 | 2 =>
    e.type === "split" ? 0 : (e.quantity as number) > 0 ? 1 : 2;
  const ordered = events
    .filter(
      (e) =>
        e.voidedAt === null &&
        (e.type === "split" || (e.quantity !== null && Math.abs(e.quantity) > QTY_EPSILON)),
    )
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      if (a.e.tradeDate !== b.e.tradeDate) return a.e.tradeDate < b.e.tradeDate ? -1 : 1;
      const ra = rank(a.e);
      const rb = rank(b.e);
      if (ra !== rb) return ra - rb;
      return a.idx - b.idx;
    });

  const open = new Map<string, OpenLot[]>();
  const disposals: RealizedDisposal[] = [];
  const oversold = new Set<string>();

  for (const { e } of ordered) {
    const ticker = e.ticker;
    if (ticker === null) continue; // a share move with no security is not a lot

    if (e.type === "split") {
      // Rebase every OPEN lot by the ratio; preserve `acquiredDate` (the holding
      // period is unchanged by a split — IRS rule). A malformed split with no
      // ratio, or one with no open lots for the ticker, is a harmless no-op.
      const attrs = e.attributes;
      const lots = open.get(ticker);
      if (attrs === null || lots === undefined) continue;
      const r = splitRatio(attrs);
      for (const lot of lots) {
        // A keyed lot (FIX-895) comes from a broker tax-lot export whose quantity
        // and basis are ALREADY split-adjusted as of the export, so rebasing it
        // would double-adjust (phantom remainder / spurious over-sell). Skip it.
        if (lot.lotKey !== null) continue;
        lot.quantity *= r;
        if (lot.costPerShare !== null) lot.costPerShare /= r;
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
        lotKey: e.lotKey,
      });
      open.set(ticker, lots);
    } else {
      // Disposal: consume open lots oldest-first. A realized record is emitted
      // ONLY for a `sell` (a taxable disposition); a `transfer`-out consumes
      // lots but produces no gain. Consumption stays sign-driven for both.
      const isSell = e.type === "sell";
      const totalSellQty = -qty;
      const lots = open.get(ticker) ?? [];

      if (e.closesLotKey !== null) {
        // Specific-lot disposal (FIX-895): the broker told us WHICH lot closed, so
        // consume THAT lot (splice by key), never oldest-first FIFO. A keyed
        // disposal NEVER falls back to FIFO: if the referenced lot is not open
        // (evolved/partial file, or already consumed) the sell emits an unmatched
        // disposal (real proceeds, unknown acquisition/basis/term, `lot-not-found`)
        // and consumes NOTHING — silently consuming an unrelated lot would
        // fabricate a wrong basis/term, the exact corruption lot identity prevents.
        const idx = lots.findIndex((l) => l.lotKey === e.closesLotKey);
        if (idx === -1) {
          if (isSell) {
            disposals.push(makeUnmatchedDisposal(e, totalSellQty, totalSellQty, 0, "lot-not-found"));
          }
        } else {
          const lot = lots[idx];
          const consumed = Math.min(lot.quantity, totalSellQty);
          if (isSell) disposals.push(makeDisposal(e, lot, consumed, totalSellQty, 0));
          if (lot.quantity <= totalSellQty + QTY_EPSILON) {
            lots.splice(idx, 1);
            // The keyed lot didn't cover the whole sale — surface the remainder as
            // an unmatched disposal (real proceeds, unknown basis/term) rather than
            // silently dropping those proceeds, mirroring the FIFO over-sell branch.
            const remainder = totalSellQty - lot.quantity;
            if (isSell && remainder > QTY_EPSILON) {
              disposals.push(makeUnmatchedDisposal(e, remainder, totalSellQty, 1, "lot-not-found"));
            }
          } else {
            lot.quantity -= totalSellQty;
          }
        }
        open.set(ticker, lots);
        continue;
      }

      let remaining = totalSellQty;
      let lotIndex = 0;
      // Buffer THIS sale's matched disposals: whether the sale over-sold isn't
      // known until the loop finishes, and an over-sell retroactively taints
      // every lot it consumed (mismatched units), not just the remainder.
      const sellDisposals: RealizedDisposal[] = [];
      while (remaining > QTY_EPSILON && lots.length > 0) {
        const lot = lots[0];
        const consumed = Math.min(lot.quantity, remaining);
        if (isSell) {
          sellDisposals.push(makeDisposal(e, lot, consumed, totalSellQty, lotIndex));
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
      const overSold = remaining > QTY_EPSILON;
      if (isSell && overSold) {
        // The sale consumed every open lot and STILL has a remainder — an
        // over-sell (a post-split sale against pre-split lots before the split is
        // backfilled). The lots it did match are in mismatched units, so their
        // gains are phantom: null each one's basis/gain (keeping real proceeds) so
        // the tax estimate excludes them (honest over silently-wrong, FIX-874/876)
        // instead of reporting a fabricated loss. They self-heal once the missing
        // split is recorded and the sale reconciles.
        for (const d of sellDisposals) {
          disposals.push({ ...d, costBasis: null, gain: null, basisUnknown: OVERSOLD_BASIS_UNKNOWN });
        }
        // The unmatched remainder (no open lot left) surfaces as an
        // unknown-acquisition disposal so it isn't dropped.
        disposals.push(makeUnmatchedDisposal(e, remaining, totalSellQty, lotIndex));
      } else {
        for (const d of sellDisposals) disposals.push(d);
      }
      // SIGNAL the over-sell (FIX-876) so the caller can flag the position or
      // attempt a split auto-resolve rather than treat it as a clean close.
      if (overSold) oversold.add(ticker);
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
    let hasUnknownKeyedBasis = false;
    for (const lot of openLots) {
      totalQty += lot.quantity;
      if (lot.costPerShare === null) {
        hasUnknownBasis = true;
        if (lot.lotKey !== null) hasUnknownKeyedBasis = true; // FIX-895 D5
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
      hasUnknownKeyedBasis,
    });
  }

  return { positions, lots, disposals, oversold };
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
  // Proceeds are the MAGNITUDE of the sell amount — cash received is non-negative.
  // The ingest invariant now rejects a negative sell amount, but a legacy manual
  // sell recorded before that guard (the old dialog allowed "negative = cash out")
  // can still sit in the ledger; `abs` keeps the backfill from materializing
  // negative proceeds / an inflated loss. A proceeds-unknown placeholder still
  // nulls it.
  const proceeds =
    e.proceedsUnknown !== null ? null : (consumed / totalSellQty) * Math.abs(e.amount);
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

/** The unmatched remainder of an over-sell, OR a keyed disposal whose referenced
 *  lot is not open (FIX-895, `reason: "lot-not-found"`) — real proceeds, no
 *  acquisition lot, so acquisition/term/basis are all unknown but the sale stays
 *  visible. `reason` names the basis-unknown cause (default: the over-sell's
 *  `"no-acquisition-lot"`); a set `proceedsUnknown` marker still wins. */
function makeUnmatchedDisposal(
  e: LedgerRow,
  remaining: number,
  totalSellQty: number,
  lotIndex: number,
  reason = "no-acquisition-lot",
): RealizedDisposal {
  // `abs` for the same reason as makeDisposal — a legacy negative sell amount
  // must not surface as negative proceeds on the unmatched remainder.
  const proceeds =
    e.proceedsUnknown !== null ? null : (remaining / totalSellQty) * Math.abs(e.amount);
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
    basisUnknown: e.proceedsUnknown ?? reason,
    disposalEventId: e.id,
    lotIndex,
  };
}

/** Standard split ratios an inferred cliff is snapped to (forward; a reverse
 *  split uses the inverse). A split produces a clean, large, one-day price
 *  division that dwarfs normal volatility, so an inferred ratio is trusted only
 *  when it lands within {@link SPLIT_SNAP_TOLERANCE} of one of these. */
const STANDARD_SPLIT_RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const SPLIT_SNAP_TOLERANCE = 0.2; // inferred cliff within ±20% of a standard ratio

/** Snap a raw price ratio to the nearest standard split ratio, with its relative
 *  error; null when the nearest is outside tolerance (don't guess a non-standard
 *  ratio). */
function snapSplitRatio(raw: number): { ratio: number; err: number } | null {
  let best: number | null = null;
  let bestErr = Infinity;
  for (const r of STANDARD_SPLIT_RATIOS) {
    const err = Math.abs(raw - r) / r;
    if (err < bestErr) {
      bestErr = err;
      best = r;
    }
  }
  return best !== null && bestErr <= SPLIT_SNAP_TOLERANCE ? { ratio: best, err: bestErr } : null;
}

/** A detected-but-unconfirmed split proposal (FIX-876 follow-up). */
export type InferredSplit = { numerator: number; denominator: number; tradeDate: string };

/** Build a synthetic `split` `LedgerRow` for a dry-run derivation. Only the
 *  fields `deriveLots` reads matter; the rest are inert placeholders. */
function syntheticSplitRow(ticker: string, s: InferredSplit): LedgerRow {
  return {
    id: "inferred-split",
    accountId: "",
    userId: "",
    type: "split",
    ticker,
    tradeDate: s.tradeDate,
    settleDate: null,
    quantity: null,
    unitPrice: null,
    amount: 0,
    fee: null,
    currency: "USD",
    source: "manual",
    externalId: null,
    description: null,
    basisUnknown: null,
    proceedsUnknown: null,
    lotKey: null,
    closesLotKey: null,
    attributes: { numerator: s.numerator, denominator: s.denominator },
    voidedAt: null,
    createdAt: s.tradeDate,
  };
}

/**
 * Best-effort detection of a MISSING stock split for an over-sold ticker (the
 * FIX-876 auto-resolve). Meant for a ticker `deriveLots` reports as `oversold`
 * (its disposals exceed everything ever held — the signature of a pre/post-split
 * units mismatch). It infers the ratio from the largest price CLIFF between the
 * ticker's date-ordered priced trades (a split divides the price by the ratio),
 * snaps it to a standard ratio, and then VERIFIES the candidate actually resolves
 * the over-sell before returning it — a guess that doesn't reconcile the position
 * is discarded (returns null), never fabricated. Heuristic by design: it covers
 * the common single forward/reverse split; a very volatile name or multiple
 * splits on one ticker may not resolve (and stay flagged). Pure + browser-safe so
 * the UI can both detect and preview the result client-side.
 */
export function inferSplit(events: LedgerRow[], ticker: string): InferredSplit | null {
  const priced = events
    .filter(
      (e) =>
        e.voidedAt === null &&
        e.ticker === ticker &&
        e.type !== "split" &&
        e.quantity !== null &&
        Math.abs(e.quantity) > QTY_EPSILON &&
        e.unitPrice !== null &&
        e.unitPrice > 0,
    )
    .map((e, idx) => ({ price: e.unitPrice as number, date: e.tradeDate, idx }))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.idx - b.idx));
  if (priced.length < 2) return null;

  // Scan adjacent (date-ordered) trades for the cleanest price cliff — a drop is a
  // forward split (R:1), a rise is a reverse split (1:R). Keep the best snap.
  let best: InferredSplit | null = null;
  let bestErr = Infinity;
  for (let i = 0; i + 1 < priced.length; i++) {
    const before = priced[i].price;
    const after = priced[i + 1].price;
    const date = priced[i + 1].date;
    const fwd = snapSplitRatio(before / after);
    if (fwd !== null && fwd.err < bestErr) {
      bestErr = fwd.err;
      best = { numerator: fwd.ratio, denominator: 1, tradeDate: date };
    }
    const rev = snapSplitRatio(after / before);
    if (rev !== null && rev.err < bestErr) {
      bestErr = rev.err;
      best = { numerator: 1, denominator: rev.ratio, tradeDate: date };
    }
  }
  if (best === null) return null;

  // Verify: the candidate must actually reconcile the ticker (no more over-sell,
  // and a real position derives). Otherwise it's a bad guess — discard it.
  const { oversold, positions } = deriveLots([...events, syntheticSplitRow(ticker, best)]);
  if (oversold.has(ticker)) return null;
  if (!positions.some((p) => p.ticker === ticker)) return null;
  return best;
}

/**
 * Dry-run the position a ticker WOULD derive to if the given split were recorded
 * (FIX-876 auto-resolve preview). Pure: re-runs `deriveLots` with a synthetic
 * split appended, so the "Resolve split" UI can show the resulting share count +
 * average cost live as the user adjusts the ratio/date — the "verify the amount
 * before you confirm" gate. Returns null when the candidate would NOT heal the
 * flagged row — either the ticker still derives no position, OR it is still
 * `oversold`. The oversold check mirrors `materializePositions`' authority rule:
 * an oversold ticker materializes FLAGGED regardless of a later residual buy, so
 * a ratio that clamps its way to a residual open position while still over-selling
 * must not show a reconciled preview nor enable confirm (recording it wouldn't
 * clear the flag).
 */
export function previewSplitResult(
  events: LedgerRow[],
  ticker: string,
  split: InferredSplit,
): DerivedPosition | null {
  const { positions, oversold } = deriveLots([...events, syntheticSplitRow(ticker, split)]);
  if (oversold.has(ticker)) return null;
  return positions.find((p) => p.ticker === ticker) ?? null;
}
