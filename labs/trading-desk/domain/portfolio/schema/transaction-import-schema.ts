/**
 * Pure, browser-safe schema for the transaction-file import report (FIX-775).
 *
 * Imports ONLY `zod` — no `@flow-state-dev/core`, no `node:*` — so the import
 * dialog can type the preview client-side and the `importTransactions` action
 * can shape its return off one definition (BP-019: leaf module, no cycles).
 *
 * `FileImportReport` wraps the FIX-774 `IngestReport` counts (`inserted` /
 * `deduplicated`, unchanged contract) and adds the parse-level diagnostics a
 * file import produces that a manual entry can't: the detected format, per-line
 * parse errors, import-level warnings, the securities whose ticker could not be
 * resolved (CUSIP-only — see the OFX parser), and the corporate-action
 * aggregates skipped rather than fed to naive basis math. This mirrors how the
 * holdings-import `importReportSchema` carries `errors` + `warnings` beside its
 * counts. A fixed-shape handler output (not a generator output), so BP-016 does
 * not apply.
 */
import { z } from "zod";

/** A security the file referenced by CUSIP that carried no ticker in its
 *  `SECLIST` entry (e.g. a Fidelity export). The event still lands keyed by the
 *  CUSIP; this surfaces it for manual ticker mapping (it won't attach to a
 *  ticker-keyed holding until mapped). */
export const unresolvedSecuritySchema = z.object({
  cusip: z.string(),
  name: z.string().nullable(),
});
export type UnresolvedSecurity = z.infer<typeof unresolvedSecuritySchema>;

/** A transaction aggregate the parser recognized but did NOT ingest — a
 *  corporate action (`SPLIT` / `RETOFCAP` / `CLOSUREOPT`) whose quantity/basis
 *  effect naive FIFO can't honor in v1, surfaced so the user can record it
 *  manually rather than silently corrupting basis. */
export const skippedAggregateSchema = z.object({
  kind: z.string(),
  reason: z.string(),
});
export type SkippedAggregate = z.infer<typeof skippedAggregateSchema>;

/**
 * The authoritative result of a transaction-file import. `inserted` +
 * `deduplicated` come straight from the ledger ingestion contract (they sum to
 * the number of events the parser produced). `parseErrors` carry rows the
 * parser rejected (a `line` when the source has one — CSV — else null);
 * `warnings` are import-level notes (an unhandled aggregate, a CUSIP with no
 * ticker); `unresolvedSecurities` and `skipped` are the structured detail the
 * dialog renders for follow-up.
 */
export const fileImportReportSchema = z.object({
  inserted: z.number(),
  deduplicated: z.number(),
  detectedFormat: z.string(),
  parseErrors: z.array(z.object({ line: z.number().nullable(), reason: z.string() })),
  warnings: z.array(z.string()),
  unresolvedSecurities: z.array(unresolvedSecuritySchema),
  skipped: z.array(skippedAggregateSchema),
});
export type FileImportReport = z.infer<typeof fileImportReportSchema>;
