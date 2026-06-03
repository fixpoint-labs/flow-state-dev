/**
 * Client-side PDF -> text extraction for the holdings import dialog.
 *
 * WHY CLIENT-SIDE (a deliberate call): we mirror the CSV dialog's ergonomics,
 * where the file is read in the browser (`file.text()`) and previewed before any
 * server round-trip. A brokerage statement is sensitive financial data; reading
 * the bytes locally and sending only the extracted TEXT to the server (for the
 * LLM transcription) avoids shipping the raw binary, and pdfjs runs natively in
 * the browser. The target statements are text-based (not scanned), so a text
 * extractor is sufficient — no OCR.
 *
 * This module is browser-only: it imports `pdfjs-dist` and configures its web
 * worker, so it must never be imported from server/flow code. It lives under
 * `components/` (the client tree) alongside the dialog for that reason, and is
 * excluded from the offline test suite (the suite runs in `node` and never loads
 * a real PDF — see `docs/internal/trading-desk-v2/08-pdf-import.md`).
 */
import * as pdfjs from "pdfjs-dist";

// Point pdfjs at its worker via a STATIC /public URL, served by Next at a fixed
// path with no bundler indirection. The previous `new URL("pdfjs-dist/...",
// import.meta.url)` form was resolved unreliably by turbopack (Next 16's dev
// bundler) — the worker intermittently failed to load and `getDocument()` hung
// forever (the dialog stuck on "extracting", no server request). The worker is
// copied into /public from the installed pdfjs-dist by `scripts/copy-pdf-worker.mjs`
// (run from `dev`/`build`), so its version always matches this imported API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfjs.GlobalWorkerOptions as any).workerSrc = "/pdf.worker.min.mjs";

/** Reject if `promise` doesn't settle within `ms`. A pdfjs worker that fails to
 *  load never settles `getDocument().promise`; this converts that silent hang
 *  into a surfaced error the dialog can show, instead of an infinite spinner. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Extract the text of every page of a PDF, in reading order, as a single
 * string. Page text is joined with blank lines so the LLM sees page boundaries.
 *
 * Within a page, pdfjs returns positioned text fragments; we join them with
 * spaces and insert a newline when a fragment ends a line (`hasEOL`). This keeps
 * tabular rows roughly on their own lines without us reconstructing the exact
 * column geometry — the extraction generator maps columns by meaning, so a
 * best-effort linearization is enough.
 *
 * Throws if the file is not a parseable PDF (encrypted, corrupt, or an image
 * scan with no text layer). The dialog catches and surfaces the failure rather
 * than importing nothing silently.
 */
export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  // 20s is generous for parsing a text PDF locally; if it elapses the worker
  // didn't load (a turbopack/asset regression) rather than the parse being slow.
  const doc = await withTimeout(
    loadingTask.promise,
    20_000,
    "The PDF reader didn't start — please try again, or use CSV import.",
  );
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

  // Release the worker + buffers (destroy lives on the loading task).
  await loadingTask.destroy();
  return pages.join("\n\n");
}
