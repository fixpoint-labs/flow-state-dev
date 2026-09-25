/**
 * The `PACKAGE.md` text reader — a package's text in, its description and
 * instructions out, or the reason it is refused.
 *
 * Called with strings and nothing else, on purpose: the reader knows nothing
 * about where a package sits on disk, so a package stored somewhere other than
 * a file later is a new caller of this function rather than a rewrite of it.
 * Every refusal here is checked for the key or the gap it names, because an
 * author fixing a file needs to be told which line to change.
 */
import { describe, expect, it } from "vitest";
import { readPackage } from "../src/package-text";

describe("readPackage", () => {
  it("reads the description and the body from text alone", () => {
    const read = readPackage(
      "---\ndescription: How we issue refunds\n---\nRefund only against an invoice you looked up.\n"
    );
    expect(read).toEqual({
      description: "How we issue refunds",
      body: "Refund only against an invoice you looked up.\n"
    });
  });

  it("refuses text with no frontmatter", () => {
    const read = readPackage("Refund only against an invoice you looked up.\n");
    expect(read).toEqual({ refusal: expect.stringContaining("no frontmatter") });
  });

  it("refuses frontmatter with no description", () => {
    const read = readPackage("---\n---\nBody.\n");
    // An empty block reads as no frontmatter; a block with only whitespace
    // around a blank description reads as a missing one. Both are refused.
    expect("refusal" in read).toBe(true);

    const blank = readPackage("---\ndescription: \"  \"\n---\nBody.\n");
    expect(blank).toEqual({ refusal: expect.stringContaining("`description`") });
  });

  it("refuses any key besides description, naming it", () => {
    const read = readPackage("---\ndescription: Refunds\ntools: [issue-refund]\n---\nBody.\n");
    expect(read).toEqual({ refusal: expect.stringContaining("`tools:`") });
  });

  it("names every extra key, not just the first", () => {
    const read = readPackage("---\ndescription: Refunds\nname: refunds\nattach: [seat]\n---\nBody.\n");
    expect(read).toEqual({ refusal: expect.stringContaining("`name:`") });
    expect((read as { refusal: string }).refusal).toContain("`attach:`");
  });

  it("reads an instructions-free package: an empty body is not a refusal", () => {
    expect(readPackage("---\ndescription: Only a tool\n---\n")).toEqual({
      description: "Only a tool",
      body: ""
    });
  });
});
