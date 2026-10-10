/**
 * Read every page of one collection: the cursor loop the React panels, the
 * DevTool and the Shift Manager share, with its page ceiling and its
 * repeated-cursor check held here, once.
 */
import type { CollectionListPage } from "../types";
import type { ResourceClient } from "./resources";

/**
 * The most pages one collection read follows.
 *
 * A guard against a transport that hands back a `nextCursor` forever, not a
 * size anyone is expected to reach: at the route's largest page (200 rows) it
 * covers 200,000 rows, when the collection honours the requested page size.
 */
export const COLLECTION_READ_MAX_PAGES = 1000;

/** Why a read stopped with pages still to read. */
export type CollectionReadStopReason = "page-limit" | "repeated-cursor";

/**
 * Thrown when a read stops before the collection ran out of pages: the
 * ceiling was reached with a `nextCursor` still outstanding, or the server
 * handed back a cursor it had already sent. Either way the rows read so far
 * are not the whole collection, so none are returned.
 */
export class CollectionReadStoppedError extends Error {
  /** Which guard stopped the read. */
  readonly reason: CollectionReadStopReason;
  /** Pages fully read before the stop. */
  readonly pagesRead: number;
  /** Rows those pages held. */
  readonly rowsRead: number;

  constructor(reason: CollectionReadStopReason, pagesRead: number, rowsRead: number) {
    super(
      `${
        reason === "page-limit"
          ? `Stopped after ${COLLECTION_READ_MAX_PAGES} pages with more still to read`
          : "Stopped because the server returned the same page cursor twice"
      }, rather than show part of the list as all of it.`
    );
    this.name = "CollectionReadStoppedError";
    this.reason = reason;
    this.pagesRead = pagesRead;
    this.rowsRead = rowsRead;
  }
}

/** Options for {@link readEveryCollectionPage}. */
export type ReadEveryCollectionPageOptions = {
  /** Page size requested each time. Not a cap on rows: the read follows the cursor to the end. */
  readonly limit?: number;
  /**
   * Checked after each page. Returning `false` ends the read early with the
   * rows read so far, for a caller whose result is already stale and will be
   * discarded.
   */
  readonly keepReading?: () => boolean;
};

/**
 * Every row of one collection, following `nextCursor` until the server stops
 * returning one.
 *
 * Throws {@link CollectionReadStoppedError} when the server keeps returning
 * cursors past {@link COLLECTION_READ_MAX_PAGES} pages, or returns a cursor it
 * already sent. A page that fails rejects with that page's own error.
 */
export async function readEveryCollectionPage(
  source: Pick<ResourceClient, "listCollectionItems">,
  sessionId: string,
  ref: string,
  options: ReadEveryCollectionPageOptions = {}
): Promise<CollectionListPage["items"]> {
  const { limit, keepReading } = options;
  const rows: CollectionListPage["items"] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pagesRead = 0; pagesRead < COLLECTION_READ_MAX_PAGES; ) {
    const page = await source.listCollectionItems(sessionId, ref, {
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor })
    });
    pagesRead += 1;
    rows.push(...page.items);
    if (keepReading !== undefined && !keepReading()) return rows;
    if (page.nextCursor === undefined) return rows;
    if (seen.has(page.nextCursor)) throw new CollectionReadStoppedError("repeated-cursor", pagesRead, rows.length);
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new CollectionReadStoppedError("page-limit", COLLECTION_READ_MAX_PAGES, rows.length);
}
