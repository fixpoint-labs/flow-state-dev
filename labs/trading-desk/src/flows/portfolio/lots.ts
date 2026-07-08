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
import { splitRatio, type LedgerRow } from "./ledger-schema";

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
        lot.quantity *= r;
        if (lot.costPerShare !== null) lot.costPerShare /= r;
      }
      continue;
    }

    const qty = e.quantity as number;
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
      // Disposals drained everything and still had shares left to sell — an
      // over-sell that (post-rebase) can only happen with an unaccounted corporate
      // action. Clamp to no negative position, but SIGNAL it so the caller can
      // flag the position rather than silently treat it as a clean close.
      if (remaining > QTY_EPSILON) oversold.add(ticker);
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

  return { positions, lots, oversold };
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
