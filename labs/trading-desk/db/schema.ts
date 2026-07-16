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
  integer,
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
    // Reason a `sell`'s proceeds are unknown — set by a feed normalizer (FIX-775
    // OFX importer) on a no-`TOTAL`/no-`UNITPRICE` sell. FIX-874's realized-gains
    // derivation nulls proceeds/gain and excludes such a row rather than
    // fabricating a loss off a placeholder `amount:0`; null for a genuine sale.
    proceedsUnknown: text("proceeds_unknown"),
    // Lot identity (FIX-895), additive + nullable. `lot_key` is the stable key of
    // the lot a share-ADDING tax-lot event opens; `closes_lot_key` names the lot a
    // share-REMOVING tax-lot disposal closes (null ⇒ FIFO). Both null for every
    // existing feed (OFX / Plaid / manual), so those rows behave bit-for-bit as
    // before. The linkage fields join `computeFingerprint` UNCONDITIONALLY (a
    // sell's `lot_key` is null but its `closes_lot_key` distinguishes it), safe on
    // a cleared ledger under the fresh-start wipe. The boundary rule (each field
    // valid only on its matching share direction) is enforced at the zod refine
    // AND the shared `assertShareEventInvariant`.
    lotKey: text("lot_key"),
    closesLotKey: text("closes_lot_key"),
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

/**
 * Persisted realized capital gains (FIX-874) — one row per (disposal event ×
 * consumed FIFO lot), the tax-facing artifact `deriveLots(...).disposals`
 * discards today. Materialized on the same ingest/void seam as positions
 * (`materializeRealizedGains`), so it stays live and retracts on void; matches
 * Form 8949's per-lot granularity (a single sale can be part short, part long).
 *
 * The two provenance axes are stored independently: `acquired_date`/`term`
 * follow the acquisition-DATE axis (null/`"unknown"` for a transfer-in or an
 * over-sell remainder), while `cost_basis`/`gain`/`proceeds` follow the
 * amount-known axis (null when basis unknown, proceeds unknown, or the sell
 * currency differs from the lot's). `proceeds` is nullable ONLY for a
 * proceeds-unknown import placeholder — a genuine $0 sale stores `0`.
 *
 * Concurrency: the table is fully recomputed (delete-all + re-insert per
 * account) inside the ingest/void transaction under a per-account
 * `pg_advisory_xact_lock`; the `(disposal_event_id, lot_index)` unique index is
 * defense-in-depth for the empty-table double-insert window.
 */
export const realizedGains = appSchema.table(
  "realized_gains",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    disposedDate: date("disposed_date", { mode: "string" }).notNull(),
    acquiredDate: date("acquired_date", { mode: "string" }), // null when acquisition unknown
    quantity: numeric("quantity").notNull(),
    proceeds: numeric("proceeds"), // null only for a proceeds-unknown import placeholder
    costBasis: numeric("cost_basis"), // null when basis unknown
    gain: numeric("gain"), // null when proceeds or basis unknown
    term: text("term").notNull(), // 'short' | 'long' | 'unknown' (enum at the zod boundary)
    currency: text("currency").notNull(), // the disposal sell event's currency (row-level)
    basisUnknown: text("basis_unknown"), // reason string, mirrors the ledger
    disposalEventId: text("disposal_event_id").notNull(),
    lotIndex: integer("lot_index").notNull(), // ordinal within the sell — part of the derived-row identity
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("realized_gains_account_idx").on(table.accountId),
    index("realized_gains_user_ticker_idx").on(table.userId, table.ticker),
    index("realized_gains_user_disposed_idx").on(table.userId, table.disposedDate),
    uniqueIndex("realized_gains_disposal_lot_uq").on(table.disposalEventId, table.lotIndex),
  ],
);

/**
 * Durable last-known price per instrument (FIX-823) — one GLOBAL row per ticker,
 * so any consumer (Portfolio UI, analysis seed, the future household view in
 * FIX-762) can derive `value = quantity × price` from persisted state without a
 * live fetch, and label how stale that price is.
 *
 * Keyed by `ticker` ALONE (not `(user_id, ticker)`): a ticker's last-known price
 * is a global, public fact — the same for everyone — and one row per ticker is
 * exactly FIX-762's cross-account `GROUP BY ticker` shape. This retires the
 * ephemeral user-scoped `portfolioQuotes` FSD resource; the durable table holds
 * LIVE prices only (the `getQuotes` write path filters fixture-mode + null-priced
 * quotes), so demo data can never overwrite the shared row.
 *
 * `price` is `numeric` (exact in storage, coerced to a JS `number` at the read
 * boundary, the FIX-772 rule) and `NOT NULL` — an unresolvable ticker gets NO
 * row, so a failed refresh never nulls a good last-known price. `as_of` is the
 * price's own market/quote time (nullable-honest, the staleness label); it is
 * distinct from `fetched_at`, when we cached it (cache age). `source` records
 * provenance (`'live'`, extensible to provider names) — never `'fixture'`.
 */
export const quotes = appSchema.table("quotes", {
  ticker: text("ticker").primaryKey(),
  price: numeric("price").notNull(),
  asOf: timestamp("as_of", { withTimezone: true, mode: "string" }),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

/**
 * Per-ticker sector classification (FIX-762) — one GLOBAL row per ticker, filled
 * lazily from the existing Yahoo sector resolver (`resolveSector`). Backs the
 * Health view's sector-exposure axis, the one household breakdown with no data
 * source until now (asset class already rides on each holding row; the quote is
 * an input).
 *
 * Keyed by `ticker` ALONE, not `(user_id, ticker)`: a ticker's sector is a
 * global, public, near-immutable fact — the same reasoning `app.quotes` (FIX-823)
 * applies to price, so the two sit side by side as the lab's first per-ticker
 * reference tables (a minimal security-master seam FIX-801's ETF profiles can
 * later join). No TTL: sector rarely changes, so rows are refreshed manually
 * (a `source` column leaves room), never on a timer.
 *
 * `sector` is nullable in the column, but the fill path NEVER persists a null (a
 * failed Yahoo resolution is returned to the caller but not written), so a
 * transient provider outage can't permanently blank a ticker — it is retried on a
 * later request. `industry` is deliberately not stored: no consumer (BP-038).
 */
export const instrumentClassifications = appSchema.table("instrument_classifications", {
  ticker: text("ticker").primaryKey(),
  sector: text("sector"),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

/**
 * A household's tax profile (FIX-874) — one row per user. Drives the upper-bound
 * current-year estimate (OQ #7): the user's marginal ordinary rate and long-term
 * capital-gains rate are applied directly to each bucket. `filing_status` sets
 * only the Schedule-D loss cap; the flat state rate is optional. Rate columns are
 * `numeric` on the 0..100 (percent) scale, coerced to number at the read
 * boundary and divided by 100 by the estimator.
 */
export const taxProfiles = appSchema.table("tax_profiles", {
  userId: text("user_id").primaryKey(),
  filingStatus: text("filing_status").notNull(), // enum at the zod boundary
  marginalOrdinaryRatePct: numeric("marginal_ordinary_rate_pct").notNull(),
  ltcgRatePct: numeric("ltcg_rate_pct").notNull(),
  stateRatePct: numeric("state_rate_pct"), // null = federal-only
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

/**
 * One-time rollout markers (FIX-895) — a tiny audit table recording that a
 * destructive, operator-run rollout step has been performed. Its only marker in
 * v1 is the fresh-start ledger wipe (`ledger-reset` script): the lot-identity
 * fingerprint recipe (`|lk|ck|`) is only safe on a cleared ledger, so the deploy
 * migrator refuses to proceed when `ledger_events` still holds legacy rows and
 * this marker is absent. Not a domain table — never read by the repository.
 */
export const rolloutMarkers = appSchema.table("rollout_markers", {
  marker: text("marker").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

/** The `rollout_markers` row the fresh-start ledger wipe (`ledger-reset` script)
 *  stamps and the deploy migrator checks for (FIX-895). Lives here — a
 *  side-effect-free module — so both scripts share the one string. */
export const FRESH_START_MARKER = "fresh-start-lotkey-fingerprint";
