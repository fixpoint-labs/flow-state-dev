/**
 * Session-scoped "financials" slice of the analysis data spine.
 *
 * Holds the subject ticker's raw financial payloads — the fundamentals snapshot
 * and the three statements — as the stable, per-session copy the run actually
 * used. The fundamentals analyst's tools write each field once via
 * `getOrPatchState`; the valuation-spine tap (and any later consumer) reads that
 * same copy instead of re-fetching or relying on a process TTL cache being warm.
 *
 * One session = one ticker, so each payload is a single named field rather than
 * an args-keyed record — which keeps the schema tight (each field is exactly its
 * tool's output shape) and write contention low (distinct fields, distinct
 * writers). Server-side only: these are large upstream payloads, not view data.
 * Fields are optional — absent means "not fetched yet", which is the miss
 * `getOrPatchState` computes on.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { recoveryAuditSchema, toolOutputSchemas } from "./tools/schemas";

export const financialsDataStateSchema = z.object({
  fundamentals: toolOutputSchemas.get_fundamentals.optional(),
  balanceSheet: toolOutputSchemas.get_balance_sheet.optional(),
  incomeStatement: toolOutputSchemas.get_income_statement.optional(),
  cashflow: toolOutputSchemas.get_cashflow.optional(),
  // Critical-source recovery audit (FIX-898). Written once per run by the
  // recovery runtime when recovery RUNS — records how the IPO/prospectus ladder
  // terminated (promoted / rejected / no-candidates / extract-failed), so an
  // "unavailable" statement carries an explicit trail rather than an unexplained
  // void. Absent when companyfacts/Yahoo answered (recovery never ran).
  recoveryAudit: recoveryAuditSchema.optional(),
});

export type FinancialsDataState = z.infer<typeof financialsDataStateSchema>;

export const financialsDataResource = defineResource({
  scope: "session",
  ref: "financialsData",
  stateSchema: financialsDataStateSchema,
  default: {},
});
