/**
 * Portfolio write actions — `saveAccount`, `deleteAccount`, `importHoldings`,
 * `deleteHolding`.
 *
 * Each is a SINGLE handler (BP-011-safe): it does I/O against the app-owned
 * portfolio repository (FIX-772), which a handler may do — that is not calling a
 * block. None composes another block, so no sequencer is needed. State-mutation-
 * only actions (`deleteAccount`, `deleteHolding`) return `void` (BP-012, never
 * `return input` per BP-014); `saveAccount` and `importHoldings` return a real
 * transformation (the new id / the import report), which the UI needs as
 * feedback.
 *
 * Accounts and holdings live in the relational `app.accounts` / `app.holdings`
 * tables, reached through `getRepository()`. Holdings are real rows keyed
 * `(account_id, ticker)`, so a metadata edit never touches positions and a
 * delete cascades via the FK — no inline-array rewrite.
 *
 * Import merge semantics are unchanged and owned by the repository
 * (`upsertHoldings`):
 *  - `upsert` (default): each parsed row replaces the matching ticker in place;
 *    tickers absent from the CSV are left untouched; new tickers are inserted.
 *  - `replace-account`: the account's holdings become exactly the parsed rows,
 *    atomically (delete-all + insert in one transaction — the prior RISK-P6
 *    non-atomicity is gone).
 *
 * No generator output schemas here — the parser is deterministic TS, so BP-016
 * has no surface.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import { parsePortfolioCsv, type RowError } from "./portfolio-csv";
import { accountTypeSchema } from "./portfolio-schema";
import { pdfImportResource } from "./portfolio-resources";

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

/** The caller's resolved user id — the household key the repository scopes on.
 *  `requireUser: true` guarantees a user at runtime; the `"unknown_user"`
 *  fallback matches the framework's own key resolution and satisfies the type. */
function userId(ctx: { request: { identity: { userId?: string } } }): string {
  return ctx.request.identity.userId ?? "unknown_user";
}

/**
 * Create or update an account. Generates a UUID on first save; the repository
 * preserves `createdAt` and bumps `updatedAt` on update, and owns the audit
 * timestamps. Returns the id so the UI can select the new account.
 *
 * Holdings are a separate table, so an account upsert never touches positions —
 * a metadata edit preserves them by construction (no inline `holdings` to omit).
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
  execute: async (input, ctx) => {
    const accountId = input.accountId ?? crypto.randomUUID();
    const repo = await getRepository();
    await repo.upsertAccount({
      id: accountId,
      userId: userId(ctx),
      name: input.name,
      type: input.type,
      currency: input.currency,
      cashBalance: input.cashBalance,
      riskMandate: input.riskMandate,
    });
    return { accountId };
  },
});

/**
 * Delete an account. The FK cascade drops its holdings in the same statement —
 * no separate cleanup loop. Doing repository I/O from a handler is BP-011-safe.
 */
export const deleteAccount = handler({
  name: "delete-account",
  inputSchema: z.object({ accountId: z.string() }),
  outputSchema: z.void(),
  execute: async (input, ctx) => {
    const repo = await getRepository();
    // Scoped to the caller's household — a delete for someone else's account
    // is a no-op (restores the old user-scoped resource-delete boundary).
    await repo.deleteAccount(input.accountId, userId(ctx));
  },
});

/**
 * Delete one holding by `(account, ticker)`. State-mutation-only (BP-012); a
 * no-op when the row is absent. Tickers are stored upper-case (the CSV parser
 * normalizes), so the input is upper-cased to match.
 */
export const deleteHolding = handler({
  name: "delete-holding",
  inputSchema: z.object({ accountId: z.string(), ticker: z.string() }),
  outputSchema: z.void(),
  execute: async (input, ctx) => {
    const repo = await getRepository();
    await repo.deleteHolding(input.accountId, input.ticker.toUpperCase(), userId(ctx));
  },
});

/**
 * Import a CSV into a target account. Parses (server-side re-parse, never trusts
 * the client preview), writes the rows through the repository per the merge mode,
 * optionally updates the account's cash balance, and returns the authoritative
 * import report.
 *
 * The target account must already exist (the UI only enables import when an
 * account is selected). If it does not, nothing is imported and the report
 * carries an explanatory error — an edge guard, not a normal path.
 *
 * Also resets the `pdfImport` scratch resource on completion. The PDF import flow
 * routes its confirmed rows through this same action, so a finished import is
 * where the now-consumed extraction is cleared (a no-op for the CSV path).
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
  resources: { pdfImport: pdfImportResource },
  execute: async (input, ctx) => {
    const uid = userId(ctx);
    const repo = await getRepository();
    const { accounts, holdings } = await repo.getPortfolio(uid);
    const account = accounts.find((a) => a.accountId === input.accountId);

    // Edge guard: import requires an existing account. Clear the scratch (a PDF
    // import may have populated it) and report the miss without touching state.
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

    // Report counts: compare the parsed rows against the account's existing
    // tickers. The repository owns the actual write (upsert-in-place / atomic
    // replace); these counts are the UI-facing summary of the change.
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

    // Holdings + optional cash balance write in one repository transaction, so
    // the import is atomic (no window where new holdings carry stale cash). The
    // repository re-checks `uid` ownership inside that transaction (defense in
    // depth) on top of the edge guard above.
    await repo.upsertHoldings(input.accountId, uid, parsed.rows, input.mode, input.cashBalance);

    // Clear the consumed PDF extraction scratch (no-op on the CSV path —
    // already null). `setState(null)` replaces the whole nullable state.
    await ctx.resources.pdfImport.setState(null);

    return { imported, updated, deleted, errors, warnings };
  },
});
