/**
 * The realized-disposal contract (FIX-874) — the per-lot record the FIFO engine
 * emits when a sale consumes open lots.
 *
 * Browser-safe pure leaf (BP-019): a type only, so `lots.ts` (the derivation),
 * the repository (which persists it to `app.realized_gains`), and the UI
 * row-model share one shape with no import cycle.
 *
 * TWO INDEPENDENT provenance axes — do not conflate them:
 *   (1) acquisition-date known?  drives `acquiredDate` / `term`
 *   (2) amount realized known?   drives `costBasis` / `gain` (the basis side)
 * A no-price buy has a KNOWN date but UNKNOWN basis; a transfer-in has a
 * (possibly) KNOWN basis but an UNKNOWN date. Both are modeled; neither is
 * collapsed into the other.
 */

/**
 * One realized disposal: a sale's outcome against ONE consumed FIFO lot (or the
 * unmatched remainder of an over-sell, which has no lot → unknown acquisition).
 */
export type RealizedDisposal = {
  ticker: string;
  /** Sell event trade date (`YYYY-MM-DD`). */
  disposedDate: string;
  /**
   * The consumed lot's acquisition date, or NULL when unknowable: ANY
   * transfer-in lot (its date is the transfer date, not the original
   * acquisition — even when the cost basis IS known), or an unmatched over-sell.
   * A buy (even a no-price buy) has a real acquisition date.
   */
  acquiredDate: string | null;
  /** Shares consumed from THIS lot (or the unmatched remainder). */
  quantity: number;
  /**
   * Pro-rata slice of the sell's validated amount (`(rowQty / totalSellQty) ×
   * amount`). Null only when the sell is a proceeds-unknown import placeholder
   * (`proceedsUnknown` marker set) — a genuine $0 sale is `0`, not null.
   */
  proceeds: number | null;
  /** `quantity × lot.costPerShare`; null when the basis is unknown. */
  costBasis: number | null;
  /** `proceeds − costBasis`; null when proceeds OR basis is unknown. */
  gain: number | null;
  /** `classifyTerm(...)`; `"unknown"` iff `acquiredDate` is null. */
  term: "short" | "long" | "unknown";
  /** The SELL event's currency — persisted so the route filters row-level, never
   *  account-level or hard-coded. */
  currency: string;
  /** Reason string when the basis/proceeds is unknown (mirrors the ledger's
   *  `basisUnknown` text column); null when the gain is a real number. */
  basisUnknown: string | null;
  /** The sell ledger event id (provenance). */
  disposalEventId: string;
  /** 0-based ordinal of the consumed lot within this sell (deterministic FIFO
   *  order); the unmatched remainder gets the next index. Part of the
   *  derived-row identity `(disposalEventId, lotIndex)`. */
  lotIndex: number;
};
