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
 * `holdings` collection AFTER the user confirms.
 *
 * `extractedAt` carries provenance (when the transcription ran). Row fields are
 * nullable per the strict extraction shape (`portfolio-pdf.ts`): a missing field
 * stays null, never fabricated. The source file name is display-only and tracked
 * client-side by the dialog (the user picked the file) — not stored here.
 *
 * Leaf file (BP-019): imports only core + zod + the pure pdf leaf's schema.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { pdfExtractionSchema } from "./portfolio-pdf";

export const pdfImportStateSchema = z.object({
  /** When the extraction ran (ISO). */
  extractedAt: z.string(),
  /** The strict extraction: transcribed rows + the statement's stated total. */
  extraction: pdfExtractionSchema,
});

export type PdfImportState = z.infer<typeof pdfImportStateSchema>;

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
