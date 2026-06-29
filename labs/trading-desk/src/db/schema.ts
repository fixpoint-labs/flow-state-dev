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
import type { Tripwire } from "@/src/flows/portfolio/thesis-schema";

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
 * The per-position thesis record (FIX-760) — the durable "why" behind a holding.
 * Keyed household × ticker (`(user_id, ticker)` unique), NOT per account: intent
 * is about the name, account location is a tax question. Deliberately NOT FK'd to
 * `holdings` — a thesis can outlive an exited position (a post-mortem) and exist
 * before a buy settles (adopt-then-buy), so it stands on its own `(user_id,
 * ticker)` key.
 *
 * `tripwires` is a `jsonb` array of the structured observable falsifiers (the
 * enum/shape is enforced at the zod boundary in `thesis-schema.ts`), so adding a
 * tripwire kind needs no enum-alter migration (the `ledger.type` text-column
 * precedent). `target_price` / `stop_price` are `numeric` (coerced to JS number
 * at the read boundary, RISK-P5). `source_session_id` links the originating
 * analysis report (no FK — sessions are framework-owned `public.*` rows). The
 * `theses_user_id_idx` serves the household fan-out the review loop (FIX-763) and
 * the UI list both read.
 */
export const theses = appSchema.table(
  "theses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    entryRationale: text("entry_rationale").notNull(),
    invalidationConditions: text("invalidation_conditions"),
    tripwires: jsonb("tripwires").$type<Tripwire[]>().notNull().default(sql`'[]'::jsonb`),
    timeHorizon: text("time_horizon"),
    targetPrice: numeric("target_price"),
    stopPrice: numeric("stop_price"),
    sourceSessionId: text("source_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("theses_user_ticker_uq").on(table.userId, table.ticker),
    index("theses_user_id_idx").on(table.userId),
  ],
);
