/**
 * `extractHoldingsFromPdf` — the action behind PDF holdings import.
 *
 * Shape (BP-011-safe): a SEQUENCER, not a handler calling a block.
 *
 *   .step(extractHoldingsGenerator) // the LLM transcription (the only model step)
 *   .tap(commitExtraction)          // write rows + statedTotal to the pdfImport resource
 *
 * The generator emits the strict `PdfExtraction`; the commit tap writes it to
 * the session-scoped `pdfImport` resource so the client can read it via
 * `useResource` after `session.refresh()` (sendAction returns only a status
 * envelope in this runtime — the same channel `getQuotes` uses). NOTHING is
 * imported here.
 *
 * The deterministic reconciliation and the canonical mapping do NOT run in this
 * action — they run client-side in the dialog (pure functions of the resource
 * state) so the user reviews them before confirming. Import happens only when
 * the user confirms and the dialog dispatches the EXISTING `importHoldings`.
 *
 * Provenance: the source file name is display-only and known to the client (the
 * user picked the file), so the dialog tracks it in React state — it is NOT
 * threaded through the server or stored on session state, keeping the analysis
 * `sessionStateSchema` unpolluted by a transient import detail.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { extractHoldingsGenerator } from "./extract-holdings-generator";
import { pdfExtractionSchema } from "./portfolio-pdf";
import { pdfImportResource } from "./portfolio-pdf-resource";

/** Action input: the client-extracted statement text. The action's input
 *  schema IS the generator's input schema — no reshaping needed. */
export const extractHoldingsActionInputSchema = z.object({
  statementText: z.string(),
});

/**
 * Commit the generator's extraction to the session-scoped `pdfImport` resource.
 * `.tap` (BP-012): it only mutates a resource ref; it returns nothing and never
 * echoes input (BP-014).
 */
const commitExtraction = handler({
  name: "commit-pdf-extraction",
  inputSchema: pdfExtractionSchema,
  outputSchema: z.void(),
  resources: { pdfImport: pdfImportResource },
  execute: async (extraction, ctx) => {
    await ctx.resources.pdfImport.patchState({
      extractedAt: new Date().toISOString(),
      extraction,
    });
  },
});

export const extractHoldingsFromPdf = sequencer({
  name: "extract-holdings-from-pdf",
  inputSchema: extractHoldingsActionInputSchema,
})
  .step(extractHoldingsGenerator)
  .tap(commitExtraction);
