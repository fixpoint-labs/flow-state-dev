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
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type {
  AccountState,
  AccountType,
  AssetClass,
  AssetType,
  CanonicalRow,
  Holding,
  HoldingAttributes,
  ImportMode,
} from "@/src/flows/portfolio/portfolio-schema";
import {
  assetClassSchema,
  assetTypeSchema,
  holdingAttributesSchema,
} from "@/src/flows/portfolio/portfolio-schema";
import { classifyInstrument } from "@/src/flows/portfolio/classify-instrument";
import type {
  IngestReport,
  LedgerEventInput,
  LedgerEventType,
  LedgerRow,
  LedgerSource,
  SplitAttributes,
} from "@/src/flows/portfolio/ledger-schema";
import { splitAttributesSchema } from "@/src/flows/portfolio/ledger-schema";
import { deriveLots } from "@/src/flows/portfolio/lots";
import type { Db } from "./client";
import { accounts, holdings, ledgerEvents } from "./schema";

/** The Drizzle transaction handle, extracted from `Db.transaction`. The ledger
 *  ingest/void paths materialize positions inside their own transaction, so the
 *  shared {@link materializePositions} helper takes this rather than the
 *  top-level `Db`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
   * Write imported holdings for one account, transactionally — only when the
   * account belongs to `userId`. The ownership check is a DB-level guard inside
   * the transaction (the same household boundary {@link deleteAccount} /
   * {@link deleteHolding} / {@link upsertAccount} enforce): an import targeting
   * an account the caller doesn't own throws and writes nothing, so a future
   * caller that skips the app-level check fails loudly instead of writing to an
   * arbitrary account.
   * - `upsert` (the non-destructive default): each row replaces the matching
   *   `(account_id, ticker)` in place; tickers absent from the import are left
   *   untouched; new tickers are inserted. The quantity-weighted-average dedupe
   *   of duplicate tickers *within* one import already happened upstream in the
   *   CSV parser — this never averages existing vs. imported quantities.
   * - `replace-account`: the account's holdings become exactly the imported
   *   rows (delete-all + insert), atomically — no partial-state window.
   *
   * `cashBalance`, when provided (not `null`/`undefined`), is written to the
   * account row in the SAME transaction, so an import's holdings and its cash
   * update commit together — no window where new holdings carry stale cash.
   */
  upsertHoldings(
    accountId: string,
    userId: string,
    rows: CanonicalRow[],
    mode: ImportMode,
    cashBalance?: number | null,
  ): Promise<void>;
  /** Remove a single position — only when its account belongs to `userId` (the
   *  same household-scoping security boundary as {@link deleteAccount}). */
  deleteHolding(accountId: string, ticker: string, userId: string): Promise<void>;

  /**
   * Set a holding's allocation bucket by hand and mark it `asset_class_manual`,
   * so auto-classification (ledger materialization / import) preserves it instead
   * of re-deriving it. Only when the account belongs to `userId` (household
   * boundary — a foreign account throws, writing nothing). `assetType` and
   * valuation are left as-is; this edits only the allocation class.
   */
  setHoldingAssetClass(
    accountId: string,
    userId: string,
    ticker: string,
    assetClass: AssetClass,
  ): Promise<void>;

  /**
   * Append events to the ledger, idempotently. The shared ingestion contract
   * (FIX-774): manual entry today, FIX-775 file import and FIX-853 Plaid sync
   * later, all write through this. In ONE transaction it (1) ownership-guards
   * every referenced account against `userId` (a foreign account throws and the
   * whole batch rolls back), (2) computes each row's content fingerprint and
   * dedups — within the batch in memory, across batches via `ON CONFLICT DO
   * NOTHING` on both unique indexes — so a re-submit (or the same trade arriving
   * twice) is dropped, not double-counted, and (3) materializes the derived
   * positions into the holdings rows of every touched account (see
   * {@link materializePositions} — the ledger is the authority wherever it has
   * share history). `inserted + deduplicated` always equals the number of
   * events passed.
   */
  ingestLedgerEvents(events: LedgerEventInput[], userId: string): Promise<IngestReport>;
  /**
   * Reset ONE account's ledger to exactly the given events, atomically (FIX-876
   * "reset account" import mode). In a SINGLE transaction: ownership-guard the
   * account against `userId`, DELETE every `ledger_events` row for it (manual
   * entries — recorded splits, corrections — included), ingest the new events
   * through the same fingerprint/dedup path {@link ingestLedgerEvents} uses, and
   * re-materialize positions. A mid-ingest throw rolls the whole thing back, so
   * there is no partial-wipe window. Improves on the CSV `replace-account` mode by
   * being atomic; the caller warns that manual corrections are destroyed. Every
   * event must already carry `input.accountId === accountId` (the caller injects
   * it); a foreign account throws and writes nothing.
   */
  replaceLedgerFromFile(
    accountId: string,
    userId: string,
    events: LedgerEventInput[],
  ): Promise<IngestReport>;
  /**
   * Tombstone events by `(account_id, source, external_id)` — only the caller's
   * own (`user_id` scoped). Account-scoped because an external id (an OFX FITID)
   * is unique only within its account, so a void targets ONE account's rows, not
   * the same feed id everywhere. Marks `voided_at` rather than deleting (audit
   * trail); voided rows are excluded from derivation, and basis recomputes on the
   * affected account. Returns the number of rows voided. Used by FIX-853 for
   * Plaid cancellations (which fire per Item/account) and manual corrections.
   */
  voidLedgerEvents(
    accountId: string,
    externalIds: string[],
    source: string,
    userId: string,
  ): Promise<number>;
  /** A household's ledger rows, newest trade-date first, optionally filtered by
   *  account or ticker and capped by `limit` — the read for the ledger view. */
  getLedger(
    userId: string,
    opts?: { accountId?: string; ticker?: string; limit?: number },
  ): Promise<LedgerRow[]>;
  /**
   * Income earned per `(account, ticker)` — the sum of non-voided `dividend`
   * and `interest` event amounts, aggregated straight from the ledger at read
   * time. Deliberately NOT a holdings column: income survives a position
   * closing (the holdings row is deleted, the dividends were still earned), so
   * it must derive from the ledger, not live on the materialized position.
   * Ticker-less income (account-level interest, MMF sweeps) comes back under
   * `ticker: null`. Ordered by ticker for a stable view.
   */
  getIncomeSummary(
    userId: string,
    opts?: { accountId?: string },
  ): Promise<IncomeSummaryRow[]>;
}

/** One `(account, ticker)` income aggregate — see
 *  {@link PortfolioRepository.getIncomeSummary}. */
export type IncomeSummaryRow = {
  accountId: string;
  /** Null for account-level income with no security (interest, MMF sweeps). */
  ticker: string | null;
  /** Sum of non-voided `dividend` event amounts. */
  dividends: number;
  /** Sum of non-voided `interest` event amounts. */
  interest: number;
  /** Trade date of the most recent contributing event (`YYYY-MM-DD`). */
  lastEventDate: string;
};

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

/** Validate a holdings row's JSONB `attributes` into the typed
 *  {@link HoldingAttributes} union. Drizzle returns `jsonb` as a parsed object
 *  (not a string), but types it loosely, so this re-validates against the
 *  `kind`-discriminated schema. NEVER throws on a read (the nullable-honest
 *  precedent): a malformed or legacy value degrades to `{ kind: "none" }`. */
function parseAttributes(value: unknown): HoldingAttributes {
  const parsed = holdingAttributesSchema.safeParse(value);
  return parsed.success ? parsed.data : { kind: "none" };
}

/** Validate a stored asset-class / asset-type `text` column against its enum,
 *  degrading an unexpected value (a direct SQL edit, a future rollback) to
 *  `"equity"` rather than casting it blind — the {@link parseAttributes}
 *  read-boundary precedent, so the UI's `TYPE_LABELS[assetType]` and the
 *  per-type valuation switch never see an out-of-enum value. */
function parseAssetClass(value: string): AssetClass {
  return assetClassSchema.safeParse(value).success ? (value as AssetClass) : "equity";
}
function parseAssetType(value: string): AssetType {
  return assetTypeSchema.safeParse(value).success ? (value as AssetType) : "equity";
}

/** Map a holdings row to the {@link HoldingRow} shape, coercing numerics and
 *  validating the asset-taxonomy columns (FIX-773). */
function mapHolding(row: typeof holdings.$inferSelect): HoldingRow {
  return {
    accountId: row.accountId,
    ticker: row.ticker,
    quantity: Number(row.quantity),
    costBasis: toNumber(row.costBasis),
    acquiredDate: row.acquiredDate,
    assetClass: parseAssetClass(row.assetClass),
    assetType: parseAssetType(row.assetType),
    attributes: parseAttributes(row.attributes),
    dataQuality: parseDataQuality(row.dataQuality),
  };
}

/** Validate a stored `data_quality` column into the typed
 *  {@link Holding.dataQuality} value (FIX-876). Degrades an unexpected value to
 *  `null` (the {@link parseAttributes} read-boundary precedent) so a stray value
 *  never renders as a bogus flag. */
function parseDataQuality(value: string | null): "inconsistent_history" | null {
  return value === "inconsistent_history" ? "inconsistent_history" : null;
}

/** Read a ledger row's `attributes` jsonb into the typed split payload (FIX-876).
 *  Non-null only for a `split` row that parses as {@link SplitAttributes}; every
 *  other kind (and a malformed value) reads null. Never throws on a read (the
 *  nullable-honest precedent). */
function parseSplitAttributes(row: typeof ledgerEvents.$inferSelect): SplitAttributes | null {
  if (row.type !== "split") return null;
  const parsed = splitAttributesSchema.safeParse(row.attributes);
  return parsed.success ? parsed.data : null;
}

/** Map a ledger row to the {@link LedgerRow} shape, coercing numerics to JS
 *  number and timestamps to ISO-8601 (the {@link mapHolding} precedent). */
function mapLedgerRow(row: typeof ledgerEvents.$inferSelect): LedgerRow {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    type: row.type as LedgerEventType,
    ticker: row.ticker,
    tradeDate: row.tradeDate,
    settleDate: row.settleDate,
    quantity: toNumber(row.quantity),
    unitPrice: toNumber(row.unitPrice),
    amount: Number(row.amount),
    fee: toNumber(row.fee),
    currency: row.currency,
    source: row.source as LedgerSource,
    externalId: row.externalId,
    description: row.description,
    basisUnknown: row.basisUnknown,
    attributes: parseSplitAttributes(row),
    voidedAt: row.voidedAt === null ? null : new Date(row.voidedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * The canonical content fingerprint — a sha256 over the load-bearing fields at a
 * fixed numeric scale and canonical (caller-supplied) sign. This recipe is
 * contract: changing which fields it covers later would be a data migration, so
 * it is fixed now. The per-feed normalizers that map Plaid/OFX representations
 * onto this same canonical shape before hashing are added by FIX-775/FIX-853 —
 * the recipe does not change.
 */
function computeFingerprint(e: LedgerEventInput): string {
  const norm = [
    e.accountId,
    e.tradeDate,
    e.type,
    e.ticker ?? "",
    e.quantity === null ? "" : e.quantity.toFixed(8),
    e.amount.toFixed(8),
  ].join("|");
  return createHash("sha256").update(norm).digest("hex");
}

/**
 * UPSERT a materialized holdings row from a derived position. Shared by the
 * open-position path and the FIX-876 flagged inconsistent-history path — the two
 * differ ONLY in the four derived values (quantity/basis/date/dataQuality); the
 * classification, the insert, and the `assetClassManual`-preserving conflict set
 * (a user's manual class override survives re-materialization) are identical, so
 * they live here once rather than drifting across two branches.
 */
async function upsertMaterializedHolding(
  tx: Tx,
  accountId: string,
  ticker: string,
  derived: {
    quantity: string;
    costBasis: string | null;
    acquiredDate: string | null;
    dataQuality: "inconsistent_history" | null;
  },
): Promise<void> {
  const cls = classifyInstrument(ticker);
  await tx
    .insert(holdings)
    .values({
      accountId,
      ticker,
      quantity: derived.quantity,
      costBasis: derived.costBasis,
      acquiredDate: derived.acquiredDate,
      assetClass: cls.assetClass,
      assetType: cls.assetType,
      attributes: cls.attributes,
      dataQuality: derived.dataQuality,
    })
    .onConflictDoUpdate({
      target: [holdings.accountId, holdings.ticker],
      set: {
        quantity: derived.quantity,
        costBasis: derived.costBasis,
        acquiredDate: derived.acquiredDate,
        dataQuality: derived.dataQuality,
        // Reclassify a non-manual row (self-heals a pre-fix `equity` row);
        // preserve a user's manual override untouched.
        assetClass: sql`CASE WHEN ${holdings.assetClassManual} THEN ${holdings.assetClass} ELSE ${cls.assetClass} END`,
        assetType: sql`CASE WHEN ${holdings.assetClassManual} THEN ${holdings.assetType} ELSE ${cls.assetType} END`,
        attributes: sql`CASE WHEN ${holdings.assetClassManual} THEN ${holdings.attributes} ELSE ${JSON.stringify(cls.attributes)}::jsonb END`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Materialize an account's ledger-derived positions into its holdings rows,
 * inside the caller's transaction. The ledger is the AUTHORITY wherever it has
 * share history — the holdings table is the materialized view of the derived
 * positions, so a transaction-file import (FIX-775) alone produces a visible
 * portfolio, and a snapshot row disagreeing with real trade history is
 * overwritten, not preserved:
 *
 * - A ticker with a derived OPEN position gets its holdings row UPSERTED —
 *   quantity, weighted-average cost, and earliest open-lot acquisition date all
 *   come from the derivation (unknown-basis lots write `null` cost, never zero).
 * - A ticker with non-voided share history that INCLUDES an acquisition but nets
 *   to NO open position (fully sold / netted flat) has its holdings row DELETED —
 *   the position is genuinely closed, and the Portfolio view shows active
 *   holdings only. Its history (and income) stays in the ledger.
 * - A ticker whose in-range share history is only DISPOSALS (a partial import —
 *   e.g. a date range with just a sell / transfer-out — so `deriveLots` clamps
 *   the oversell to no open lot) is NOT a close: the acquisition simply isn't in
 *   the file yet. Its existing (snapshot) row is KEPT with `cost_basis` /
 *   `acquired_date` CLEARED, never deleted — deleting would hide a still-held
 *   position until the full history is imported.
 * - A ticker whose share history is ENTIRELY voided keeps its existing row but
 *   has `cost_basis` / `acquired_date` CLEARED — a correction must not leave
 *   stale basis behind, but voiding bad rows shouldn't nuke a snapshot-declared
 *   position either (the void returns the ticker to snapshot authority).
 * - A ticker with no ledger share history at all (a CSV/PDF-snapshot-only
 *   position) is untouched. Cash events (a dividend merely referencing a
 *   ticker) never substantiate or invalidate a position.
 */
async function materializePositions(tx: Tx, accountId: string): Promise<void> {
  // Deterministic order so the FIFO derivation is reproducible: trade date, then
  // insertion order (created_at, id) as the same-day tie-break. Without it the
  // heap-scan order could vary across re-derivations (a void UPDATE, a vacuum).
  const eventRows = await tx
    .select()
    .from(ledgerEvents)
    .where(eq(ledgerEvents.accountId, accountId))
    .orderBy(ledgerEvents.tradeDate, ledgerEvents.createdAt, ledgerEvents.id);
  const rows = eventRows.map(mapLedgerRow);
  const isShareMove = (r: LedgerRow) => r.quantity !== null && r.ticker !== null;
  // Tickers with LIVE (non-voided) share history — the ledger's authority set.
  const activeTickers = new Set(
    rows.filter((r) => r.voidedAt === null && isShareMove(r)).map((r) => r.ticker as string),
  );
  // Tickers whose entire share history is voided — basis-clear only.
  const voidedOnlyTickers = new Set(
    rows
      .filter((r) => isShareMove(r) && !activeTickers.has(r.ticker as string))
      .map((r) => r.ticker as string),
  );
  if (activeTickers.size === 0 && voidedOnlyTickers.size === 0) return; // no share history
  // Tickers with a live ACQUISITION (share-adding) event. A ticker that derives
  // to no open position is only a genuine CLOSE if it had an acquisition that was
  // consumed; a ticker with only disposals in range (oversell clamped away) is an
  // INCOMPLETE import, not a close — so we must not delete its snapshot row.
  const acquiredTickers = new Set(
    rows
      .filter((r) => r.voidedAt === null && isShareMove(r) && (r.quantity as number) > 0)
      .map((r) => r.ticker as string),
  );
  const { positions, oversold } = deriveLots(rows);
  const posByTicker = new Map(positions.map((p) => [p.ticker, p]));

  for (const ticker of activeTickers) {
    const p = posByTicker.get(ticker);
    // Inconsistent history (FIX-876): an acquired ticker whose disposals exceed
    // everything ever held — impossible without an unaccounted corporate action
    // (an unrecorded split is the canonical cause). This is checked FIRST, before
    // the derived position: an oversell makes the whole derivation untrustworthy,
    // so even when a LATER buy leaves a residual open position that FIFO clamped
    // its way to, the number is wrong (the pre-split lots weren't rebased). NEVER
    // show that fabricated quantity and never silently delete: materialize a
    // FLAGGED zero-quantity row (basis cleared) surfaced in the Portfolio UI with
    // a "review transactions" marker. Recording the missing split clears the
    // oversell, so the position then derives and the flag self-heals below.
    if (acquiredTickers.has(ticker) && oversold.has(ticker)) {
      await upsertMaterializedHolding(tx, accountId, ticker, {
        quantity: "0",
        costBasis: null,
        acquiredDate: null,
        dataQuality: "inconsistent_history",
      });
      continue;
    }
    if (p === undefined) {
      if (acquiredTickers.has(ticker)) {
        // Genuine close: acquisition(s) all consumed and NO oversell — the
        // active-holdings view drops it; history stays in the ledger.
        await tx
          .delete(holdings)
          .where(and(eq(holdings.accountId, accountId), eq(holdings.ticker, ticker)));
      } else {
        // Only disposals in range (oversell clamped) — a partial import over a
        // snapshot position. Keep the row; clear derived basis (can't derive it
        // without the acquisition), never delete a still-held position. Clear any
        // prior inconsistency flag too — this ticker is no longer acquired-and-
        // oversold, so a stale flag must not linger (FIX-876).
        await tx
          .update(holdings)
          .set({ costBasis: null, acquiredDate: null, dataQuality: null, updatedAt: sql`now()` })
          .where(and(eq(holdings.accountId, accountId), eq(holdings.ticker, ticker)));
      }
      continue;
    }
    // A derived open position with no oversell is consistent by construction — the
    // shared upsert classifies by ticker (so a transaction-materialized holding
    // carries its real asset class, not the `equity` default) and clears any prior
    // `inconsistent_history` flag (FIX-876: a recorded split that explains an
    // earlier oversell self-heals the row).
    await upsertMaterializedHolding(tx, accountId, ticker, {
      quantity: String(p.quantity),
      costBasis: p.avgCost === null ? null : String(p.avgCost),
      acquiredDate: p.acquiredDate,
      dataQuality: null,
    });
  }

  if (voidedOnlyTickers.size > 0) {
    // A ticker whose share history is entirely voided returns to snapshot
    // authority — clear derived basis AND any prior inconsistency flag (FIX-876).
    await tx
      .update(holdings)
      .set({ costBasis: null, acquiredDate: null, dataQuality: null, updatedAt: sql`now()` })
      .where(
        and(eq(holdings.accountId, accountId), inArray(holdings.ticker, [...voidedOnlyTickers])),
      );
  }
}

/**
 * Ingest a batch of events inside the caller's transaction: ownership-guard every
 * referenced account against `userId`, dedup in memory then via `ON CONFLICT DO
 * NOTHING`, chunk-insert, and re-materialize positions on every touched account.
 * Shared by {@link PortfolioRepository.ingestLedgerEvents} and
 * {@link PortfolioRepository.replaceLedgerFromFile} so the reset path reuses the
 * exact dedup/fingerprint/materialize logic rather than forking it (BP-028).
 * `inserted + deduplicated` always equals `events.length`.
 */
async function ingestEventsInTx(
  tx: Tx,
  events: LedgerEventInput[],
  userId: string,
): Promise<IngestReport> {
  if (events.length === 0) return { inserted: 0, deduplicated: 0, errors: [] };

  // Ownership guard: every referenced account must belong to the caller. A
  // foreign account throws and the whole batch rolls back (defense in depth).
  const accountIds = [...new Set(events.map((e) => e.accountId))];
  const owned = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(inArray(accounts.id, accountIds), eq(accounts.userId, userId)));
  const ownedSet = new Set(owned.map((o) => o.id));
  for (const id of accountIds) {
    if (!ownedSet.has(id)) {
      throw new Error(`Account ${id} is not owned by the requesting user.`);
    }
  }

  // In-memory dedup BEFORE the insert so two conflicting rows in the same batch
  // can't trip an intra-statement conflict and the counts are exact. Prefer the
  // stable `(source, external_id)` key when present, else the content
  // fingerprint. Both keys are account-scoped, matching the DB unique indexes.
  const seen = new Set<string>();
  const values: (typeof ledgerEvents.$inferInsert)[] = [];
  for (const e of events) {
    const fingerprint = computeFingerprint(e);
    const key =
      e.externalId !== null
        ? `x:${e.accountId}:${e.source}:${e.externalId}`
        : `f:${e.accountId}:${fingerprint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({
      id: crypto.randomUUID(),
      accountId: e.accountId,
      userId,
      type: e.type,
      ticker: e.ticker,
      tradeDate: e.tradeDate,
      settleDate: e.settleDate,
      quantity: e.quantity === null ? null : String(e.quantity),
      unitPrice: e.unitPrice === null ? null : String(e.unitPrice),
      amount: String(e.amount),
      fee: e.fee === null ? null : String(e.fee),
      currency: e.currency,
      source: e.source,
      externalId: e.externalId,
      fingerprint,
      description: e.description,
      basisUnknown: e.basisUnknown,
      // Corporate-action payload — the split ratio for a `split`, null otherwise
      // (the zod boundary guarantees this). Excluded from the fingerprint above,
      // so a same-date re-import dedups to one row.
      attributes: e.attributes ?? null,
    });
  }

  // Chunked: one multi-row INSERT tops out at 32,767 bound params on PGlite and
  // 65,535 on node-pg; 1,000 rows/chunk clears both. The chunks share this
  // transaction, so the batch stays atomic.
  const INSERT_CHUNK_ROWS = 1000;
  let inserted = 0;
  for (let i = 0; i < values.length; i += INSERT_CHUNK_ROWS) {
    const insertedRows = await tx
      .insert(ledgerEvents)
      .values(values.slice(i, i + INSERT_CHUNK_ROWS))
      .onConflictDoNothing()
      .returning({ id: ledgerEvents.id });
    inserted += insertedRows.length;
  }

  // Positions are derived: materialize on every touched account in the same tx.
  for (const id of accountIds) await materializePositions(tx, id);

  return { inserted, deduplicated: events.length - inserted, errors: [] };
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
      assetClass: h.assetClass,
      assetType: h.assetType,
      attributes: h.attributes,
      dataQuality: h.dataQuality,
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

    async upsertHoldings(accountId, userId, rows, mode, cashBalance) {
      const values = rows.map((r) => ({
        accountId,
        ticker: r.ticker,
        quantity: String(r.quantity),
        costBasis: r.costBasis === null ? null : String(r.costBasis),
        acquiredDate: r.acquiredDate,
        assetClass: r.assetClass,
        assetType: r.assetType,
        attributes: r.attributes,
      }));
      // Holdings write + optional cash update in ONE transaction, so an import
      // never leaves new holdings paired with stale cash.
      await db.transaction(async (tx) => {
        // Household guard (defense in depth): the insert path can't be scoped
        // by a WHERE clause the way the deletes/cash-update are, so confirm
        // ownership up front and let the whole transaction roll back if the
        // account isn't the caller's. `importHoldings` already checks, so the
        // normal path always passes; this catches a future caller that skips it.
        const [owner] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
        if (owner === undefined) {
          throw new Error(`Account ${accountId} is not owned by the requesting user.`);
        }
        if (mode === "replace-account") {
          await tx.delete(holdings).where(eq(holdings.accountId, accountId));
          if (values.length > 0) await tx.insert(holdings).values(values);
        } else if (values.length > 0) {
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
                // Re-classification is load-bearing: an upsert that changes a
                // held ticker's class/type/attributes must overwrite the old
                // values, not silently keep them (FIX-773).
                assetClass: sql`excluded.asset_class`,
                assetType: sql`excluded.asset_type`,
                attributes: sql`excluded.attributes`,
                updatedAt: sql`now()`,
              },
            });
        }
        if (cashBalance !== undefined && cashBalance !== null) {
          await tx
            .update(accounts)
            .set({ cashBalance: String(cashBalance), updatedAt: sql`now()` })
            .where(eq(accounts.id, accountId));
        }
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

    async setHoldingAssetClass(accountId, userId, ticker, assetClass) {
      await db.transaction(async (tx) => {
        // Household guard (the `upsertHoldings` precedent): confirm ownership up
        // front and throw, so a foreign account writes nothing.
        const [owner] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
        if (owner === undefined) {
          throw new Error(`Account ${accountId} is not owned by the requesting user.`);
        }
        await tx
          .update(holdings)
          .set({ assetClass, assetClassManual: true, updatedAt: sql`now()` })
          .where(and(eq(holdings.accountId, accountId), eq(holdings.ticker, ticker)));
      });
    },

    async ingestLedgerEvents(events, userId) {
      if (events.length === 0) {
        return { inserted: 0, deduplicated: 0, errors: [] };
      }
      return db.transaction((tx) => ingestEventsInTx(tx, events, userId));
    },

    async replaceLedgerFromFile(accountId, userId, events) {
      // Scope the reset to EXACTLY one account: every event must target `accountId`.
      // `ingestEventsInTx` accepts any account the user owns, so without this a
      // caller passing events for a different owned account would wipe THIS account
      // and repopulate the OTHER — a destructive mis-scope. Reject before any write.
      if (events.some((e) => e.accountId !== accountId)) {
        throw new Error(
          `replaceLedgerFromFile: every event must target account ${accountId}.`,
        );
      }
      return db.transaction(async (tx) => {
        // Ownership-guard the target account up front, so a wipe never touches a
        // foreign account (the whole transaction rolls back on a throw).
        const [owner] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
        if (owner === undefined) {
          throw new Error(`Account ${accountId} is not owned by the requesting user.`);
        }
        // Tickers the OLD ledger was the AUTHORITY for (had live share history) —
        // so the reset can drop any the new file no longer backs. `materialize`
        // only reconciles tickers present in the NEW ledger, so without this a
        // position materialized from a since-wiped trade would survive the "clean
        // slate" as a stale row. A CSV/PDF-snapshot-only ticker never had ledger
        // share history, so it is NOT in this set and is correctly preserved.
        const beforeRows = await tx
          .selectDistinct({ ticker: ledgerEvents.ticker })
          .from(ledgerEvents)
          .where(
            and(
              eq(ledgerEvents.accountId, accountId),
              isNotNull(ledgerEvents.ticker),
              isNotNull(ledgerEvents.quantity),
              // LIVE authority only: a ticker whose share history is entirely
              // voided has already returned to snapshot authority, so it must not
              // drive an orphan delete (which would wrongly drop its snapshot row).
              isNull(ledgerEvents.voidedAt),
            ),
          );
        const ledgerAuthoritativeBefore = new Set(
          beforeRows.map((r) => r.ticker).filter((t): t is string => t !== null),
        );
        // Atomic clean slate: DELETE the whole account's ledger (manual entries
        // included — the caller warns about this), then ingest the new file's
        // events through the shared path (dedup + re-materialize). If the ingest
        // throws mid-flight the DELETE rolls back too — no partial wipe.
        await tx.delete(ledgerEvents).where(eq(ledgerEvents.accountId, accountId));
        const report = await ingestEventsInTx(tx, events, userId);
        // Reconcile holdings to the new source of truth: drop any ledger-derived
        // position the new file no longer carries a share move for.
        const afterTickers = new Set(
          events.filter((e) => e.quantity !== null && e.ticker !== null).map((e) => e.ticker),
        );
        const orphans = [...ledgerAuthoritativeBefore].filter((t) => !afterTickers.has(t));
        if (orphans.length > 0) {
          await tx
            .delete(holdings)
            .where(and(eq(holdings.accountId, accountId), inArray(holdings.ticker, orphans)));
        }
        return report;
      });
    },

    async voidLedgerEvents(accountId, externalIds, source, userId) {
      if (externalIds.length === 0) return 0;
      return db.transaction(async (tx) => {
        // Account-scoped: an external id is unique only within its account
        // (the `(account_id, source, external_id)` index), so a void targets one
        // account — voiding by `(source, external_id)` alone would tombstone the
        // same feed id across every account that holds it.
        const voidedRows = await tx
          .update(ledgerEvents)
          .set({ voidedAt: sql`now()` })
          .where(
            and(
              eq(ledgerEvents.accountId, accountId),
              eq(ledgerEvents.source, source),
              inArray(ledgerEvents.externalId, externalIds),
              eq(ledgerEvents.userId, userId),
              isNull(ledgerEvents.voidedAt),
            ),
          )
          .returning({ accountId: ledgerEvents.accountId });
        if (voidedRows.length > 0) await materializePositions(tx, accountId);
        return voidedRows.length;
      });
    },

    async getLedger(userId, opts) {
      const conds = [eq(ledgerEvents.userId, userId)];
      if (opts?.accountId) conds.push(eq(ledgerEvents.accountId, opts.accountId));
      if (opts?.ticker) conds.push(eq(ledgerEvents.ticker, opts.ticker));
      const base = db
        .select()
        .from(ledgerEvents)
        .where(and(...conds))
        .orderBy(desc(ledgerEvents.tradeDate), desc(ledgerEvents.createdAt));
      const rows = opts?.limit ? await base.limit(opts.limit) : await base;
      return rows.map(mapLedgerRow);
    },

    async getIncomeSummary(userId, opts) {
      const conds = [
        eq(ledgerEvents.userId, userId),
        isNull(ledgerEvents.voidedAt),
        inArray(ledgerEvents.type, ["dividend", "interest"]),
      ];
      if (opts?.accountId) conds.push(eq(ledgerEvents.accountId, opts.accountId));
      const rows = await db
        .select({
          accountId: ledgerEvents.accountId,
          ticker: ledgerEvents.ticker,
          // FILTER-based split so one grouped scan yields both figures.
          dividends: sql<string>`coalesce(sum(${ledgerEvents.amount}) filter (where ${ledgerEvents.type} = 'dividend'), 0)`,
          interest: sql<string>`coalesce(sum(${ledgerEvents.amount}) filter (where ${ledgerEvents.type} = 'interest'), 0)`,
          lastEventDate: sql<string>`max(${ledgerEvents.tradeDate})`,
        })
        .from(ledgerEvents)
        .where(and(...conds))
        .groupBy(ledgerEvents.accountId, ledgerEvents.ticker)
        .orderBy(ledgerEvents.ticker);
      return rows.map((r) => ({
        accountId: r.accountId,
        ticker: r.ticker,
        dividends: Number(r.dividends),
        interest: Number(r.interest),
        lastEventDate: r.lastEventDate,
      }));
    },
  };
}
