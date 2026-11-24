// FIX-2520 D1.
/**
 * A PDF's text, extracted on the server, for a target that can't read PDFs
 * (Codex, Cursor, a generator whose provider doesn't take them).
 *
 * The upload route runs it once per PDF: the same pass counts the pages, so
 * the page cap holds before anything is stored, and the text is kept in the
 * blob store beside the PDF, under {@link pdfTextBlobId}. A claim takes it
 * with the PDF into the same owner, so it is read only where the PDF is and
 * deleted with it. The text lists the pages in order, and a page with no text
 * layer (a scanned page) says so, so a reply never reads an empty page as an
 * empty answer.
 *
 * The extractor is loaded on the first PDF only: a server that never takes
 * one never loads it.
 */
import { ATTACHMENT_LIMITS } from "@flow-state-dev/core/attachments";

/** A PDF's text and its page count. */
export type PdfText = { pages: number; text: string };

/** Thrown when the bytes are not a PDF the extractor can open: damaged, or locked with a password. */
export class PdfUnreadableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The PDF can't be opened: it is damaged, or locked with a password.", options);
    this.name = "PdfUnreadableError";
  }
}

/** Thrown when a PDF has more pages than `ATTACHMENT_LIMITS.maxPdfPages`. */
export class PdfTooManyPagesError extends Error {
  constructor(readonly pages: number) {
    super(`The PDF has ${pages} pages; a PDF can have at most ${ATTACHMENT_LIMITS.maxPdfPages}.`);
    this.name = "PdfTooManyPagesError";
  }
}

/** The line that stands for a page with no text layer. */
export function pageWithoutText(page: number): string {
  return `[page ${page}: no text layer. A scanned page has no text to read here.]`;
}

/**
 * Count `bytes`' pages from its page tree, refuse it over the page cap, and
 * extract its text page by page.
 *
 * @throws {PdfUnreadableError} When the bytes can't be opened as a PDF.
 * @throws {PdfTooManyPagesError} Over `ATTACHMENT_LIMITS.maxPdfPages`, before any text is read.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const { getDocumentProxy } = await import("unpdf");
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // A copy: the extractor takes ownership of the buffer it is handed.
    document = await getDocumentProxy(bytes.slice());
  } catch (error) {
    throw new PdfUnreadableError({ cause: error });
  }
  try {
    const pages = document.numPages;
    if (pages > ATTACHMENT_LIMITS.maxPdfPages) throw new PdfTooManyPagesError(pages);
    const sections: string[] = [];
    for (let number = 1; number <= pages; number += 1) {
      let text: string;
      try {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        text = content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
          .join("")
          .trim();
      } catch (error) {
        throw new PdfUnreadableError({ cause: error });
      }
      sections.push(text === "" ? pageWithoutText(number) : `[page ${number}]\n${text}`);
    }
    return { pages, text: sections.join("\n\n") };
  } finally {
    // Frees the document's worker-side state; a failure here changes nothing for the caller.
    await document.loadingTask.destroy().catch(() => undefined);
  }
}

/**
 * The id a PDF's extracted text is stored under: the PDF's own id with a
 * suffix. The server makes every id, and its own are 32 hex characters
 * after `b_`, so no upload can take this one.
 */
export function pdfTextBlobId(pdfId: string): string {
  return `${pdfId}text`;
}

/** Whether `id` is a PDF's stored text: the server's, claimed only with its PDF, never named as an attachment. */
export function isPdfTextBlobId(id: string): boolean {
  return id.endsWith("text");
}
