/**
 * Portfolio resource definitions (BP-019 leaf) — the resources the `portfolio`
 * flow owns, grouped in one module so consumers (the report flow's seed snapshot,
 * the portfolio action handlers, the UI) import from a single place.
 *
 * Imports only `@flow-state-dev/core` + zod + the pure domain schema /
 * parser leaves — NEVER the action handlers — so the capability↔resource
 * graph stays cycle-free.
 *
 *   - `pdfImportResource` — session-scoped per-import scratch channel the
 *     extraction action writes and the import dialog reads.
 *   - `thesesCollection` — user-scoped per-position thesis records (FIX-760).
 *
 * Accounts, holdings, AND last-known prices are NOT resources — they live in the
 * app-owned relational tables (`app.accounts` / `app.holdings` / `app.quotes`)
 * reached through the portfolio repository (FIX-772/FIX-823). The last-known-price
 * cache was a user-scoped `portfolioQuotes` resource until FIX-823 promoted it to
 * the durable, ticker-keyed `app.quotes` table (queryable cross-session +
 * joinable for the household view); the action handlers, the analysis seed, and
 * the Portfolio UI read/write it via `getRepository()` / the read API route.
 */
import { defineResource, defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { pdfExtractionSchema } from "@/domain/portfolio/parsers/portfolio-pdf";
import { thesisRecordSchema } from "@/domain/portfolio/schema/thesis-schema";
import { portfolioMandateSchema } from "@/domain/portfolio/schema/portfolio-mandate-schema";

export const pdfImportStateSchema = z.object({
  /** When the extraction ran (ISO). */
  extractedAt: z.string(),
  /** The strict extraction: transcribed rows + the statement's stated total. */
  extraction: pdfExtractionSchema,
});

export type PdfImportState = z.infer<typeof pdfImportStateSchema>;

/**
 * Session-scoped resource holding the most-recent PDF extraction so the import
 * dialog can read the transcribed rows + stated total via `useResource`.
 *
 * Why a resource and not the action's return value: in this runtime
 * `session.sendAction(...)` resolves to a request-status envelope, NOT the
 * handler's output (the same constraint `portfolioQuotesResource` documents).
 * The extraction generator runs server-side inside the `extractHoldingsFromPdf`
 * action; it writes the result here, and the dialog re-reads the snapshot
 * (`session.refresh()` → `useResource`) to render the reconciliation preview.
 *
 * The reconciliation itself is NOT stored — it is a pure function of these rows,
 * recomputed client-side in the dialog (and server-side were it ever needed).
 * Storing only the raw extraction keeps the resource the single source of truth
 * and the math reproducible.
 *
 * Session-scoped + transient: this is a per-import scratch channel, not a
 * durable record. The durable record is what `importHoldings` writes to the
 * `accounts` collection AFTER the user confirms.
 *
 * `extractedAt` carries provenance (when the transcription ran). Row fields are
 * nullable per the strict extraction shape (`portfolio-pdf.ts`): a missing field
 * stays null, never fabricated. The source file name is display-only and tracked
 * client-side by the dialog (the user picked the file) — not stored here.
 */
export const pdfImportResource = defineResource({
  scope: "session",
  ref: "pdfImport",
  stateSchema: pdfImportStateSchema.nullable(),
  default: null,
  writable: true,
  // A single resource only surfaces in the client session snapshot when it
  // declares a client PROJECTION (`hasClientProjection`: expose/exclude/data) —
  // an empty `client: {}` is NOT enough (it would never reach the client).
  // `exclude: []` (blacklist nothing) is the type-safe way to identity-expose
  // the full state of a nullable resource, so `useResource` can read it. The
  // import dialog reads this as the extraction.
  client: { exclude: [] },
});

/** The collection key for a household's thesis on one ticker — the BARE key
 *  (the canonical upper-case ticker). The collection's mutation verbs
 *  (`upsert`/`getOptional`/`delete`) auto-prepend the `theses/` pattern prefix,
 *  so the stored key / client `item.topic` is `theses/{KEY}`. Upper-cased so it
 *  matches the holdings rows, then `encodeURIComponent`'d so a ticker that
 *  contains a slash (e.g. `BRK/B`) stays a SINGLE path segment — the `theses/*`
 *  single-wildcard pattern matches one segment, so a raw slash would break the
 *  write/read. Normal tickers (`AAPL`) encode to themselves; matching/display use
 *  the record's own `ticker` field, never this key, so the encoding is internal. */
export function thesisKey(ticker: string): string {
  return encodeURIComponent(ticker.trim().toUpperCase());
}

/**
 * Per-position thesis records (FIX-760) — the durable "why" behind a holding:
 * entry rationale, invalidation conditions + structured tripwires, time horizon,
 * optional target/stop, and a link to the originating report.
 *
 * A thesis is a flat `household × ticker` document — no foreign key, no join, no
 * aggregation — so it is an FSD RESOURCE, not a relational table (unlike
 * accounts/holdings/ledger, which earned the app tables with FK cascades and
 * cross-account rollups). It is also agent-facing state: the analysis seed reads
 * it and injects `<standing-thesis>` into the trader/PM prompts — exactly what
 * resources are for. Being a resource buys the client read path (`useResource
 * CollectionList`) and live `resource_change` streaming for free, so there is no
 * bespoke read route or manual refetch.
 *
 * User-scoped + `flowIsolation: false` (keys at bare `theses/{ticker}` under the
 * user — a per-user, cross-flow resource, not flow-isolated) so it is one record
 * per name across the household and readable cross-flow: the portfolio flow's CRUD
 * actions and the analysis flow's seed + `adoptThesis` all reach the same items.
 * `live: true`
 * streams each item's projection on mutation so the UI updates with no refetch;
 * `state: { read: true }` ships the whole `ThesisRecord` (the renderer reads
 * every field).
 */
export const thesesCollection = defineResourceCollection({
  pattern: "theses/*",
  scope: "user",
  flowIsolation: false,
  stateSchema: thesisRecordSchema,
  client: { state: { read: true }, live: true },
});

/**
 * The durable household Investment Policy Statement (FIX-761) — objectives,
 * target allocation over `assetClass` buckets, standing constraints, time
 * horizon, and rebalancing bands.
 *
 * ONE document per household — a single user-scoped resource (the `portfolioQuotes`
 * cardinality), NOT a collection and NOT an app table (the FIX-760 thesis
 * reasoning: a flat household document, agent-facing, read at analysis seed).
 * `flowIsolation: false` → bare `{userId}` key, readable cross-flow (the portfolio
 * flow's CRUD action and the analysis flow's seed reach the same record).
 * `exclude: []` identity-exposes the state to the client editor; `live: true`
 * streams `resource_change` so the editor + summary chip update on save/clear
 * without a manual `session.refresh()` (a NON-live single resource is skipped for
 * change emission — verified in the engine).
 *
 * NULL-BOUNDARY (BP-030): the engine normalizes an absent/cleared single-resource
 * state to `{}` (not null) when the parsed value isn't a JSON object. So a
 * "present" mandate is detected by a REQUIRED field (`state?.createdAt != null`),
 * NEVER `state != null`; `clearPortfolioMandate` writing null reads back as absent
 * under that gate. Every reader (seed, `formatPortfolioMandate` BP-018, the UI,
 * the `mandatePresent` echo) uses the required-field gate. This is the
 * `portfolioQuotes` `q?.quotes ?? []` discipline made explicit for a resource
 * that derives a present/absent boolean.
 */
export const portfolioMandateResource = defineResource({
  scope: "user",
  flowIsolation: false,
  ref: "portfolioMandate",
  stateSchema: portfolioMandateSchema.nullable(),
  default: null,
  writable: true,
  client: { exclude: [], live: true },
});
