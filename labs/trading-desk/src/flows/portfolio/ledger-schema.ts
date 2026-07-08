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
 *  signed `quantity` (they move lots); the rest are cash events. Stored as a
 *  plain `text` column — the enum is enforced here at the boundary, so adding a
 *  kind (e.g. when FIX-773 lands non-equity events) needs no enum-alter migration. */
export const ledgerEventTypeSchema = z.enum([
  "buy",
  "sell",
  "dividend",
  "interest",
  "deposit",
  "withdrawal",
  "transfer",
  "fee",
]);
export type LedgerEventType = z.infer<typeof ledgerEventTypeSchema>;

/** Which feed wrote a row. `manual` is the only writer in this PR; `file`
 *  (FIX-775) and `plaid` (FIX-853) write through the same contract. */
export const ledgerSourceSchema = z.enum(["manual", "file", "plaid"]);
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
export const ledgerEventInputSchema = z.object({
  accountId: z.string(),
  type: ledgerEventTypeSchema,
  /** ISO `YYYY-MM-DD`, the date the event occurred (trade date preferred). */
  tradeDate: isoDate,
  settleDate: isoDate.nullable().default(null),
  ticker: z.string().nullable().default(null),
  /** Signed share delta; null for cash events. */
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
});
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
  voidedAt: string | null;
  createdAt: string;
};
