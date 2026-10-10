/**
 * Tests for `readEveryCollectionPage`, the one cursor loop the panels, the
 * DevTool and the Shift Manager read collections through. Its two guards are
 * why it is shared: a list that stops early must never be handed back as the
 * whole list, and a server that pages forever must not keep the reader busy.
 */
import { describe, expect, it, vi } from "vitest";
import {
  COLLECTION_READ_MAX_PAGES,
  CollectionReadStoppedError,
  readEveryCollectionPage,
  type CollectionListPage
} from "../src";

type ListOptions = { limit?: number; cursor?: string };

/** A source whose pages are `pages[i]`, keyed by the cursor that asked for them. */
function pagedSource(pages: Record<string, CollectionListPage>) {
  return {
    listCollectionItems: vi.fn(async (_session: string, _ref: string, options?: ListOptions) => {
      const page = pages[options?.cursor ?? ""];
      if (page === undefined) throw new Error(`no page for cursor ${options?.cursor}`);
      return page;
    })
  };
}

const row = (topic: string) => ({ topic, clientData: { id: topic } });

describe("readEveryCollectionPage", () => {
  it("follows the cursor to the end and returns every row, asking for the page size each time", async () => {
    const source = pagedSource({
      "": { items: [row("a"), row("b")], nextCursor: "b" },
      b: { items: [row("c")], nextCursor: "c" },
      c: { items: [row("d")] }
    });

    const rows = await readEveryCollectionPage(source, "s1", "roster", { limit: 2 });

    expect(rows.map((r) => r.topic)).toEqual(["a", "b", "c", "d"]);
    expect(source.listCollectionItems.mock.calls.map((call) => call[2])).toEqual([
      { limit: 2 },
      { limit: 2, cursor: "b" },
      { limit: 2, cursor: "c" }
    ]);
  });

  it("stops at the first repeated cursor instead of paging to the ceiling", async () => {
    // A transport that hands back the cursor it was just given. Without the
    // check, this reads 1,000 pages before failing.
    const source = {
      listCollectionItems: vi.fn(async () => ({ items: [row("x")], nextCursor: "stuck" }))
    };

    const read = readEveryCollectionPage(source, "s1", "roster");

    await expect(read).rejects.toBeInstanceOf(CollectionReadStoppedError);
    await expect(read).rejects.toMatchObject({ reason: "repeated-cursor", pagesRead: 2, rowsRead: 2 });
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);
  });

  it("treats a cursor seen earlier in the read as repeated, not only the one before", async () => {
    const source = pagedSource({
      "": { items: [row("a")], nextCursor: "p1" },
      p1: { items: [row("b")], nextCursor: "p2" },
      p2: { items: [row("c")], nextCursor: "p1" }
    });

    await expect(readEveryCollectionPage(source, "s1", "roster")).rejects.toMatchObject({
      reason: "repeated-cursor",
      message: expect.stringMatching(/same page cursor twice/)
    });
    expect(source.listCollectionItems).toHaveBeenCalledTimes(3);
  });

  it("fails after the page ceiling when every cursor is new, rather than returning part of the list", async () => {
    let n = 0;
    const source = {
      listCollectionItems: vi.fn(async () => {
        n += 1;
        return { items: [row(`t${n}`)], nextCursor: `c${n}` };
      })
    };

    await expect(readEveryCollectionPage(source, "s1", "roster")).rejects.toMatchObject({
      reason: "page-limit",
      pagesRead: COLLECTION_READ_MAX_PAGES,
      rowsRead: COLLECTION_READ_MAX_PAGES,
      message: expect.stringMatching(/after 1000 pages with more still to read/)
    });
    expect(source.listCollectionItems).toHaveBeenCalledTimes(COLLECTION_READ_MAX_PAGES);
  });

  it("returns a collection that ends exactly on the last page the ceiling allows", async () => {
    let n = 0;
    const source = {
      listCollectionItems: vi.fn(async () => {
        n += 1;
        return n === COLLECTION_READ_MAX_PAGES
          ? { items: [row(`t${n}`)] }
          : { items: [row(`t${n}`)], nextCursor: `c${n}` };
      })
    };

    const rows = await readEveryCollectionPage(source, "s1", "roster");

    expect(rows).toHaveLength(COLLECTION_READ_MAX_PAGES);
  });

  it("stops reading once the caller no longer wants the result", async () => {
    let current = true;
    const source = pagedSource({
      "": { items: [row("a")], nextCursor: "p1" },
      p1: { items: [row("b")], nextCursor: "p2" },
      p2: { items: [row("c")] }
    });
    source.listCollectionItems.mockImplementationOnce(async () => {
      current = false;
      return { items: [row("a")], nextCursor: "p1" };
    });

    await readEveryCollectionPage(source, "s1", "roster", { keepReading: () => current });

    expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
  });

  it("rejects with the page's own error when a page fails", async () => {
    const refused = new Error("403 forbidden");
    const source = {
      listCollectionItems: vi
        .fn()
        .mockResolvedValueOnce({ items: [row("a")], nextCursor: "p1" })
        .mockRejectedValueOnce(refused)
    };

    await expect(readEveryCollectionPage(source, "s1", "roster")).rejects.toBe(refused);
  });
});
