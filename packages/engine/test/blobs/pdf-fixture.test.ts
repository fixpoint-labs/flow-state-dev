/**
 * A padded PDF is exactly the size asked for, and a parser can still open it.
 * The pad is random, so two builds of one size are not the same file.
 */
import { describe, expect, it } from "vitest";
import { extractPdfText } from "../../src/blobs/pdf-text";
import { makePdf } from "./pdf-fixture";

describe("makePdf pad", () => {
  it("pads to an exact size a parser can open, and two builds differ", async () => {
    const first = makePdf(["goal"], { padTo: 4096 });
    const second = makePdf(["goal"], { padTo: 4096 });
    expect(first.byteLength).toBe(4096);
    expect(second.byteLength).toBe(4096);
    expect(first).not.toEqual(second);
    await expect(extractPdfText(first)).resolves.toMatchObject({ pages: 1, text: "[page 1]\ngoal" });
  });

  it("pads across a change in how many digits the size takes", async () => {
    for (const size of [10_000, 100_000, 20 * 1024 * 1024]) {
      const bytes = makePdf(["goal"], { padTo: size });
      expect(bytes.byteLength).toBe(size);
      await expect(extractPdfText(bytes)).resolves.toMatchObject({ pages: 1, text: "[page 1]\ngoal" });
    }
  });

  it("refuses a size smaller than the PDF", () => {
    expect(() => makePdf(["goal"], { padTo: 32 })).toThrow(/padTo/);
  });
});
