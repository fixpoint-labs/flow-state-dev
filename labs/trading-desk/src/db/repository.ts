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
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
import type { RealizedDisposal } from "@/src/flows/portfolio/realized-gains";
import type { TaxProfileInput } from "@/src/flows/portfolio/tax-schema";
import type { Db } from "./client";
import {
  accounts,
  holdings,
  instrumentClassifications,
  ledgerEvents,
  quotes,
  realizedGains,
  taxProfiles,
} from "./schema";

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
  /**
   * Income earned per `(account, ticker, year)` — the year-dimensioned parallel
   * to {@link getIncomeSummary} (FIX-874), grouped additionally by trade-date
   * year AND row `currency` (so EUR dividends in a default-USD account don't sum
   * with USD before the tax route can filter by currency). `getIncomeSummary`
   * (all-time) is untouched — the existing Income tab is unaffected.
   */
  getIncomeSummaryByYear(
    userId: string,
    opts?: { year?: number; accountId?: string },
  ): Promise<IncomeSummaryByYearRow[]>;
  /**
   * A household's persisted realized gains (FIX-874), newest disposal first,
   * optionally scoped by year or account. All-year by default so the Realized
   * Gains tab can show prior-year history; the tax route filters to the
   * requested year for the estimate.
   */
  getRealizedGains(
    userId: string,
    opts?: { year?: number; accountId?: string },
  ): Promise<RealizedGainRow[]>;
  /** The user's tax profile, or null when none is saved. */
  getTaxProfile(userId: string): Promise<TaxProfileRow | null>;
  /** Create or replace the user's tax profile (keyed on `userId`). */
  upsertTaxProfile(userId: string, input: TaxProfileInput): Promise<TaxProfileRow>;
  /**
   * One-time rollout surface (FIX-874): materialize realized gains for EVERY
   * existing account under the per-account advisory lock, so history isn't empty
   * until an unrelated mutation touches each account. Idempotent
   * (delete-then-reinsert) — safe to re-run. The module-private materializer
   * isn't reachable from `scripts/`, so this is the callable API a startup /
   * migration hook imports.
   */
  backfillRealizedGains(): Promise<void>;
  /**
   * Last-known prices for a set of tickers (FIX-823), for the seed snapshot and
   * the Portfolio read route. Tickers are upper-cased before the lookup (the
   * canonical PK); an empty input returns `[]` without a query (never a
   * full-table scan). A ticker with no row is simply omitted — valuation then
   * degrades to "unavailable" (the "—" real-money gate).
   */
  getQuotes(tickers: string[]): Promise<QuoteRow[]>;
  /**
   * Persist a batch of last-known prices (FIX-823), transactionally — upsert on
   * the `ticker` PK, setting `price`/`asOf`/`source` and stamping `fetched_at =
   * now()`. Tickers are upper-cased. Empty input is a no-op. Callers pass LIVE,
   * non-null-priced quotes only (the `getQuotes` write path filters), so a
   * fixture-mode result or a provider miss never overwrites the shared global row.
   */
  upsertQuotes(rows: QuoteInput[]): Promise<void>;
  /**
   * Per-ticker sector classifications for a set of tickers (FIX-762), for the
   * Health view fill route and the analysis seed. Tickers are upper-cased before
   * the lookup (the canonical PK); an empty input returns `[]` without a query. A
   * ticker with no row is simply omitted — the sector view then shows it as
   * `Unclassified` until a later Health-view visit fills the cache.
   *
   * NOTE: unlike every *portfolio* method, this is GLOBAL reference data — no
   * `userId` guard, because a ticker's sector is a public per-ticker fact shared
   * across households (the `getQuotes` precedent).
   */
  getInstrumentClassifications(tickers: string[]): Promise<InstrumentClassificationRow[]>;
  /**
   * Persist a batch of sector classifications (FIX-762), transactionally — upsert
   * on the `ticker` PK, setting `sector`/`source` and stamping `fetched_at =
   * now()`. Tickers are upper-cased. Empty input is a no-op. Callers pass
   * SUCCESSFUL resolutions only (`sector` non-null), so a provider miss never
   * blanks the shared global row (the `upsertQuotes` filter precedent). Global
   * reference data — no `userId` guard.
   */
  upsertInstrumentClassifications(rows: InstrumentClassificationInput[]): Promise<void>;
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

/** One `(account, ticker, year, currency)` income aggregate (FIX-874) — the
 *  year-dimensioned {@link IncomeSummaryRow}. */
export type IncomeSummaryByYearRow = IncomeSummaryRow & {
  /** Calendar year of the contributing events (from `trade_date`). */
  year: number;
  /** The events' currency — carried so the tax route filters row-level. */
  currency: string;
};

/** One persisted realized-gain row (FIX-874) — the read shape of
 *  `app.realized_gains`, numerics coerced to JS number at the read boundary. */
export type RealizedGainRow = {
  id: string;
  accountId: string;
  userId: string;
  ticker: string;
  disposedDate: string;
  acquiredDate: string | null;
  quantity: number;
  proceeds: number | null;
  costBasis: number | null;
  gain: number | null;
  term: "short" | "long" | "unknown";
  currency: string;
  basisUnknown: string | null;
  disposalEventId: string;
  lotIndex: number;
  createdAt: string;
};

/** The read shape of `app.tax_profiles` (FIX-874) — the input plus its key and
 *  update stamp. */
export type TaxProfileRow = TaxProfileInput & { userId: string; updatedAt: string };

/** One persisted last-known price (FIX-823) — the read shape of `app.quotes`,
 *  with `price` coerced to a JS number and the timestamps normalized to ISO-8601
 *  (the {@link mapHolding} read-boundary precedent). `asOf` is the price's own
 *  market time (null when the source carried none); `fetchedAt` is when we cached
 *  it. */
export type QuoteRow = {
  ticker: string;
  price: number;
  asOf: string | null;
  source: string;
  fetchedAt: string;
};

/** Fields a caller supplies to persist one quote (FIX-823). `price` is non-null
 *  by construction — the `getQuotes` write path filters null-priced quotes before
 *  upserting, so a failed refresh never nulls a good last-known row. `fetchedAt`
 *  is owned by the repository (set to `now()` on write). */
export type QuoteInput = {
  ticker: string;
  price: number;
  asOf: string | null;
  source: string;
};

/** One persisted per-ticker sector classification (FIX-762) — the read shape of
 *  `app.instrument_classifications`, timestamp normalized to ISO-8601. `sector`
 *  is null only for a row that predates a resolution; the fill path never writes
 *  a null (a miss is returned unpersisted). */
export type InstrumentClassificationRow = {
  ticker: string;
  sector: string | null;
  source: string;
  fetchedAt: string;
};

/** Fields a caller supplies to persist one classification (FIX-762). `sector` is
 *  non-null by construction — the fill route persists successful resolutions
 *  only, so a provider miss never blanks a stored row. `fetchedAt` is owned by
 *  the repository (set to `now()` on write). */
export type InstrumentClassificationInput = {
  ticker: string;
  sector: string;
  source: string;
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
    proceedsUnknown: row.proceedsUnknown,
    attributes: parseSplitAttributes(row),
    voidedAt: row.voidedAt === null ? null : new Date(row.voidedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Map a realized-gains row to {@link RealizedGainRow}, coercing numerics to JS
 *  number and validating the `term` enum (the `parseAssetType` read-boundary
 *  precedent — an out-of-enum value degrades to `"unknown"`, never casts blind). */
function mapRealizedGain(row: typeof realizedGains.$inferSelect): RealizedGainRow {
  const term =
    row.term === "short" || row.term === "long" || row.term === "unknown"
      ? row.term
      : "unknown";
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    ticker: row.ticker,
    disposedDate: row.disposedDate,
    acquiredDate: row.acquiredDate,
    quantity: Number(row.quantity),
    proceeds: toNumber(row.proceeds),
    costBasis: toNumber(row.costBasis),
    gain: toNumber(row.gain),
    term,
    currency: row.currency,
    basisUnknown: row.basisUnknown,
    disposalEventId: row.disposalEventId,
    lotIndex: row.lotIndex,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Map a tax-profiles row to {@link TaxProfileRow}, coercing the percent-scale
 *  rate numerics to JS number and validating the filing-status enum. */
function mapTaxProfile(row: typeof taxProfiles.$inferSelect): TaxProfileRow {
  const filingStatus =
    row.filingStatus === "single" ||
    row.filingStatus === "mfj" ||
    row.filingStatus === "hoh" ||
    row.filingStatus === "mfs"
      ? row.filingStatus
      : "single";
  return {
    userId: row.userId,
    filingStatus,
    marginalOrdinaryRatePct: Number(row.marginalOrdinaryRatePct),
    ltcgRatePct: Number(row.ltcgRatePct),
    stateRatePct: toNumber(row.stateRatePct),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Map a quotes row to {@link QuoteRow} (FIX-823), coercing the `numeric` price
 *  to a JS number (the FIX-772 read-boundary rule — downstream does `quantity ×
 *  price` money math) and normalizing the timestamp columns to ISO-8601. The
 *  `timestamp(..., { mode: "string" })` shape is driver-dependent (PGlite vs
 *  node-postgres differ), so the ISO normalization keeps UI provenance text and
 *  tests on the stable contract the rest of the repository upholds. `source`
 *  passes through. */
function mapQuote(row: typeof quotes.$inferSelect): QuoteRow {
  return {
    ticker: row.ticker,
    price: Number(row.price),
    asOf: row.asOf === null ? null : new Date(row.asOf).toISOString(),
    source: row.source,
    fetchedAt: new Date(row.fetchedAt).toISOString(),
  };
}

/** Map an `app.instrument_classifications` row to its read shape (FIX-762),
 *  normalizing the timestamp to ISO-8601 (the {@link mapQuote} boundary). */
function mapInstrumentClassification(
  row: typeof instrumentClassifications.$inferSelect,
): InstrumentClassificationRow {
  return {
    ticker: row.ticker,
    sector: row.sector,
    source: row.source,
    fetchedAt: new Date(row.fetchedAt).toISOString(),
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
  // The `proceedsUnknown` marker (FIX-874) joins the fingerprint ONLY when set,
  // so a proceeds-unknown import placeholder can't dedup-collide with a genuine
  // $0 sale of the same account/date/type/ticker/qty/amount (both `amount:0`,
  // both blank-FITID). A genuine row (marker null) keeps the exact pre-FIX-874
  // hash — no fingerprint-recompute migration, back-compat by construction.
  const withMarker = e.proceedsUnknown !== null ? `${norm}|pu:${e.proceedsUnknown}` : norm;
  return createHash("sha256").update(withMarker).digest("hex");
}

/** Canonicalize a currency to an uppercase ISO-4217-shaped code, so the tax
 *  route's exact `currency === "USD"` filter is trustworthy — `usd`/`Usd`/a
 *  padded value would otherwise be silently dropped from the taxable total.
 *  Applied on the shared ingest path (every writer funnels through it). */
function normalizeCurrency(raw: string): string {
  const c = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) {
    throw new Error(`Invalid currency "${raw}" — expected a 3-letter ISO-4217 code.`);
  }
  return c;
}

/**
 * Enforce the share-event invariant on the shared ingest boundary (FIX-874), the
 * one path every writer (manual, file, Plaid) funnels through — `deriveLots`
 * pushes/consumes lots by the SIGN of `quantity` regardless of `type`, so a
 * mis-typed row corrupts positions AND realized gains. A violation is a
 * caller/normalizer bug, so it throws and the whole batch rolls back (the
 * ownership-guard posture) rather than being soft-skipped and miscounted as
 * `deduplicated`.
 *
 * - Only `buy`/`sell`/`transfer` may carry a non-null share `quantity` (a cash
 *   type carrying one would form a phantom lot).
 * - Any quantity-bearing row must carry a `ticker` (a share move with no ticker
 *   forms no lot, so a later sale becomes an unmatched disposal).
 * - `buy` is `+qty`, `sell` is `−qty`; `transfer` may be either sign (an OFX
 *   transfer-in is `+`, an out is `−`).
 */
function assertShareEventInvariant(e: LedgerEventInput): void {
  if (e.quantity === null) {
    // A `buy`/`sell` with no quantity would persist as a phantom cash event —
    // `deriveLots` forms no lot, so positions AND realized gains silently omit
    // the trade. Reject it here rather than store a share trade the derivation
    // can't see. (A `transfer` with null quantity is a legitimate cash transfer.)
    if (e.type === "buy" || e.type === "sell") {
      throw new Error(`A ${e.type} event must carry a share quantity.`);
    }
    return;
  }
  const shareType = e.type === "buy" || e.type === "sell" || e.type === "transfer";
  if (!shareType) {
    throw new Error(`A ${e.type} event carries a share quantity — only buy/sell/transfer may.`);
  }
  if (e.ticker === null) {
    throw new Error(`A ${e.type} event carries a quantity but no ticker.`);
  }
  if (e.type === "buy" && e.quantity <= 0) {
    throw new Error(`A buy must have a positive quantity (got ${e.quantity}).`);
  }
  if (e.type === "sell" && e.quantity >= 0) {
    throw new Error(`A sell must have a negative quantity (got ${e.quantity}).`);
  }
  // Sell proceeds are cash IN — non-negative by the sign convention (buy `−`,
  // sell `+`). The realized-gains path (FIX-874) allocates `amount` directly as
  // proceeds, so a negative sell amount would persist negative proceeds and an
  // overstated capital loss. Guard the sign at this shared boundary (the file
  // parser already floors proceeds at 0; this catches a manual/caller row). A
  // genuine $0 sale is still allowed.
  if (e.type === "sell" && e.amount < 0) {
    throw new Error(`A sell must have non-negative proceeds (got ${e.amount}).`);
  }
}

/** Serialize same-account recomputes (FIX-874). Held for the rest of the
 *  ingest/void transaction, so a concurrent void can't be resurrected by an
 *  in-flight import that read pre-void ledger state (the deterministic unique
 *  index alone can't catch a deleted-then-reinserted row). Also hardens
 *  `materializePositions`, which shares the delete/upsert-without-lock exposure.
 *  Callers acquire locks in SORTED account order so multi-account batches can't
 *  deadlock. */
async function acquireRealizedLock(tx: Tx, accountId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`realized:${accountId}`})::int8)`);
}

/**
 * Materialize an account's ledger-derived realized gains into `app.realized_gains`
 * (FIX-874), inside the caller's transaction — the realized-side peer of
 * {@link materializePositions}. Full recompute: DELETE every row for the account,
 * re-derive via `deriveLots(rows).disposals`, and re-insert. So a void retracts
 * gains and a re-ingest is idempotent. The `(disposal_event_id, lot_index)`
 * unique index catches the empty-table double-insert window; the per-account
 * advisory lock (acquired by the caller) is the real serialization.
 *
 * IMPORTANT: unlike `materializePositions`, the DELETE is UNCONDITIONAL — there
 * is NO early-return for an account with no share history. An account whose share
 * history was entirely voided must have its stale realized rows cleared, not
 * left behind (a retraction bug).
 */
async function materializeRealizedGains(tx: Tx, accountId: string): Promise<void> {
  await tx.delete(realizedGains).where(eq(realizedGains.accountId, accountId));
  const [account] = await tx
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (account === undefined) return; // account gone (cascade) — nothing to derive
  const eventRows = await tx
    .select()
    .from(ledgerEvents)
    .where(eq(ledgerEvents.accountId, accountId))
    .orderBy(ledgerEvents.tradeDate, ledgerEvents.createdAt, ledgerEvents.id);
  const rows = eventRows.map(mapLedgerRow);
  const { disposals } = deriveLots(rows);
  if (disposals.length === 0) return;
  const values = disposals.map((d: RealizedDisposal) => ({
    id: crypto.randomUUID(),
    accountId,
    userId: account.userId,
    ticker: d.ticker,
    disposedDate: d.disposedDate,
    acquiredDate: d.acquiredDate,
    quantity: String(d.quantity),
    proceeds: d.proceeds === null ? null : String(d.proceeds),
    costBasis: d.costBasis === null ? null : String(d.costBasis),
    gain: d.gain === null ? null : String(d.gain),
    term: d.term,
    currency: d.currency,
    basisUnknown: d.basisUnknown,
    disposalEventId: d.disposalEventId,
    lotIndex: d.lotIndex,
  }));
  // Chunked for the same reason the ledger insert is (see `ingestLedgerEvents`):
  // the wire protocol's Bind message carries the bound-param count as a 16-bit
  // integer, so one multi-row INSERT tops out at 32,767 params on PGlite (the
  // count wraps negative and silently kills the single dev connection — every
  // later query then returns empty) and 65,535 on node-pg. At 15 params per row
  // an active account crosses the PGlite line at ~2,185 disposals. 1,000
  // rows/chunk (15k params) clears both ceilings; the chunks share this
  // transaction, so the recompute stays atomic.
  const INSERT_CHUNK_ROWS = 1000;
  for (let i = 0; i < values.length; i += INSERT_CHUNK_ROWS) {
    await tx
      .insert(realizedGains)
      .values(values.slice(i, i + INSERT_CHUNK_ROWS))
      .onConflictDoNothing({
        target: [realizedGains.disposalEventId, realizedGains.lotIndex],
      });
  }
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
    const tickers = [...voidedOnlyTickers];
    // A flagged `inconsistent_history` row was CREATED by the oversold guard (a
    // real snapshot is never flagged — only ledger materialization sets the flag),
    // so once its events are all voided it has no basis to exist. DELETE it rather
    // than leave an unflagged 0-share ghost behind (FIX-876 review).
    await tx
      .delete(holdings)
      .where(
        and(
          eq(holdings.accountId, accountId),
          inArray(holdings.ticker, tickers),
          eq(holdings.dataQuality, "inconsistent_history"),
        ),
      );
    // The remaining voided-only tickers are snapshot rows returning to snapshot
    // authority — clear derived basis AND any prior flag (a no-op on the rows just
    // deleted above).
    await tx
      .update(holdings)
      .set({ costBasis: null, acquiredDate: null, dataQuality: null, updatedAt: sql`now()` })
      .where(and(eq(holdings.accountId, accountId), inArray(holdings.ticker, tickers)));
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
  // Sorted so the per-account advisory locks below are acquired deterministically
  // (FIX-874) — two batches touching {A,B} and {B,A} can't deadlock.
  const accountIds = [...new Set(events.map((e) => e.accountId))].sort();
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
    // Guard the shared derivation contract (FIX-874) and canonicalize the currency
    // BEFORE the fingerprint/insert — every writer funnels here, so the file
    // importer (which bypasses the zod schema) is covered too.
    assertShareEventInvariant(e);
    const currency = normalizeCurrency(e.currency);
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
      currency,
      source: e.source,
      externalId: e.externalId,
      fingerprint,
      description: e.description,
      basisUnknown: e.basisUnknown,
      // Reason a sell's proceeds are unknown (FIX-874 import placeholder); nulls
      // proceeds/gain in derivation rather than fabricating a loss off `amount:0`.
      proceedsUnknown: e.proceedsUnknown,
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

  // Serialize same-account recomputes: acquire ALL per-account locks in sorted
  // order first (deadlock-free), then materialize positions AND realized gains
  // for each touched account in the same transaction (FIX-874).
  for (const id of accountIds) await acquireRealizedLock(tx, id);
  for (const id of accountIds) {
    await materializePositions(tx, id);
    await materializeRealizedGains(tx, id);
  }

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
        // Normalize on the same boundary the ledger does (`normalizeCurrency`),
        // so an account saved as `usd` and its uppercase-normalized ledger rows
        // agree — the realized-gains total's exact currency check (FIX-874)
        // would otherwise render `—` for a valid single-currency account.
        currency: normalizeCurrency(input.currency ?? "USD"),
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
                // A snapshot import is a fresh, authoritative position from the
                // user — clear any stale inconsistent-history flag (FIX-876) so a
                // re-import for a previously over-sold ticker doesn't keep blanking
                // the freshly-imported numbers as "—".
                dataQuality: null,
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
        // Tickers the OLD ledger held genuine AUTHORITY for — so the reset can
        // drop any the new file no longer backs. `materialize` only reconciles
        // tickers present in the NEW ledger, so without this a position
        // materialized from a since-wiped trade would survive the "clean slate" as
        // a stale row. The authority set mirrors materialize's DELETE/flag rule
        // exactly: only a ticker with a live ACQUISITION (`quantity > 0` —
        // matching `acquiredTickers`) established a ledger-derived position.
        //   - A CSV/PDF-snapshot-only ticker never had ledger share history →
        //     not in this set → its snapshot is preserved.
        //   - A ticker whose old history was ONLY disposals (materialize keeps its
        //     snapshot as a partial import) has no acquisition → not in this set →
        //     preserved, not wrongly orphaned.
        //   - A ticker whose share history is entirely voided (`isNull(voidedAt)`
        //     excludes it) has returned to snapshot authority → preserved.
        const beforeRows = await tx
          .selectDistinct({ ticker: ledgerEvents.ticker })
          .from(ledgerEvents)
          .where(
            and(
              eq(ledgerEvents.accountId, accountId),
              isNotNull(ledgerEvents.ticker),
              gt(ledgerEvents.quantity, "0"),
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
        // position the new file no longer ESTABLISHES. Symmetric with
        // `ledgerAuthoritativeBefore` — only a new ACQUISITION (`quantity > 0`)
        // re-establishes a ticker's position. A reset file that merely SELLS a
        // previously-derived ticker (no new buy) does NOT keep it: its old
        // materialized row came from the now-wiped ledger, so leaving it would
        // show a stale position after the "clean slate" (materialize's
        // disposals-only "keep as snapshot" rule assumes a real snapshot, which a
        // reset ledger-derived row is not).
        const afterAcquired = new Set(
          events
            .filter((e) => e.quantity !== null && e.quantity > 0 && e.ticker !== null)
            .map((e) => e.ticker),
        );
        const orphans = [...ledgerAuthoritativeBefore].filter((t) => !afterAcquired.has(t));
        if (orphans.length > 0) {
          await tx
            .delete(holdings)
            .where(and(eq(holdings.accountId, accountId), inArray(holdings.ticker, orphans)));
        }
        // `ingestEventsInTx` re-materializes realized gains only for a NON-empty
        // batch. A reset to an empty (or sell-less) file still wiped this account's
        // ledger above, so re-materialize here to clear stale realized_gains rows
        // (FIX-874) — idempotent, and the empty case is the one ingest skipped.
        if (events.length === 0) {
          await acquireRealizedLock(tx, accountId);
          await materializeRealizedGains(tx, accountId);
        }
        return report;
      });
    },

    async voidLedgerEvents(accountId, externalIds, source, userId) {
      if (externalIds.length === 0) return 0;
      return db.transaction(async (tx) => {
        // Serialize against a concurrent same-account recompute before touching
        // the ledger (single account, so ordering is trivial here — the sort
        // matters only for the multi-account ingest path).
        await acquireRealizedLock(tx, accountId);
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
        if (voidedRows.length > 0) {
          await materializePositions(tx, accountId);
          await materializeRealizedGains(tx, accountId);
        }
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

    async getIncomeSummaryByYear(userId, opts) {
      const conds = [
        eq(ledgerEvents.userId, userId),
        isNull(ledgerEvents.voidedAt),
        inArray(ledgerEvents.type, ["dividend", "interest"]),
      ];
      if (opts?.accountId) conds.push(eq(ledgerEvents.accountId, opts.accountId));
      const year = sql<number>`extract(year from ${ledgerEvents.tradeDate})::int`;
      if (opts?.year !== undefined) {
        conds.push(sql`extract(year from ${ledgerEvents.tradeDate})::int = ${opts.year}`);
      }
      const rows = await db
        .select({
          accountId: ledgerEvents.accountId,
          ticker: ledgerEvents.ticker,
          year,
          currency: ledgerEvents.currency,
          dividends: sql<string>`coalesce(sum(${ledgerEvents.amount}) filter (where ${ledgerEvents.type} = 'dividend'), 0)`,
          interest: sql<string>`coalesce(sum(${ledgerEvents.amount}) filter (where ${ledgerEvents.type} = 'interest'), 0)`,
          lastEventDate: sql<string>`max(${ledgerEvents.tradeDate})`,
        })
        .from(ledgerEvents)
        .where(and(...conds))
        // Year AND currency both group keys — else EUR dividends in a USD account
        // sum with USD before the tax route can filter by currency.
        .groupBy(ledgerEvents.accountId, ledgerEvents.ticker, year, ledgerEvents.currency)
        .orderBy(ledgerEvents.ticker);
      return rows.map((r) => ({
        accountId: r.accountId,
        ticker: r.ticker,
        year: Number(r.year),
        currency: r.currency,
        dividends: Number(r.dividends),
        interest: Number(r.interest),
        lastEventDate: r.lastEventDate,
      }));
    },

    async getRealizedGains(userId, opts) {
      const conds = [eq(realizedGains.userId, userId)];
      if (opts?.accountId) conds.push(eq(realizedGains.accountId, opts.accountId));
      if (opts?.year !== undefined) {
        conds.push(sql`extract(year from ${realizedGains.disposedDate})::int = ${opts.year}`);
      }
      const rows = await db
        .select()
        .from(realizedGains)
        .where(and(...conds))
        .orderBy(desc(realizedGains.disposedDate), realizedGains.disposalEventId, realizedGains.lotIndex);
      return rows.map(mapRealizedGain);
    },

    async getTaxProfile(userId) {
      const [row] = await db.select().from(taxProfiles).where(eq(taxProfiles.userId, userId));
      return row === undefined ? null : mapTaxProfile(row);
    },

    async upsertTaxProfile(userId, input) {
      const values = {
        userId,
        filingStatus: input.filingStatus,
        marginalOrdinaryRatePct: String(input.marginalOrdinaryRatePct),
        ltcgRatePct: String(input.ltcgRatePct),
        stateRatePct: input.stateRatePct === null ? null : String(input.stateRatePct),
      };
      const [row] = await db
        .insert(taxProfiles)
        .values(values)
        .onConflictDoUpdate({
          target: taxProfiles.userId,
          set: {
            filingStatus: values.filingStatus,
            marginalOrdinaryRatePct: values.marginalOrdinaryRatePct,
            ltcgRatePct: values.ltcgRatePct,
            stateRatePct: values.stateRatePct,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      return mapTaxProfile(row);
    },

    async backfillRealizedGains() {
      // Loop every account, each under its own advisory-locked transaction — the
      // idempotent (delete-then-reinsert) materializer, so re-running is safe.
      const allAccounts = await db.select({ id: accounts.id }).from(accounts).orderBy(accounts.id);
      for (const a of allAccounts) {
        await db.transaction(async (tx) => {
          await acquireRealizedLock(tx, a.id);
          await materializeRealizedGains(tx, a.id);
        });
      }
    },

    async getQuotes(tickers) {
      const wanted = [...new Set(tickers.map((t) => t.toUpperCase()))];
      if (wanted.length === 0) return [];
      const rows = await db.select().from(quotes).where(inArray(quotes.ticker, wanted));
      return rows.map(mapQuote);
    },

    async upsertQuotes(rows) {
      if (rows.length === 0) return;
      // In-memory dedupe by ticker first: two rows for the same ticker in one
      // batch would trip an intra-statement ON CONFLICT ("cannot affect row a
      // second time"). Last write wins — the same policy the PK conflict applies.
      const byTicker = new Map<string, QuoteInput>();
      for (const r of rows) byTicker.set(r.ticker.toUpperCase(), r);
      const values = [...byTicker.entries()].map(([ticker, r]) => ({
        ticker,
        price: String(r.price),
        asOf: r.asOf,
        source: r.source,
      }));
      await db.transaction(async (tx) => {
        await tx
          .insert(quotes)
          .values(values)
          .onConflictDoUpdate({
            target: quotes.ticker,
            set: {
              price: sql`excluded.price`,
              asOf: sql`excluded.as_of`,
              source: sql`excluded.source`,
              // Cache-write time advances on every refresh (distinct from the
              // quote's own `as_of`), so a re-fetch of the same price is still
              // recorded as freshly cached.
              fetchedAt: sql`now()`,
            },
          });
      });
    },

    async getInstrumentClassifications(tickers) {
      const wanted = [...new Set(tickers.map((t) => t.toUpperCase()))];
      if (wanted.length === 0) return [];
      const rows = await db
        .select()
        .from(instrumentClassifications)
        .where(inArray(instrumentClassifications.ticker, wanted));
      return rows.map(mapInstrumentClassification);
    },

    async upsertInstrumentClassifications(rows) {
      if (rows.length === 0) return;
      // In-memory dedupe by ticker first (the `upsertQuotes` precedent): two rows
      // for the same ticker in one batch would trip an intra-statement ON CONFLICT.
      const byTicker = new Map<string, InstrumentClassificationInput>();
      for (const r of rows) byTicker.set(r.ticker.toUpperCase(), r);
      const values = [...byTicker.entries()].map(([ticker, r]) => ({
        ticker,
        sector: r.sector,
        source: r.source,
      }));
      await db.transaction(async (tx) => {
        await tx
          .insert(instrumentClassifications)
          .values(values)
          .onConflictDoUpdate({
            target: instrumentClassifications.ticker,
            set: {
              sector: sql`excluded.sector`,
              source: sql`excluded.source`,
              fetchedAt: sql`now()`,
            },
          });
      });
    },
  };
}
