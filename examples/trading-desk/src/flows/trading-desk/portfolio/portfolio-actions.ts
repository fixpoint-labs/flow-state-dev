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
 * Merge semantics (spec §3.4):
 *  - `upsert` (default): each parsed row replaces that `(account, ticker)`
 *    holding's quantity/cost/date; tickers in the account but not in the CSV are
 *    left untouched.
 *  - `replace-account`: delete every holding under the account's prefix, then
 *    create the parsed rows. Non-atomic (RISK-P6) — documented, not fixed.
 *
 * No generator output schemas here — the parser is deterministic TS, so BP-016
 * has no surface (the resource-state schemas are NOT added to the strict walker;
 * they use `.default()`, which strict mode correctly rejects).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { parsePortfolioCsv, type RowError } from "./portfolio-csv";
import { accountTypeSchema, holdingKey } from "./portfolio-schema";
import { portfolioResources } from "./portfolio-resources";

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
 */
export const saveAccount = handler({
  name: "save-account",
  inputSchema: z.object({
    accountId: z.string().nullable().default(null),
    name: z.string().min(1).max(80),
    type: accountTypeSchema,
    currency: z.string().length(3).default("USD"),
    cashBalance: z.number().default(0),
  }),
  outputSchema: z.object({ accountId: z.string() }),
  resources: portfolioResources,
  execute: async (input, ctx) => {
    const accountId = input.accountId ?? crypto.randomUUID();
    const now = nowIso();
    await ctx.resources.accounts.upsert(
      accountId,
      {
        accountId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        cashBalance: input.cashBalance,
        updatedAt: now,
      },
      // create-only: set the audit floor + the id when the account is new.
      { accountId, createdAt: now, updatedAt: now },
    );
    return { accountId };
  },
});

/**
 * Delete an account and every holding under it. Lists the account's holdings by
 * storage-key prefix, deletes each, then deletes the account. Touching resource
 * refs from a handler is BP-011-safe.
 */
export const deleteAccount = handler({
  name: "delete-account",
  inputSchema: z.object({ accountId: z.string() }),
  outputSchema: z.void(),
  resources: portfolioResources,
  execute: async (input, ctx) => {
    const refs = await ctx.resources.holdings.list(`${input.accountId}__`);
    for (const ref of refs) {
      await ctx.resources.holdings.delete(
        holdingKey(input.accountId, ref.state.ticker),
      );
    }
    await ctx.resources.accounts.delete(input.accountId);
  },
});

/** Delete one holding. State-mutation-only (BP-012). */
export const deleteHolding = handler({
  name: "delete-holding",
  inputSchema: z.object({ accountId: z.string(), ticker: z.string() }),
  outputSchema: z.void(),
  resources: portfolioResources,
  execute: async (input, ctx) => {
    await ctx.resources.holdings.delete(
      holdingKey(input.accountId, input.ticker.toUpperCase()),
    );
  },
});

/**
 * Import a CSV into a target account. Parses (server-side re-parse, never trusts
 * the client preview), applies the merge mode, optionally patches the account's
 * cash balance, and returns the authoritative import report.
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
  resources: portfolioResources,
  execute: async (input, ctx) => {
    const parsed = parsePortfolioCsv(input.csvText);
    const errors: RowError[] = [...parsed.errors];
    const warnings: string[] = [...parsed.warnings];
    const now = nowIso();

    let deleted = 0;
    if (input.mode === "replace-account") {
      // Full-snapshot replace: delete every existing holding first, then create
      // the parsed rows below. Non-atomic (no transaction) — RISK-P6.
      const existingRefs = await ctx.resources.holdings.list(
        `${input.accountId}__`,
      );
      for (const ref of existingRefs) {
        await ctx.resources.holdings.delete(
          holdingKey(input.accountId, ref.state.ticker),
        );
        deleted += 1;
      }
    }

    let imported = 0;
    let updated = 0;
    for (const row of parsed.rows) {
      const key = holdingKey(input.accountId, row.ticker);
      const prior =
        input.mode === "replace-account"
          ? undefined
          : await ctx.resources.holdings.getOptional(key);
      const isUpdate = prior !== undefined;
      await ctx.resources.holdings.upsert(
        key,
        {
          accountId: input.accountId,
          ticker: row.ticker,
          quantity: row.quantity,
          costBasis: row.costBasis,
          acquiredDate: row.acquiredDate,
          updatedAt: now,
        },
        { accountId: input.accountId, ticker: row.ticker, createdAt: now },
      );
      if (isUpdate) updated += 1;
      else imported += 1;
    }

    // Cash is not carried by the row format — patch it separately when the
    // dialog supplied it. Skip silently if the account does not exist.
    if (input.cashBalance !== null) {
      const account = await ctx.resources.accounts.getOptional(input.accountId);
      if (account !== undefined) {
        await account.patchState({
          cashBalance: input.cashBalance,
          updatedAt: now,
        });
      }
    }

    return { imported, updated, deleted, errors, warnings };
  },
});
