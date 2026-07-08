/**
 * Portfolio write operations — the account / holdings / ledger mutations, as
 * plain server functions over the app-owned repository (FIX-772).
 *
 * These are deliberately NOT flow actions. The portfolio domain is basic
 * relational CRUD; a flow buys it nothing (no streaming, no session state, no
 * reactive resource) and costs it plenty — `sendAction` returns a request
 * envelope rather than the handler's output, so an import report can't reach
 * the UI, and a mutation needs a bound session. So the write surface is plain
 * Next.js routes (see `app/api/portfolio/*`) calling these functions, exactly
 * as the read surface is (the `accounts` / `ledger` / `income` GET routes).
 * The genuinely flow-shaped work stays in the `portfolio` flow: `getQuotes`
 * (writes the cross-flow `portfolioQuotes` resource) and `extractHoldingsFromPdf`
 * (an LLM generator that streams). This is the showcase boundary — flows for
 * the agentic/streaming/cross-flow work, routes for domain CRUD.
 *
 * Each function takes an already-validated input, the caller's `userId` (the
 * household key the repository scopes on), and the repository. The HTTP routes
 * own zod validation and the client-asserted-userId dev posture; these
 * functions own the domain shaping (UUID minting, ticker canonicalization,
 * report counting) and are unit-tested directly against a PGlite repository.
 *
 * The parser is deterministic TS, so no generator output schemas / BP-016 here.
 */
import { z } from "zod";
import type { PortfolioRepository } from "@/src/db/repository";
import type { FileImportReport } from "./transaction-import-schema";
import { parsePortfolioCsv, type RowError } from "./portfolio-csv";
import { accountTypeSchema, assetClassSchema, type AssetClass } from "./portfolio-schema";
import { ledgerEventInputSchema, type IngestReport } from "./ledger-schema";
import { taxProfileInputSchema, type TaxProfileInput } from "./tax-schema";
import { detectAndParseTransactionFile } from "./transaction-file";
import type { TaxProfileRow } from "@/src/db/repository";

/** CSV import feedback (a plain handler-style result, not a generator output).
 *  `errors`/`warnings` carry the per-row + import-level notes the dialog can
 *  render ("imported 18, updated 3, 2 skipped"). */
export const importReportSchema = z.object({
  imported: z.number(),
  updated: z.number(),
  deleted: z.number(),
  errors: z.array(
    z.object({ rowNumber: z.number(), raw: z.string(), reason: z.string() }),
  ),
  warnings: z.array(z.string()),
});
export type ImportReport = z.infer<typeof importReportSchema>;

/** Request body for a create-or-update account write. `accountId: null` mints
 *  a new account; a value updates in place. */
export const saveAccountSchema = z.object({
  accountId: z.string().nullable().default(null),
  name: z.string().min(1).max(80),
  type: accountTypeSchema,
  currency: z.string().length(3).default("USD"),
  cashBalance: z.number().default(0),
  // The account's default risk-appetite mandate id (FIX-752), or null. Opaque
  // string — validated downstream by the analysis flow, not here.
  riskMandate: z.string().nullable().default(null),
});
export type SaveAccountInput = z.infer<typeof saveAccountSchema>;

/** Request body for a manual ledger entry — the canonical event minus the
 *  feed-owned `source` / `externalId` (fixed to `manual` / null here). */
export const recordEventSchema = ledgerEventInputSchema.omit({
  source: true,
  externalId: true,
});
export type RecordEventInput = z.infer<typeof recordEventSchema>;

/** Request body for a tax-profile save (the route re-applies `userId`). */
export const saveTaxProfileSchema = taxProfileInputSchema;
export type SaveTaxProfileInput = TaxProfileInput;

/** Request body for a CSV holdings import. */
export const importHoldingsSchema = z.object({
  accountId: z.string(),
  csvText: z.string(),
  mode: z.enum(["upsert", "replace-account"]).default("upsert"),
  cashBalance: z.number().nullable().default(null),
});
export type ImportHoldingsInput = z.infer<typeof importHoldingsSchema>;

/** Request body for an OFX-family transaction-file import. */
export const importTransactionsSchema = z.object({
  accountId: z.string(),
  content: z.string(),
  filename: z.string().nullable().default(null),
});
export type ImportTransactionsInput = z.infer<typeof importTransactionsSchema>;

/**
 * Create or update an account. Mints a UUID on first save; the repository
 * preserves `createdAt` and bumps `updatedAt`. Holdings are a separate table,
 * so a metadata edit never touches positions. Returns the id so the UI can
 * select the new account.
 */
export async function saveAccount(
  input: SaveAccountInput,
  userId: string,
  repo: PortfolioRepository,
): Promise<{ accountId: string }> {
  const accountId = input.accountId ?? crypto.randomUUID();
  await repo.upsertAccount({
    id: accountId,
    userId,
    name: input.name,
    type: input.type,
    currency: input.currency,
    cashBalance: input.cashBalance,
    riskMandate: input.riskMandate,
  });
  return { accountId };
}

/**
 * Delete an account — scoped to the caller's household (a delete for someone
 * else's account is a no-op). The FK cascade drops its holdings and ledger
 * events in the same statement.
 */
export async function deleteAccount(
  accountId: string,
  userId: string,
  repo: PortfolioRepository,
): Promise<void> {
  await repo.deleteAccount(accountId, userId);
}

/**
 * Delete one holding by `(account, ticker)` — a no-op when absent. Tickers are
 * stored upper-case (the CSV parser normalizes), so the input is upper-cased.
 */
export async function deleteHolding(
  accountId: string,
  ticker: string,
  userId: string,
  repo: PortfolioRepository,
): Promise<void> {
  await repo.deleteHolding(accountId, ticker.toUpperCase(), userId);
}

/** Body of the `PATCH /api/portfolio/holdings` asset-class override. */
export const setHoldingAssetClassSchema = z.object({
  userId: z.string().min(1),
  accountId: z.string().min(1),
  ticker: z.string().min(1),
  assetClass: assetClassSchema,
});

/** Manually set a holding's allocation class (marks it `asset_class_manual`, so
 *  auto-classification preserves it). Household-scoped by the repository. */
export async function setHoldingAssetClass(
  accountId: string,
  ticker: string,
  userId: string,
  assetClass: AssetClass,
  repo: PortfolioRepository,
): Promise<void> {
  await repo.setHoldingAssetClass(accountId, userId, ticker.toUpperCase(), assetClass);
}

/**
 * Record one manual ledger event (FIX-774). Fixes `source: "manual"` (a manual
 * entry can't claim to be a Plaid/file row), canonicalizes the ticker to
 * trimmed upper-case so basis recompute keys match the holdings rows, and
 * ingests through the shared contract (dedup + ownership guard + position
 * materialization). A re-submit of the same event reports `deduplicated`, not a
 * second row.
 */
export async function recordManualEvent(
  input: RecordEventInput,
  userId: string,
  repo: PortfolioRepository,
): Promise<IngestReport> {
  const ticker =
    input.ticker === null ? null : input.ticker.trim().toUpperCase() || null;
  // A sell's proceeds are cash IN — non-negative by the ledger sign convention
  // (buy `−`, sell `+`). The dialog takes a user-signed amount, so a sale entered
  // with a negative amount would trip the share-event invariant (FIX-874) and
  // silently fail to record. Canonicalize the sign here — the OFX importer's
  // `Math.abs(total)` precedent — so the manual path and the invariant agree.
  const amount = input.type === "sell" ? Math.abs(input.amount) : input.amount;
  // `proceedsUnknown` is import-only (a feed normalizer's signal that a file
  // couldn't supply proceeds). Force it null on the manual path so a caller can't
  // null out a real sale's proceeds by hand.
  return repo.ingestLedgerEvents(
    [{ ...input, amount, ticker, source: "manual", externalId: null, proceedsUnknown: null }],
    userId,
  );
}

/**
 * Save (create or replace) the user's tax profile (FIX-874) — filing status and
 * the marginal/LTCG/state rates that drive the upper-bound estimate. Keyed on
 * `userId` (the household), so a save overwrites in place. The route owns zod
 * validation (the `ledger` route precedent).
 */
export async function saveTaxProfile(
  input: SaveTaxProfileInput,
  userId: string,
  repo: PortfolioRepository,
): Promise<TaxProfileRow> {
  return repo.upsertTaxProfile(userId, input);
}

/**
 * Import a CSV into a target account. Re-parses server-side (never trusts a
 * client preview), writes through the repository per the merge mode, optionally
 * updates cash, and returns the authoritative report. A missing account is an
 * edge guard, not a normal path — nothing is written and the report explains.
 */
export async function importHoldingsCsv(
  input: ImportHoldingsInput,
  userId: string,
  repo: PortfolioRepository,
): Promise<ImportReport> {
  const { accounts, holdings } = await repo.getPortfolio(userId);
  const account = accounts.find((a) => a.accountId === input.accountId);
  if (account === undefined) {
    return {
      imported: 0,
      updated: 0,
      deleted: 0,
      errors: [],
      warnings: [
        `Account ${input.accountId} was not found — nothing imported. Create the account first.`,
      ],
    };
  }

  const parsed = parsePortfolioCsv(input.csvText);
  const errors: RowError[] = [...parsed.errors];
  const warnings: string[] = [...parsed.warnings];

  // Cash double-count guard (FIX-773). A cash-class row (a money-market fund or a
  // `CASH` line) values at par $1.00 and lands in NAV as a position; the account's
  // own `cashBalance` field ALSO counts as cash. When a statement carries its
  // sweep/MMF as a line AND the account has a non-zero cash balance, the same
  // dollars can be counted twice. We can't tell which is authoritative, so we warn
  // rather than silently net them (the real-money honesty gate). Uses the
  // post-import effective balance (`input.cashBalance` wins when the import also
  // sets it, else the account's existing balance).
  const effectiveCash =
    input.cashBalance !== null ? input.cashBalance : account.cashBalance;
  const cashRows = parsed.rows.filter((r) => r.assetClass === "cash");
  if (cashRows.length > 0 && effectiveCash !== 0) {
    warnings.push(
      `${cashRows.length} cash/money-market row(s) (${cashRows
        .map((r) => r.ticker)
        .join(", ")}) import alongside a non-zero account cash balance ` +
        `(${effectiveCash}) — verify the sweep/MMF isn't counted twice (once as a ` +
        `holding valued at par, once as the account's cash balance).`,
    );
  }

  // Report counts: compare parsed rows against the account's existing tickers.
  // The repository owns the actual write (upsert-in-place / atomic replace);
  // these are the UI-facing summary of the change.
  const existingTickers = new Set(
    holdings.filter((h) => h.accountId === input.accountId).map((h) => h.ticker),
  );
  const parsedTickers = new Set(parsed.rows.map((r) => r.ticker));
  let imported = 0;
  let updated = 0;
  for (const r of parsed.rows) {
    if (existingTickers.has(r.ticker)) updated += 1;
    else imported += 1;
  }
  const deleted =
    input.mode === "replace-account"
      ? [...existingTickers].filter((t) => !parsedTickers.has(t)).length
      : 0;

  // Holdings + optional cash write in one repository transaction (no window
  // where new holdings carry stale cash). The repository re-checks ownership
  // inside that transaction on top of the edge guard above.
  await repo.upsertHoldings(input.accountId, userId, parsed.rows, input.mode, input.cashBalance);

  return { imported, updated, deleted, errors, warnings };
}

/**
 * Import a brokerage transaction-history file (OFX family: QFX / QBO / raw OFX)
 * into a target account's ledger (FIX-775), writing through the SAME
 * `ingestLedgerEvents` contract manual entry uses. Injects the chosen
 * `accountId` and fixes `source: "file"`, then ingests. The two-tier dedup
 * makes a re-import idempotent, and the ingest materializes derived positions
 * into holdings, so the import alone reconstructs positions, cost basis, and
 * hold periods. A missing/foreign account is reported, not thrown.
 */
export async function importTransactionFile(
  input: ImportTransactionsInput,
  userId: string,
  repo: PortfolioRepository,
): Promise<FileImportReport> {
  const parsed = await detectAndParseTransactionFile(
    input.content,
    input.filename ?? undefined,
  );
  const diag = parsed.diagnostics;

  const report = (over: {
    inserted: number;
    deduplicated: number;
    warnings?: string[];
    extraParseErrors?: { line: number | null; reason: string }[];
  }): FileImportReport => ({
    inserted: over.inserted,
    deduplicated: over.deduplicated,
    detectedFormat: parsed.format,
    parseErrors: [...diag.parseErrors, ...(over.extraParseErrors ?? [])],
    warnings: over.warnings ?? diag.warnings,
    unresolvedSecurities: diag.unresolvedSecurities,
    skipped: diag.skipped,
  });

  // Nothing parsed (a parse error, or a file with no investment transactions):
  // report the diagnostics without touching the ledger.
  if (parsed.events.length === 0) return report({ inserted: 0, deduplicated: 0 });

  // Edge guard: import requires an existing account the caller owns.
  // getPortfolio only returns the caller's own accounts, so a foreign id
  // simply isn't found.
  const { accounts } = await repo.getPortfolio(userId);
  if (!accounts.some((a) => a.accountId === input.accountId)) {
    return report({
      inserted: 0,
      deduplicated: 0,
      warnings: [
        ...diag.warnings,
        `Account ${input.accountId} was not found — nothing imported. Create or select the account first.`,
      ],
    });
  }

  const events = parsed.events.map((e) => ({
    ...e,
    accountId: input.accountId,
    source: "file" as const,
  }));
  const ingest = await repo.ingestLedgerEvents(events, userId);

  return report({
    inserted: ingest.inserted,
    deduplicated: ingest.deduplicated,
    extraParseErrors: ingest.errors.map((e) => ({ line: null, reason: e.reason })),
  });
}
