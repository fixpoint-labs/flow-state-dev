/**
 * Unit test for the server-side PDF text linearization (`extractPdfText`).
 *
 * Offline + deterministic: `unpdf` is MOCKED so `getDocumentProxy` returns a
 * fake document whose pages yield KNOWN text items. This exercises OUR joining
 * logic — space-join within a line, newline on `hasEOL`, blank line between
 * pages, marked-content items skipped — without parsing a real PDF. The real
 * unpdf (worker-free pdfjs) parse is verified by the end-to-end flow spec and
 * manually via the dev server.
 */
import { describe, expect, it, vi } from "vitest";

/** One fake page's text items. `hasEOL` ends a line; an item without `str` is a
 *  marked-content item the extractor must skip. */
type FakeItem = { str: string; hasEOL: boolean } | { type: "marked" };

/** Pages, each a list of items. The mock builds a fake doc from this. */
let fakePages: FakeItem[][] = [];

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    numPages: fakePages.length,
    getPage: async (n: number) => ({
      getTextContent: async () => ({ items: fakePages[n - 1] }),
    }),
    destroy: async () => {},
  })),
}));

// Imported AFTER the mock is registered (vitest hoists vi.mock above this).
import { getDocumentProxy } from "unpdf";
import { extractPdfText } from "../src/flows/trading-desk-portfolio/extract-pdf-text.server";

describe("extractPdfText linearization", () => {
  it("space-joins fragments on a line and breaks the line on hasEOL", async () => {
    fakePages = [
      [
        { str: "AAPL", hasEOL: false },
        { str: "5.44", hasEOL: false },
        { str: "$298.97", hasEOL: true },
        { str: "MSFT", hasEOL: false },
        { str: "2", hasEOL: true },
      ],
    ];
    const text = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(text).toBe("AAPL 5.44 $298.97\nMSFT 2");
  });

  it("separates pages with a blank line", async () => {
    fakePages = [
      [{ str: "page one", hasEOL: true }],
      [{ str: "page two", hasEOL: true }],
    ];
    const text = await extractPdfText(new Uint8Array([1]));
    expect(text).toBe("page one\n\npage two");
  });

  it("flushes a trailing line with no hasEOL", async () => {
    fakePages = [
      [
        { str: "Total", hasEOL: false },
        { str: "$3,926.84", hasEOL: false },
      ],
    ];
    const text = await extractPdfText(new Uint8Array([1]));
    expect(text).toBe("Total $3,926.84");
  });

  it("skips marked-content items that carry no str", async () => {
    fakePages = [
      [
        { str: "real", hasEOL: false },
        { type: "marked" },
        { str: "text", hasEOL: true },
      ],
    ];
    const text = await extractPdfText(new Uint8Array([1]));
    expect(text).toBe("real text");
  });

  it("hands pdfjs a true Uint8Array, never a Buffer (pdfjs v4 rejects Buffers)", async () => {
    // A Buffer is the real input shape (the action decodes base64 with
    // Buffer.from). pdfjs throws on a Buffer even though it extends Uint8Array,
    // so the extractor must copy into a plain Uint8Array before unpdf.
    fakePages = [[{ str: "ok", hasEOL: true }]];
    const mockGetDocumentProxy = vi.mocked(getDocumentProxy);
    mockGetDocumentProxy.mockClear();

    const text = await extractPdfText(Buffer.from([9, 9, 9]));
    expect(text).toBe("ok");

    const passed = mockGetDocumentProxy.mock.calls[0][0];
    expect(Buffer.isBuffer(passed)).toBe(false);
    expect(passed).toBeInstanceOf(Uint8Array);
  });
});
