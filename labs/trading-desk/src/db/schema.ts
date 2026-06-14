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
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
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
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.ticker] }),
    index("holdings_ticker_idx").on(table.ticker),
  ],
);
