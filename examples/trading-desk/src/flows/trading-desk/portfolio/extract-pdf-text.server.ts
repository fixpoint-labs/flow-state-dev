/**
 * Server-side PDF -> text extraction for the holdings import path.
 *
 * WHY SERVER-SIDE: pdfjs needs a worker to parse a PDF. In the browser that is a
 * web worker whose URL turbopack (Next 16's dev bundler) resolved unreliably —
 * the worker intermittently failed to load and `getDocument()` hung forever
 * (the import dialog stuck on "extracting", no progress). In Node there is no
 * worker problem: pdfjs's legacy build runs on the main thread with the worker
 * disabled, deterministically. So the dialog now uploads the PDF bytes and the
 * server extracts the text here.
 *
 * Shipping the bytes to the server is NOT a new privacy exposure: the extracted
 * holdings already go to the server and on to the LLM transcription, so the
 * statement's content already leaves the browser. The raw bytes simply travel
 * the same path the text already did.
 *
 * This module is NODE-ONLY: it imports `pdfjs-dist/legacy/build/pdf.mjs` (the
 * Node-compatible build) and is named `.server.ts` to signal it must never be
 * imported from client code. It lives in the server flow tree (not under
 * `components/`) for that reason. The target statements are text-based (not
 * scanned), so a text extractor is sufficient — no OCR.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extract the text of every page of a PDF, in reading order, as a single
 * string. Page text is joined with blank lines so the LLM sees page boundaries.
 *
 * Within a page, pdfjs returns positioned text fragments; we join them with
 * spaces and insert a newline when a fragment ends a line (`hasEOL`). This keeps
 * tabular rows roughly on their own lines without us reconstructing the exact
 * column geometry — the extraction generator maps columns by meaning, so a
 * best-effort linearization is enough. This mirrors the linearization the old
 * client extractor did, byte for byte.
 *
 * Runs WITHOUT a browser worker: `disableWorker: true` keeps pdfjs on the Node
 * main thread (the worker-URL indirection that hung in the browser does not
 * exist here). `isEvalSupported: false` avoids eval in the Node runtime.
 *
 * Throws if the file is not a parseable PDF (encrypted, corrupt, or an image
 * scan with no text layer). The caller (the decode handler) surfaces the
 * failure rather than importing nothing silently.
 */
export async function extractPdfText(bytes: Uint8Array | Buffer): Promise<string> {
  // pdfjs takes ownership of the buffer it parses; hand it a plain Uint8Array
  // view so a Buffer's pooled backing store isn't transferred out from under us.
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // `disableWorker` is a runtime-accepted getDocument param that keeps pdfjs on
  // the Node main thread, but pdfjs 4.x omits it from `DocumentInitParameters`.
  // The cast adds only that one known-valid field; the rest stays typed.
  const params = {
    data,
    disableWorker: true,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0] & { disableWorker: boolean };
  const loadingTask = pdfjs.getDocument(params);
  const doc = await loadingTask.promise;
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

  // Release the parser + buffers (destroy lives on the loading task).
  await loadingTask.destroy();
  return pages.join("\n\n");
}
