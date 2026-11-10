/**
 * A PDF's text, extracted once on the server (spec FIX-2520 D1): the pages in
 * order, a scanned page said to be one rather than read as empty, the page
 * cap counted from the page tree before any text is read, and bytes that are
 * no PDF refused by name.
 */
import { ATTACHMENT_LIMITS } from "@flow-state-dev/core/attachments";
import { describe, expect, it } from "vitest";
import { PdfTooManyPagesError, PdfUnreadableError, extractPdfText, pageWithoutText } from "../../src/blobs/pdf-text";
import { makePdf } from "./pdf-fixture";

describe("extractPdfText", () => {
  it("reads each page's text in order, and says which page had no text layer", async () => {
    const { pages, text } = await extractPdfText(makePdf(["the brief", null, "code word TANGERINE"]));
    expect(pages).toBe(3);
    expect(text).toBe(`[page 1]\nthe brief\n\n${pageWithoutText(2)}\n\n[page 3]\ncode word TANGERINE`);
  });

  it("takes a PDF at the page cap and refuses one page over it", async () => {
    const atCap = Array.from({ length: ATTACHMENT_LIMITS.maxPdfPages }, (_, i) => `p${i + 1}`);
    await expect(extractPdfText(makePdf(atCap))).resolves.toMatchObject({ pages: ATTACHMENT_LIMITS.maxPdfPages });
    const over = [...atCap, "one more"];
    await expect(extractPdfText(makePdf(over))).rejects.toEqual(new PdfTooManyPagesError(ATTACHMENT_LIMITS.maxPdfPages + 1));
  });

  it("refuses bytes that are not a PDF", async () => {
    await expect(extractPdfText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 9]))).rejects.toBeInstanceOf(PdfUnreadableError);
  });

  it("leaves the bytes it was handed as they were", async () => {
    const bytes = makePdf(["x"]);
    const before = bytes.slice();
    await extractPdfText(bytes);
    expect(bytes).toEqual(before);
  });
});
