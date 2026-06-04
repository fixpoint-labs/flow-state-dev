/**
 * `extractHoldingsFromPdf` — the action behind PDF holdings import.
 *
 * Shape (BP-011-safe): a SEQUENCER, not a handler calling a block.
 *
 *   .step(decodeStatement)          // base64 PDF bytes -> statement text (server-side unpdf)
 *   .step(extractHoldingsGenerator) // the LLM transcription (the only model step)
 *   .tap(commitExtraction)          // write rows + statedTotal to the pdfImport resource
 *
 * The dialog uploads the PDF as base64; the first step decodes it and extracts
 * the text on the SERVER (`extractPdfText`, a plain async fn — BP-011 permits a
 * handler calling a function, not a block). The generator then emits the strict
 * `PdfExtraction`; the commit tap writes it to the session-scoped `pdfImport`
 * resource so the client can read it via `useResource` after `session.refresh()`
 * (sendAction returns only a status envelope in this runtime — the same channel
 * `getQuotes` uses). NOTHING is imported here.
 *
 * Why server-side extraction: the browser pdfjs path needed a web worker whose
 * URL turbopack resolved unreliably (the import hung). The server extracts with
 * `unpdf` (a worker-free pdfjs build — see `extract-pdf-text.server.ts`), so
 * there is no worker to mis-resolve. The bytes already become text that goes to
 * the server + the LLM, so uploading the bytes is no new privacy exposure.
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
import { extractPdfText } from "./extract-pdf-text.server";
import { pdfExtractionSchema } from "./portfolio-pdf";
import { pdfImportResource } from "./portfolio-pdf-resource";

/** Action input: the base64-encoded PDF bytes the dialog uploaded. */
export const extractHoldingsActionInputSchema = z.object({
  pdfBase64: z.string(),
});

/**
 * Decode the uploaded base64 PDF and extract its text on the server.
 *
 * A real transformation (input bytes -> statement text), so it returns the text
 * rather than echoing input (BP-014). It calls the plain `extractPdfText`
 * function, not a block (BP-011-safe). Empty/garbage text — a scanned-image PDF
 * with no text layer, or bytes that aren't a PDF — surfaces as a clear error the
 * dialog shows, instead of feeding the LLM an empty statement.
 */
const decodeStatement = handler({
  name: "decode-pdf-statement",
  inputSchema: extractHoldingsActionInputSchema,
  outputSchema: z.object({ statementText: z.string() }),
  execute: async (input) => {
    const bytes = Buffer.from(input.pdfBase64, "base64");
    if (bytes.length === 0) {
      throw new Error("The uploaded PDF was empty.");
    }
    const statementText = await extractPdfText(bytes);
    if (statementText.trim().length === 0) {
      throw new Error(
        "No text found in this PDF (it may be a scanned image, which is not supported).",
      );
    }
    return { statementText };
  },
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
  .step(decodeStatement)
  .step(extractHoldingsGenerator)
  .tap(commitExtraction);
