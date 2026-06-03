/**
 * Pure, browser-safe portfolio domain schemas + key helpers.
 *
 * This is the load-bearing leaf for Spine B (the portfolio data model). It
 * imports ONLY `zod` — no `@flow-state-dev/core` — so it runs identically in
 * the client (the import dialog's live preview) and in the server action, and
 * is unit-testable without a runtime (BP-019: leaf module, no cycles).
 *
 * The model is two collections keyed by `(accountId, ticker)`:
 *   - one `account` resource per account (keyed `accountId`),
 *   - one `holding` resource per `(accountId, ticker)` pair (keyed
 *     `{accountId}__{ticker}`).
 * Per-holding keying gives last-write-wins isolation under the no-CAS
 * filesystem store: importing into one account never clobbers another, and the
 * same ticker in two accounts is two distinct holdings. A single portfolio blob
 * would re-serialize the whole map on every row write and lose that isolation.
 *
 * These are RESOURCE STATE schemas, not generator outputs — `.default()` /
 * `.nullable()` are fine here (BP-016 only constrains generator output shapes).
 */
import { z } from "zod";

/** Account tax/registration type. Drives no logic in v1 (display chip only),
 *  but it is the field a future tax-lot / wash-sale model keys off. */
export const accountTypeSchema = z.enum(["taxable", "IRA", "Roth", "401k"]);
export type AccountType = z.infer<typeof accountTypeSchema>;

/**
 * One brokerage/retirement account. `cashBalance` lives here (it is per-account,
 * not per-ticker, so it is NOT a holding). Single-currency per account in v1;
 * multi-currency is a documented future seam.
 *
 * FUTURE SEAM — realized P/L + dividends: a future `accountLedgerSchema`
 * collection (`pattern: "ledger/*"`, keyed by event id) records cash events.
 * Not built now; this comment is the only obligation v1 owes it.
 */
export const accountStateSchema = z.object({
  /** Stable id, also the `accounts/{accountId}` collection-key suffix.
   *  Generated `crypto.randomUUID()` at create time (opaque, collision-free —
   *  see spec §12.3). */
  accountId: z.string(),
  name: z.string().min(1).max(80),
  type: accountTypeSchema,
  /** ISO 4217. Single-currency per account in v1. */
  currency: z.string().length(3).default("USD"),
  /** Settled cash in the account's currency. Fractional allowed. v1 uses a
   *  JS float — display approximation, not precise accounting (RISK-P5). */
  cashBalance: z.number().default(0),
  /** Audit timestamps. Plain ISO strings. */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AccountState = z.infer<typeof accountStateSchema>;

/**
 * One holding — the `(accountId, ticker)` unit. Both identity fields are stored
 * explicitly so a row is self-describing without parsing the storage key.
 *
 * `costBasis` is AVERAGE cost per share, INFORMATIONAL only — it is tax-wrong
 * (wash sales, specific-lot selection, holding-period are not modeled). The UI
 * must not imply tax accuracy.
 *
 * FUTURE SEAM — tax-lots: add `lots: z.array(lotSchema)` later; `costBasis`
 * becomes the derived average over lots and `acquiredDate` becomes
 * `min(lot.date)`. No rename — these v1 avg-cost fields are forward-compatible.
 */
export const holdingStateSchema = z.object({
  accountId: z.string(),
  /** Normalized upper-case ticker (see `portfolio-csv.ts` validation). */
  ticker: z.string(),
  /** Fractional shares supported (e.g. 0.4213 of BRK.A). */
  quantity: z.number(),
  /** Average cost per share in the account's currency. Blank import → null. */
  costBasis: z.number().nullable().default(null),
  /** Earliest acquisition date (earliest lot date once lots exist). */
  acquiredDate: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HoldingState = z.infer<typeof holdingStateSchema>;

/**
 * Encode the composite holdings key. `__` (double underscore) cannot collide:
 * tickers are normalized to `[A-Z0-9.\-]` and accountIds are UUIDs/slugs, so
 * neither contains `__`. `.` (BRK.B) is allowed in a ticker but is not the
 * separator, so it round-trips cleanly through `parseHoldingKey`.
 */
export function holdingKey(accountId: string, ticker: string): string {
  return `${accountId}__${ticker}`;
}

/** Inverse of {@link holdingKey}. Splits on the FIRST `__` so a ticker that
 *  somehow contained `__` would keep its tail intact (defensive — validation
 *  forbids it). */
export function parseHoldingKey(key: string): {
  accountId: string;
  ticker: string;
} {
  const i = key.indexOf("__");
  if (i === -1) return { accountId: key, ticker: "" };
  return { accountId: key.slice(0, i), ticker: key.slice(i + 2) };
}

/** The four canonical CSV columns the parser maps every brokerage export onto.
 *  Shared by the parser and the import action. */
export type CanonicalRow = {
  ticker: string;
  quantity: number;
  /** Average cost per share; null when the export carries no cost column. */
  costBasis: number | null;
  /** ISO `YYYY-MM-DD`; null when absent or unparseable (a bad date is a
   *  warning, not a row rejection). */
  acquiredDate: string | null;
};

/** Import merge mode. `upsert` (default) is non-destructive; `replace-account`
 *  is the explicit, confirmed full-snapshot mode (RISK-P6 — non-atomic). */
export type ImportMode = "upsert" | "replace-account";
