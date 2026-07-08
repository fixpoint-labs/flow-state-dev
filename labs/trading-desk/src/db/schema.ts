/**
 * App-owned relational schema for the portfolio domain (FIX-772).
 *
 * These are the trading-desk's OWN tables — distinct from the framework's
 * `@flow-state-dev/store-postgres` tables (which live in `public`). They sit in
 * a dedicated `app` Postgres schema so the two never collide and so drizzle-kit,
 * scoped via `schemaFilter: ["app"]`, never touches the framework's tables.
 *
 * The model unrolls what used to be an inline `holdings` array on each account
 * resource (`accountStateSchema.holdings`) into a real `(account_id, ticker)`
 * row table. `ticker` is the cross-account rollup key (household = `user_id`),
 * which is exactly the query shape the household / sleeves / review-loop issues
 * (FIX-762/771/763) need and the document model could not serve.
 *
 * Money/quantity columns are `numeric` (no float drift in storage). Drizzle
 * returns `numeric` as a string on both the node-postgres and pglite drivers,
 * so the repository's row mapper coerces them to `number` at the read boundary
 * (see `repository.ts`). Timestamps are `timestamptz` with `mode: "string"` so
 * both drivers return a stable string the mapper normalizes to ISO-8601.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** The app's private Postgres schema. The framework owns `public`. */
export const appSchema = pgSchema("app");

/**
 * One brokerage/retirement account. `id` preserves the existing opaque
 * `accountId` (the former collection-key suffix). `user_id` is the household
 * key the cross-account rollups group on. `risk_mandate` stays an opaque
 * nullable text column (FIX-752); it becomes a typed FK only once a mandate
 * table exists (FIX-761).
 */
export const accounts = appSchema.table(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currency: text("currency").notNull().default("USD"),
    cashBalance: numeric("cash_balance").notNull().default("0"),
    riskMandate: text("risk_mandate"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

/**
 * One position, keyed `(account_id, ticker)` — the inline holdings array,
 * unrolled to rows. `cost_basis` is average cost (informational, nullable).
 * The `holdings_ticker_idx` serves the cross-account `GROUP BY ticker` rollup
 * (FIX-762). Deleting an account cascades its holdings via the FK.
 */
export const holdings = appSchema.table(
  "holdings",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    quantity: numeric("quantity").notNull(),
    costBasis: numeric("cost_basis"),
    acquiredDate: date("acquired_date", { mode: "string" }),
    // Data-integrity flag (FIX-876). Null for a normal row; `inconsistent_history`
    // when an acquired ticker's disposals exceed everything ever held (impossible
    // without an unaccounted corporate action) — the position is materialized as a
    // FLAGGED zero-quantity row and surfaced for review rather than silently
    // deleted. A recorded split that explains the gap self-heals the row back to
    // null on the next materialization.
    dataQuality: text("data_quality"),
    // Two-level asset taxonomy (FIX-773). `asset_class` is the allocation bucket
    // every drift/exposure/mandate consumer groups on; `asset_type` routes
    // display + valuation. Both default to `equity` so the pre-taxonomy rows
    // backfill as equity (unchanged behaviour). `attributes` carries the
    // per-type JSONB, discriminated by `kind` — the default MUST serialize to
    // `{"kind":"none"}` (NOT `{}`), or `mapHolding` would throw parsing a
    // backfilled row against the `kind`-discriminated union.
    assetClass: text("asset_class").notNull().default("equity"),
    assetType: text("asset_type").notNull().default("equity"),
    attributes: jsonb("attributes").notNull().default({ kind: "none" }),
    // Provenance for `asset_class`: `true` once a user sets the class by hand, so
    // auto-classification (the ledger-materialization + import paths) preserves
    // the override instead of overwriting it on the next re-derivation. Default
    // `false` — auto-classified rows stay re-classifiable.
    assetClassManual: boolean("asset_class_manual").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.ticker] }),
    index("holdings_ticker_idx").on(table.ticker),
  ],
);

/**
 * The transaction ledger (FIX-774) — one append-only row per cash/share event,
 * realizing the `accountLedgerSchema` "FUTURE SEAM" as a table (not a resource).
 * Every writer (manual entry now; FIX-775 file import and FIX-853 Plaid sync
 * later) ingests through one idempotent contract, so the two dedup keys ship now
 * even though only manual entry populates the table in this PR:
 *
 * - `fingerprint` — a canonical content hash, always computed; the
 *   `(account_id, fingerprint)` unique index catches a duplicate that has no
 *   external id (a manual re-submit; later, the same trade arriving from two
 *   feeds, once the feed normalizers in FIX-775/FIX-853 map onto this recipe).
 * - `(source, external_id)` — a PARTIAL unique index (only when `external_id`
 *   is set) that catches a same-source retry. Manual rows leave `external_id`
 *   null and dedup on `fingerprint` alone.
 *
 * `voided_at` is a tombstone (a correction now; a Plaid cancellation later) —
 * derivation and rollups ignore voided rows, but they are never deleted (audit
 * trail). `user_id` is denormalized for the household ownership guard and the
 * cross-account rollups. `type`/`source` stay `text` (the enum is enforced at
 * the zod boundary) so a new event kind needs no enum-alter migration. Money and
 * quantity are `numeric` (exact in storage; the repository coerces to JS number
 * at the read boundary, RISK-P5).
 */
export const ledgerEvents = appSchema.table(
  "ledger_events",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    ticker: text("ticker"),
    tradeDate: date("trade_date", { mode: "string" }).notNull(),
    settleDate: date("settle_date", { mode: "string" }),
    quantity: numeric("quantity"),
    unitPrice: numeric("unit_price"),
    amount: numeric("amount").notNull(),
    fee: numeric("fee"),
    currency: text("currency").notNull().default("USD"),
    source: text("source").notNull(),
    externalId: text("external_id"),
    fingerprint: text("fingerprint").notNull(),
    description: text("description"),
    basisUnknown: text("basis_unknown"),
    // Corporate-action payload (FIX-876) — the `{ numerator, denominator }` split
    // ratio for a `split` event, null for every other kind (enforced at the zod
    // boundary in `ledger-schema.ts`). A nullable jsonb column (the
    // `holdings.attributes` precedent) so future corporate actions need no further
    // migration. Deliberately EXCLUDED from the content fingerprint (a split's
    // numerator/denominator don't key dedup — see `computeFingerprint`).
    attributes: jsonb("attributes"),
    voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ledger_events_account_idx").on(table.accountId),
    index("ledger_events_user_ticker_idx").on(table.userId, table.ticker),
    uniqueIndex("ledger_events_fingerprint_uq").on(table.accountId, table.fingerprint),
    // Account-scoped, NOT global: an external id is only unique within its feed
    // AND account (an OFX FITID repeats across accounts at the same broker), so a
    // global `(source, external_id)` index would silently drop a second account's
    // legitimate row via ON CONFLICT DO NOTHING. Scope it to the account.
    uniqueIndex("ledger_events_account_source_external_uq")
      .on(table.accountId, table.source, table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);
