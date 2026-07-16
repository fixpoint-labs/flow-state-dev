/**
 * Server-side PDF -> text extraction for the holdings import path.
 *
 * WHY `unpdf` (not `pdfjs-dist` directly): pdfjs needs a worker to parse a PDF,
 * and that worker fought the bundler from both ends. In the browser its web
 * worker URL resolved unreliably under turbopack (the import hung). On the Node
 * server, pdfjs's "fake worker" dynamically imports `pdf.worker.mjs`, which
 * turbopack rewrote to a `.next/.../chunks` path it never emitted ("Setting up
 * fake worker failed: Cannot find module"). `unpdf` ships a worker-free,
 * serverless-ready pdfjs build, so it parses on the Node main thread and bundles
 * cleanly under Next — no worker, no `/public` asset, no `serverExternalPackages`
 * config, no `pdfjs-dist` dependency.
 *
 * Shipping the bytes to the server is NOT a new privacy exposure: the extracted
 * holdings already go to the server and on to the LLM transcription, so the
 * statement's content already leaves the browser. The raw bytes simply travel
 * the same path the text already did.
 *
 * This module is NODE-ONLY: it is named `.server.ts` to signal it must never be
 * imported from client code, and lives in the server flow tree (not under
 * `components/`). The target statements are text-based (not scanned), so a text
 * extractor is sufficient — no OCR.
 */
import { getDocumentProxy } from "unpdf";

/**
 * Extract the text of every page of a PDF, in reading order, as a single
 * string. Page text is joined with blank lines so the LLM sees page boundaries.
 *
 * Within a page, pdfjs returns positioned text fragments; we join them with
 * spaces and insert a newline when a fragment ends a line (`hasEOL`). This keeps
 * tabular rows roughly on their own lines without us reconstructing the exact
 * column geometry — the extraction generator maps columns by meaning, so a
 * best-effort linearization is enough. `unpdf` exposes the same pdfjs
 * `PDFDocumentProxy` (`numPages` / `getPage` / `getTextContent`), so this loop is
 * unchanged from the prior pdfjs implementation; only the worker-free document
 * loading differs.
 *
 * Throws if the file is not a parseable PDF (encrypted, corrupt, or an image
 * scan with no text layer). The caller (the decode handler) surfaces the failure
 * rather than importing nothing silently.
 */
export async function extractPdfText(bytes: Uint8Array | Buffer): Promise<string> {
  // pdfjs rejects a Node `Buffer` ("provide binary data as Uint8Array, rather
  // than Buffer"), and because `Buffer` EXTENDS `Uint8Array` an `instanceof`
  // check wrongly passes one through. Always copy into a standalone Uint8Array:
  // a true Uint8Array (not the Buffer subclass), detached from any pooled
  // Buffer backing store.
  const data = new Uint8Array(bytes);
  const doc = await getDocumentProxy(data);
  try {
    const pages: string[] = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        // `str`/`hasEOL` live on TextItem; marked-content items have neither.
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trimEnd());
          line = "";
        } else {
          line += " ";
        }
      }
      if (line.trim().length > 0) lines.push(line.trimEnd());
      pages.push(lines.join("\n"));
    }

    return pages.join("\n\n");
  } finally {
    // Release the parser + buffers whether parsing succeeded or threw (a parse
    // failure mid-document would otherwise leak the loading task's buffers).
    await doc.destroy();
  }
}
