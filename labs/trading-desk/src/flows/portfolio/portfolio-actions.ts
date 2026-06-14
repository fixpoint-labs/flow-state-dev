/**
 * Portfolio write actions — `saveAccount`, `deleteAccount`, `importHoldings`,
 * `deleteHolding`.
 *
 * Each is a SINGLE handler (BP-011-safe): it only touches resource refs, which
 * a handler may do — that is not calling a block. None composes another block,
 * so no sequencer is needed. State-mutation-only actions (`deleteAccount`,
 * `deleteHolding`) return `void` (BP-012, never `return input` per BP-014);
 * `saveAccount` and `importHoldings` return a real transformation (the new id /
 * the import report), which the UI needs as feedback.
 *
 * Holdings live inline in the account record (`accountStateSchema.holdings`), so
 * every write here is a single write to one `accounts/{accountId}` record — no
 * separate holdings collection, no `{accountId}__{ticker}` composite keys.
 *
 * Import merge semantics (spec §3.4) operate on the account's `holdings` array:
 *  - `upsert` (default): each parsed row replaces the matching ticker's
 *    quantity/cost/date in place; tickers already in the account but not in the
 *    CSV are left untouched; new tickers are appended.
 *  - `replace-account`: set `holdings` to exactly the parsed rows. Atomic now —
 *    it is one record write (the prior per-row delete-then-create non-atomicity,
 *    RISK-P6, dissolves with the single-collection model).
 *
 * No generator output schemas here — the parser is deterministic TS, so BP-016
 * has no surface (the resource-state schemas are NOT added to the strict walker;
 * they use `.default()`, which strict mode correctly rejects).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { parsePortfolioCsv, type RowError } from "./portfolio-csv";
import { accountTypeSchema, type Holding } from "./portfolio-schema";
import { pdfImportResource, portfolioResources } from "./portfolio-resources";

/** Import feedback. Handler output (not a generator output) so a fixed-shape
 *  object is fine; `errors`/`warnings` carry the per-row + import-level notes
 *  the dialog renders ("imported 18, updated 3, 2 skipped"). */
export const importReportSchema = z.object({
  imported: z.number(),
  updated: z.number(),
  deleted: z.number(),
  errors: z.array(
    z.object({
      rowNumber: z.number(),
      raw: z.string(),
      reason: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});
export type ImportReport = z.infer<typeof importReportSchema>;

/** ISO now, shared by every create/update audit stamp in this file. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Create or update an account. Generates a UUID + timestamps on first save;
 * preserves `createdAt` and bumps `updatedAt` on update. Returns the id so the
 * UI can select the new account.
 *
 * Holdings are NOT in the metadata-edit surface: the update branch patches only
 * the metadata fields (name/type/currency/cashBalance/updatedAt), so the
 * existing `holdings` array is preserved — a metadata edit never wipes
 * positions. The create branch seeds `holdings: []` for a fresh account.
 */
export const saveAccount = handler({
  name: "save-account",
  inputSchema: z.object({
    accountId: z.string().nullable().default(null),
    name: z.string().min(1).max(80),
    type: accountTypeSchema,
    currency: z.string().length(3).default("USD"),
    cashBalance: z.number().default(0),
    // The account's default risk-appetite mandate id (FIX-752), or null. Opaque
    // string — validated downstream by the analysis flow, not here.
    riskMandate: z.string().nullable().default(null),
  }),
  outputSchema: z.object({ accountId: z.string() }),
  resources: portfolioResources,
  execute: async (input, ctx) => {
    const accountId = input.accountId ?? crypto.randomUUID();
    const now = nowIso();
    await ctx.resources.accounts.upsert(
      accountId,
      // update branch: a partial patch that omits `holdings`, so an existing
      // account's positions survive a metadata edit untouched.
      {
        accountId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        cashBalance: input.cashBalance,
        riskMandate: input.riskMandate,
        updatedAt: now,
      },
      // create-only: set the audit floor, the id, and an empty holdings array
      // when the account is new.
      { accountId, createdAt: now, updatedAt: now, holdings: [] },
    );
    return { accountId };
  },
});

/**
 * Delete an account. Holdings ride along inside the record, so deleting the
 * account drops its positions in the same write — no separate cleanup loop.
 * Touching resource refs from a handler is BP-011-safe.
 */
export const deleteAccount = handler({
  name: "delete-account",
  inputSchema: z.object({ accountId: z.string() }),
  outputSchema: z.void(),
  resources: portfolioResources,
  execute: async (input, ctx) => {
    await ctx.resources.accounts.delete(input.accountId);
  },
});

/**
 * Delete one holding: read the account, drop the matching ticker from its
 * `holdings` array, and write the account back. State-mutation-only (BP-012);
 * a no-op if the account or the ticker is absent.
 */
export const deleteHolding = handler({
  name: "delete-holding",
  inputSchema: z.object({ accountId: z.string(), ticker: z.string() }),
  outputSchema: z.void(),
  resources: portfolioResources,
  execute: async (input, ctx) => {
    const account = await ctx.resources.accounts.getOptional(input.accountId);
    if (account === undefined) return;
    const ticker = input.ticker.toUpperCase();
    const holdings = (account.state.holdings as Holding[]).filter(
      (h) => h.ticker !== ticker,
    );
    await account.patchState({ holdings, updatedAt: nowIso() });
  },
});

/** Map a parsed canonical row to a stored {@link Holding}. */
function rowToHolding(row: {
  ticker: string;
  quantity: number;
  costBasis: number | null;
  acquiredDate: string | null;
}): Holding {
  return {
    ticker: row.ticker,
    quantity: row.quantity,
    costBasis: row.costBasis,
    acquiredDate: row.acquiredDate,
  };
}

/**
 * Import a CSV into a target account. Parses (server-side re-parse, never trusts
 * the client preview), merges the rows into the account's inline `holdings`
 * array per the mode, optionally patches the account's cash balance, writes the
 * account ONCE, and returns the authoritative import report.
 *
 * The target account must already exist (the UI only enables import when an
 * account is selected). If it does not, nothing is imported and the report
 * carries an explanatory error — an edge guard, not a normal path.
 *
 * Also resets the `pdfImport` scratch resource on completion. The PDF import flow
 * routes its confirmed rows through this same action, so a finished import is
 * where the now-consumed extraction is cleared — without it a stale extraction is
 * read as the current one on the next PDF import (it surfaced the prior PDF's
 * holdings). A no-op for the CSV path (the resource is already null).
 */
export const importHoldings = handler({
  name: "import-holdings",
  inputSchema: z.object({
    accountId: z.string(),
    csvText: z.string(),
    mode: z.enum(["upsert", "replace-account"]).default("upsert"),
    cashBalance: z.number().nullable().default(null),
  }),
  outputSchema: importReportSchema,
  resources: { ...portfolioResources, pdfImport: pdfImportResource },
  execute: async (input, ctx) => {
    const now = nowIso();

    // Edge guard: import requires an existing account. Clear the scratch (a PDF
    // import may have populated it) and report the miss without touching state.
    const account = await ctx.resources.accounts.getOptional(input.accountId);
    if (account === undefined) {
      await ctx.resources.pdfImport.setState(null);
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

    const existing = account.state.holdings as Holding[];
    const parsedHoldings = parsed.rows.map(rowToHolding);

    let imported = 0;
    let updated = 0;
    let deleted = 0;
    let nextHoldings: Holding[];

    if (input.mode === "replace-account") {
      // Full-snapshot replace: the account's holdings become exactly the parsed
      // rows. Atomic — one record write (the prior per-row delete-then-create
      // race, RISK-P6, no longer exists).
      const existingTickers = new Set(existing.map((h) => h.ticker));
      for (const h of parsedHoldings) {
        if (existingTickers.has(h.ticker)) updated += 1;
        else imported += 1;
      }
      deleted = existing.filter(
        (h) => !parsedHoldings.some((p) => p.ticker === h.ticker),
      ).length;
      nextHoldings = parsedHoldings;
    } else {
      // Upsert: a parsed row replaces the matching ticker in place; tickers not
      // in the CSV are left untouched; new tickers are appended.
      const byTicker = new Map(existing.map((h) => [h.ticker, h]));
      for (const h of parsedHoldings) {
        if (byTicker.has(h.ticker)) updated += 1;
        else imported += 1;
        byTicker.set(h.ticker, h);
      }
      nextHoldings = [...byTicker.values()];
    }

    // One write: the merged holdings, plus the cash balance when the dialog
    // supplied it (cash is not carried by the row format).
    await account.patchState({
      holdings: nextHoldings,
      updatedAt: now,
      ...(input.cashBalance !== null ? { cashBalance: input.cashBalance } : {}),
    });

    // Clear the consumed PDF extraction scratch (no-op on the CSV path —
    // already null). `setState(null)` replaces the whole nullable state;
    // `patchState` (a partial merge) cannot express null.
    await ctx.resources.pdfImport.setState(null);

    return { imported, updated, deleted, errors, warnings };
  },
});
