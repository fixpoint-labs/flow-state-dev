/**
 * Portfolio repository (FIX-772) — the typed data-access layer over the
 * app-owned `app.accounts` / `app.holdings` tables.
 *
 * This is the single source of truth for accounts and holdings. Action handlers,
 * the analysis seed, and the read API route call these functions instead of
 * mutating an FSD resource. It is a thin module of typed functions (a factory
 * over a Drizzle `Db` so tests can inject a PGlite-backed instance), not a class
 * hierarchy or a generic base repository — multi-row writes get a transaction,
 * single-table reads/writes stay flat (no abstraction the spec did not ask for).
 *
 * Numeric coercion is load-bearing: Drizzle returns `numeric` columns as strings
 * on both drivers, so {@link mapAccount}/{@link mapHolding} coerce money and
 * quantity to JS `number` (and timestamps to ISO-8601) at the read boundary.
 * Nothing downstream — the seed snapshot's `quantity × price` math, the UI
 * rollups — ever sees a string.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  AccountState,
  AccountType,
  CanonicalRow,
  Holding,
  ImportMode,
} from "@/src/flows/portfolio/portfolio-schema";
import type { Db } from "./client";
import { accounts, holdings } from "./schema";

/** Account-level fields (everything in {@link AccountState} except the inline
 *  `holdings` array, plus the `userId` household key the table carries). */
export type AccountRow = Omit<AccountState, "holdings"> & { userId: string };

/** A holding row, tagged with the account it belongs to (the table key). */
export type HoldingRow = Holding & { accountId: string };

/** Fields a caller supplies to create or update an account. Timestamps and
 *  defaults (`currency`, `cashBalance`) are owned by the table/repository. */
export type AccountInput = {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  currency?: string;
  cashBalance?: number;
  riskMandate?: string | null;
};

/**
 * The portfolio data-access surface. Foundation only — the cross-account
 * aggregate queries (household rollups, concentration, per-sleeve cash) are
 * added by the consuming issues (FIX-762/771/763) on top of these base reads.
 */
export interface PortfolioRepository {
  /** All of a household's accounts (account-level fields only), oldest first. */
  getAccountsForUser(userId: string): Promise<AccountRow[]>;
  /** A household's accounts and every holding across them — the seed + UI read.
   *  The same ticker in two accounts comes back as two holding rows. */
  getPortfolio(userId: string): Promise<{ accounts: AccountRow[]; holdings: HoldingRow[] }>;
  /** Create or update an account. The update path never touches holdings (they
   *  are a separate table) and preserves `created_at`. */
  upsertAccount(input: AccountInput): Promise<AccountRow>;
  /** Delete an account (and, via the FK cascade, its holdings) — only when it
   *  belongs to `userId`. Scoping the mutation to the household is the security
   *  boundary the old user-scoped resource delete enforced implicitly; a delete
   *  for another user's account is a no-op. */
  deleteAccount(id: string, userId: string): Promise<void>;
  /**
   * Write imported holdings for one account, transactionally.
   * - `upsert` (the non-destructive default): each row replaces the matching
   *   `(account_id, ticker)` in place; tickers absent from the import are left
   *   untouched; new tickers are inserted. The quantity-weighted-average dedupe
   *   of duplicate tickers *within* one import already happened upstream in the
   *   CSV parser — this never averages existing vs. imported quantities.
   * - `replace-account`: the account's holdings become exactly the imported
   *   rows (delete-all + insert), atomically — no partial-state window.
   */
  upsertHoldings(accountId: string, rows: CanonicalRow[], mode: ImportMode): Promise<void>;
  /** Remove a single position — only when its account belongs to `userId` (the
   *  same household-scoping security boundary as {@link deleteAccount}). */
  deleteHolding(accountId: string, ticker: string, userId: string): Promise<void>;
}

/** Coerce a Drizzle `numeric` (string) to a JS number; pass `null` through.
 *  Note: this narrows arbitrary-precision `numeric` to a JS double — fine for
 *  this app's display-approximation money/quantities (RISK-P5), but a future
 *  exact-decimal consumer (tax lots) should read the string, not this. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** Map an accounts row to the {@link AccountRow} shape, coercing numerics and
 *  normalizing the timestamp strings to ISO-8601. */
function mapAccount(row: typeof accounts.$inferSelect): AccountRow {
  return {
    accountId: row.id,
    userId: row.userId,
    name: row.name,
    type: row.type as AccountType,
    currency: row.currency,
    cashBalance: Number(row.cashBalance),
    riskMandate: row.riskMandate,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Map a holdings row to the {@link HoldingRow} shape, coercing numerics. */
function mapHolding(row: typeof holdings.$inferSelect): HoldingRow {
  return {
    accountId: row.accountId,
    ticker: row.ticker,
    quantity: Number(row.quantity),
    costBasis: toNumber(row.costBasis),
    acquiredDate: row.acquiredDate,
  };
}

/**
 * Project a flat {@link getPortfolio} result into the inline-holdings
 * {@link AccountState} shape the analysis seed (`build-portfolio-context`) and
 * the Portfolio UI consume. Pure — no DB access — so the seed and the read API
 * route share one nesting rule. Holdings are grouped by account; an account
 * with none gets an empty array.
 */
export function toAccountStates(portfolio: {
  accounts: AccountRow[];
  holdings: HoldingRow[];
}): AccountState[] {
  const byAccount = new Map<string, Holding[]>();
  for (const h of portfolio.holdings) {
    const list = byAccount.get(h.accountId) ?? [];
    list.push({
      ticker: h.ticker,
      quantity: h.quantity,
      costBasis: h.costBasis,
      acquiredDate: h.acquiredDate,
    });
    byAccount.set(h.accountId, list);
  }
  return portfolio.accounts.map((a) => ({
    accountId: a.accountId,
    name: a.name,
    type: a.type,
    currency: a.currency,
    cashBalance: a.cashBalance,
    holdings: byAccount.get(a.accountId) ?? [],
    riskMandate: a.riskMandate,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}

/** Build a {@link PortfolioRepository} over a Drizzle handle (real Postgres in
 *  deployment, embedded PGlite in dev or tests). */
export function createPortfolioRepository(db: Db): PortfolioRepository {
  return {
    async getAccountsForUser(userId) {
      const rows = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .orderBy(accounts.createdAt);
      return rows.map(mapAccount);
    },

    async getPortfolio(userId) {
      const accountRows = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .orderBy(accounts.createdAt);
      const accountIds = accountRows.map((a) => a.id);
      const holdingRows =
        accountIds.length === 0
          ? []
          : await db.select().from(holdings).where(inArray(holdings.accountId, accountIds));
      return { accounts: accountRows.map(mapAccount), holdings: holdingRows.map(mapHolding) };
    },

    async upsertAccount(input) {
      const values = {
        id: input.id,
        userId: input.userId,
        name: input.name,
        type: input.type,
        currency: input.currency ?? "USD",
        cashBalance: String(input.cashBalance ?? 0),
        riskMandate: input.riskMandate ?? null,
      };
      const [row] = await db
        .insert(accounts)
        .values(values)
        .onConflictDoUpdate({
          target: accounts.id,
          // created_at is intentionally absent — the update preserves it.
          set: {
            name: values.name,
            type: values.type,
            currency: values.currency,
            cashBalance: values.cashBalance,
            riskMandate: values.riskMandate,
            updatedAt: sql`now()`,
          },
          // Ownership guard: only update when the existing row belongs to the
          // caller. A conflict on another user's account id leaves their row
          // untouched (no row returned) — the household boundary the old
          // user-scoped resource upsert enforced.
          setWhere: eq(accounts.userId, values.userId),
        })
        .returning();
      if (row === undefined) {
        throw new Error(
          `Account ${input.id} is not owned by the requesting user.`,
        );
      }
      return mapAccount(row);
    },

    async deleteAccount(id, userId) {
      await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
    },

    async upsertHoldings(accountId, rows, mode) {
      const values = rows.map((r) => ({
        accountId,
        ticker: r.ticker,
        quantity: String(r.quantity),
        costBasis: r.costBasis === null ? null : String(r.costBasis),
        acquiredDate: r.acquiredDate,
      }));
      await db.transaction(async (tx) => {
        if (mode === "replace-account") {
          await tx.delete(holdings).where(eq(holdings.accountId, accountId));
          if (values.length > 0) await tx.insert(holdings).values(values);
          return;
        }
        if (values.length === 0) return;
        await tx
          .insert(holdings)
          .values(values)
          .onConflictDoUpdate({
            target: [holdings.accountId, holdings.ticker],
            // `excluded` is the row that would have been inserted — apply its
            // values in place, leaving non-imported tickers untouched.
            set: {
              quantity: sql`excluded.quantity`,
              costBasis: sql`excluded.cost_basis`,
              acquiredDate: sql`excluded.acquired_date`,
              updatedAt: sql`now()`,
            },
          });
      });
    },

    async deleteHolding(accountId, ticker, userId) {
      // Scope to the household: the holding is deleted only when its account
      // belongs to userId (the subquery yields the account id only then).
      await db
        .delete(holdings)
        .where(
          and(
            eq(holdings.accountId, accountId),
            eq(holdings.ticker, ticker),
            inArray(
              holdings.accountId,
              db
                .select({ id: accounts.id })
                .from(accounts)
                .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId))),
            ),
          ),
        );
    },
  };
}
