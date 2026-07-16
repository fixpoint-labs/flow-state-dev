/**
 * Pure, browser-safe transaction-ledger schemas (FIX-774).
 *
 * This is the load-bearing leaf for the ledger's shared ingestion contract. It
 * imports ONLY `zod` — no `@flow-state-dev/core`, no `node:crypto` — so the
 * manual-entry form can validate input client-side and the server action can
 * re-validate it, off one definition (BP-019: leaf module, no cycles). The
 * fingerprint/normalization that the ingest path computes lives server-side in
 * the repository, NOT here, so this stays bundle-safe.
 *
 * `LedgerEventInput` is the source-agnostic canonical event every writer maps
 * TO — manual entry today, FIX-775 (file import) and FIX-853 (Plaid sync) later.
 * `LedgerRow` is the persisted-and-mapped read shape the repository returns and
 * the FIFO lot derivation (`lots.ts`) consumes. Defining both here keeps the
 * lot math a pure leaf with no DB import.
 *
 * These are NOT generator output schemas — `.default()` / `.nullable()` are fine
 * (BP-016 only constrains generator outputs); do not add them to
 * `output-schemas-strict.spec.ts`.
 */
import { z } from "zod";

/** The typed event kinds the ledger records. `buy`/`sell`/`transfer` carry a
 *  signed `quantity` (they move lots); `split` is a corporate action that rebases
 *  the open lots by a ratio (no share delta, no cash — see {@link splitAttributesSchema});
 *  the rest are cash events. Stored as a plain `text` column — the enum is
 *  enforced here at the boundary, so adding a kind needs no enum-alter migration. */
export const ledgerEventTypeSchema = z.enum([
  "buy",
  "sell",
  "dividend",
  "interest",
  "deposit",
  "withdrawal",
  "transfer",
  "fee",
  "split",
]);
export type LedgerEventType = z.infer<typeof ledgerEventTypeSchema>;

/**
 * A stock-split corporate action, carried on a `split` event's `attributes`
 * jsonb (FIX-876). A 10-for-1 forward split is `{ numerator: 10, denominator: 1 }`;
 * a 1-for-10 reverse split is `{ numerator: 1, denominator: 10 }`. The ratio is
 * `numerator / denominator` (see {@link splitRatio}). Both are positive and
 * finite — normally integers (manual entry and OFX `NUMERATOR`/`DENOMINATOR`),
 * but the OFX `NEWUNITS`/`OLDUNITS` fallback may supply a fractional-share
 * holder's raw counts (121.9346 → 12.19346 for a 10-for-1), whose ratio is still
 * exact — so this is not `.int()`-constrained. A split multiplies OPEN lots
 * (`quantity × ratio`, `costPerShare ÷ ratio`); it is not a share delta, so
 * `deriveLots` branches on the `type`, not the sign of `quantity`.
 */
export const splitAttributesSchema = z.object({
  numerator: z.number().positive().finite(),
  denominator: z.number().positive().finite(),
});
export type SplitAttributes = z.infer<typeof splitAttributesSchema>;

/** The split ratio a split event applies to open lots — `numerator /
 *  denominator` (10-for-1 → 10; reverse 1-for-10 → 0.1). Browser-safe leaf
 *  helper so `deriveLots` (server + client) reads one definition. */
export function splitRatio(attrs: SplitAttributes): number {
  return attrs.numerator / attrs.denominator;
}

/** Which feed wrote a row. `manual`, `file` (FIX-775 import), `plaid` (FIX-853
 *  sync), and `provider` — the split backfill, which materializes `split` events
 *  from a market-data provider (Yahoo) for tickers whose corporate actions the
 *  import missed. All write through the same ingest contract. */
export const ledgerSourceSchema = z.enum(["manual", "file", "plaid", "provider"]);
export type LedgerSource = z.infer<typeof ledgerSourceSchema>;

/** An ISO `YYYY-MM-DD` calendar date. Validated at the boundary so a bad date
 *  (a typo, a mis-mapped feed field) fails here with a clear message instead of
 *  as a cryptic Postgres driver error at the `INSERT`. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date YYYY-MM-DD");

/**
 * The canonical event every writer maps TO. Signs are caller-canonical: a buy
 * is a positive `quantity` with a negative cash `amount`; a sell is a negative
 * `quantity` with a positive `amount`. `quantity`/`unitPrice` are null for
 * pure-cash events (dividend/interest/deposit/withdrawal/fee). `externalId` is
 * the feed's stable id (Plaid `investment_transaction_id` / OFX `FITID`) when
 * present; null for manual entry. `basisUnknown`, when set, is the reason a
 * transfer-in lot has no acquisition record (the basis hole) — never a zero.
 *
 * Numeric fields are `.finite()`: `z.number()` alone admits `NaN`/`Infinity`,
 * which Postgres `numeric` would store as `'NaN'` and which would poison the
 * fingerprint (`NaN.toFixed(8)` → `"NaN"`) — reject them at the boundary.
 */
export const ledgerEventInputObject = z.object({
  accountId: z.string(),
  type: ledgerEventTypeSchema,
  /** ISO `YYYY-MM-DD`, the date the event occurred (trade date preferred). */
  tradeDate: isoDate,
  settleDate: isoDate.nullable().default(null),
  ticker: z.string().nullable().default(null),
  /** Signed share delta; null for cash events AND for a `split` (which rebases
   *  open lots by a ratio rather than moving shares). */
  quantity: z.number().finite().nullable().default(null),
  unitPrice: z.number().finite().nullable().default(null),
  /** Signed cash impact on the account. */
  amount: z.number().finite(),
  fee: z.number().finite().nullable().default(null),
  currency: z.string().default("USD"),
  source: ledgerSourceSchema,
  externalId: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  basisUnknown: z.string().nullable().default(null),
  /** Reason a `sell`'s cash proceeds are unknown — set by a feed normalizer
   *  (FIX-775's OFX importer on a no-`TOTAL`/no-`UNITPRICE` sell) when the file
   *  couldn't supply the amount. Realized-gains derivation (FIX-874) nulls
   *  proceeds/gain and excludes such a row rather than fabricating a full loss
   *  off a placeholder `amount:0`; a genuine $0 sale leaves this null. Import-only
   *  — the manual route forces it null so a caller can't blank a real sale's
   *  proceeds. */
  proceedsUnknown: z.string().nullable().default(null),
  /** Lot identity this event OPENS (FIX-895) — the stable key of the lot a
   *  share-ADDING event (buy / transfer-in, `quantity > 0`) creates. Null for
   *  every feed that carries no lot identity (OFX / Plaid / manual). The
   *  cross-field {@link refineLedgerEvent} enforces it appears only on a
   *  share-adding event. */
  lotKey: z.string().nullable().default(null),
  /** Lot identity this event CLOSES (FIX-895) — the `lotKey` of the lot a
   *  share-REMOVING event (sell / transfer-out, `quantity < 0`) disposes. Null ⇒
   *  FIFO (the default for feeds carrying no lot identity). The cross-field
   *  {@link refineLedgerEvent} enforces it appears only on a share-removing
   *  event. */
  closesLotKey: z.string().nullable().default(null),
  /** Corporate-action payload (FIX-876). Non-null ONLY for a `split`, where it
   *  parses as {@link splitAttributesSchema}; null for every other kind. The
   *  cross-field {@link refineLedgerEvent} enforces that boundary. `unknown` so
   *  the schema stays forward-compatible to future corporate actions without a
   *  discriminated-union churn here (the repository stores it as jsonb). */
  attributes: z.unknown().nullable().default(null),
});

/** The minimal cross-field shape {@link refineLedgerEvent} reads — typed as the
 *  subset so the same refine applies to both the full input schema and the
 *  manual-entry omit (`recordEventSchema`, which drops `source`/`externalId`). */
type LedgerEventRefinable = {
  type: LedgerEventType;
  ticker: string | null;
  quantity: number | null;
  amount: number;
  // Optional because `z.unknown()` makes the inferred key optional; a missing
  // key reads the same as an explicit `null` below (both fail the split parse
  // and pass the non-split "must be null" branch).
  attributes?: unknown;
  // Optional because the manual-entry omit (`recordEventSchema`) drops these two
  // keys entirely (FIX-895); a missing key reads the same as `null` (`!= null`
  // below), so a manual event trivially passes the lot-linkage boundary.
  lotKey?: string | null;
  closesLotKey?: string | null;
};

/**
 * Cross-field validation shared by the full input schema and the manual-entry
 * omit. A `split` MUST carry valid `{ numerator, denominator }` attributes, a
 * ticker, a null `quantity`, and a zero `amount` (it rebases open lots, it does
 * not move shares or cash). Every OTHER kind MUST leave `attributes` null (a
 * stray corporate-action payload on a buy is bad data, rejected at the boundary).
 */
export function refineLedgerEvent(data: LedgerEventRefinable, ctx: z.RefinementCtx): void {
  if (data.type === "split") {
    if (!splitAttributesSchema.safeParse(data.attributes).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attributes"],
        message: "a split requires { numerator, denominator } as positive integers",
      });
    }
    if (data.ticker === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ticker"], message: "a split requires a ticker" });
    }
    if (data.quantity !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "a split carries no share quantity" });
    }
    if (data.amount !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "a split carries no cash amount" });
    }
  } else if (data.attributes != null) {
    // `!= null` catches both null and a missing key (undefined); only a real
    // payload on a non-split event is rejected.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["attributes"],
      message: "attributes is only valid on a split event",
    });
  }
  // Lot-linkage boundary (FIX-895), mirroring the split-attributes discipline
  // above: lot identity travels ONLY on a share MOVE, and only in the matching
  // direction. `lotKey` OPENS a lot, so it is valid only on a share-adding event
  // (a positive quantity — buy / transfer-in); `closesLotKey` CLOSES a lot, so it
  // is valid only on a share-removing event (a negative quantity — sell /
  // transfer-out). Both must be null on cash events and splits (no lot to open or
  // close) — their null quantity fails the sign checks below, so no extra branch
  // is needed. This same rule is enforced at the repository's
  // `assertShareEventInvariant` because the file importer bypasses zod.
  if (data.lotKey != null && !(data.quantity != null && data.quantity > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lotKey"],
      message: "lotKey is only valid on a share-adding event (positive quantity)",
    });
  }
  if (data.closesLotKey != null && !(data.quantity != null && data.quantity < 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["closesLotKey"],
      message: "closesLotKey is only valid on a share-removing event (negative quantity)",
    });
  }
}

export const ledgerEventInputSchema = ledgerEventInputObject.superRefine(refineLedgerEvent);
export type LedgerEventInput = z.infer<typeof ledgerEventInputSchema>;

/**
 * The result of an ingest call. `inserted` + `deduplicated` always sum to the
 * number of events passed (a row collided on `fingerprint` or
 * `(source, external_id)` is counted, not an error). `errors` carries rejections
 * (none on the manual path today; the slot is here for the feed writers).
 * A fixed-shape handler output (not a generator output), so BP-016 does not
 * apply — mirrors `importReportSchema`.
 */
export const ingestReportSchema = z.object({
  inserted: z.number(),
  deduplicated: z.number(),
  errors: z.array(z.object({ reason: z.string() })),
});
export type IngestReport = z.infer<typeof ingestReportSchema>;

/**
 * One persisted ledger row, numerics coerced to JS `number` and timestamps to
 * ISO-8601 at the repository read boundary (the FIX-772 `mapHolding` precedent).
 * A `voidedAt` row is a tombstone — excluded from lot derivation and rollups,
 * never physically deleted (audit trail).
 */
export type LedgerRow = {
  id: string;
  accountId: string;
  userId: string;
  type: LedgerEventType;
  ticker: string | null;
  tradeDate: string;
  settleDate: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  fee: number | null;
  currency: string;
  source: LedgerSource;
  externalId: string | null;
  description: string | null;
  basisUnknown: string | null;
  /** Reason a `sell`'s proceeds are unknown (import placeholder); null otherwise.
   *  Drives FIX-874's realized-gains exclusion. */
  proceedsUnknown: string | null;
  /** Lot identity this event opened (FIX-895) — set on a share-adding tax-lot
   *  buy, null for every FIFO feed. */
  lotKey: string | null;
  /** Lot identity this event closes (FIX-895) — set on a share-removing tax-lot
   *  disposal, null ⇒ FIFO. */
  closesLotKey: string | null;
  /** Corporate-action payload (FIX-876) — the split ratio for a `split` row,
   *  null for every other kind. Typed here (not `unknown`) so `deriveLots` reads
   *  `numerator`/`denominator` with types. */
  attributes: SplitAttributes | null;
  voidedAt: string | null;
  createdAt: string;
};
