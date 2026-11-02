/**
 * Reading a session's history in pages: the one paging loop in the client.
 * `readSessionTail` and the other session-window reads start it part way in;
 * FIX-2374's `sessionFeed` and `useSession` start it at the beginning.
 */
import { compareItemOrder } from "@flow-state-dev/contracts/items";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { SessionsApi } from "../client";
import type { SessionStateSnapshotResponse } from "../types";

/** Items per page when {@link readSessionHistory} is given none. */
export const SESSION_HISTORY_PAGE_LIMIT = 100;

/**
 * How many times a paged read starts over because the session's history moved
 * under it, before it fails rather than show part of the history as all of it.
 */
export const SESSION_HISTORY_READ_ATTEMPTS = 5;

export type ReadSessionHistoryOptions = {
  readonly itemTypes?: readonly string[];
  /** Items per page. Default {@link SESSION_HISTORY_PAGE_LIMIT}. */
  readonly pageLimit?: number;
  /** Starts over at most this many times. Default {@link SESSION_HISTORY_READ_ATTEMPTS}. */
  readonly attempts?: number;
  /** Where in the session's item list to start. Default 0, the whole history. */
  readonly offset?: number;
};

/**
 * A session's items from `offset` to its end, as one snapshot: the first
 * page's `at`, `sessionCreatedAt`, state and resources, with every page's
 * items. `pagination.offset` is where the items start and `pagination.total`
 * where they end.
 *
 * Pages are cut by offset from the history as it stands at each request. A
 * request removed from a page already read, or a keyed item emitted again,
 * shifts the later pages, and an item that never changed would be skipped by a
 * read that still passes for whole: the stream follows it from the first
 * page's `at`, and never sends an item kept before that. So each later page
 * starts one item early, on the last item the read holds. If that is not the
 * item there, the history moved, and the read starts over. So does a page read
 * from another session that took the id since the first page. Each page stays
 * one bounded request, and any server that pages by offset answers it.
 *
 * Throws when the history moved during every attempt.
 */
export async function readSessionHistory(
  sessions: Pick<SessionsApi, "state">,
  sessionId: string,
  options: ReadSessionHistoryOptions = {}
): Promise<SessionStateSnapshotResponse> {
  const limit = options.pageLimit ?? SESSION_HISTORY_PAGE_LIMIT;
  const attempts = options.attempts ?? SESSION_HISTORY_READ_ATTEMPTS;
  const start = options.offset ?? 0;
  const itemTypes = options.itemTypes === undefined ? undefined : [...options.itemTypes];

  const readPages = async (): Promise<SessionStateSnapshotResponse | null> => {
    let offset = start;
    let first: SessionStateSnapshotResponse | null = null;
    const items: OutputItem[] = [];

    while (true) {
      const page = await sessions.state(sessionId, { includeItems: true, itemTypes, offset, limit });
      let pageItems = page.items ?? [];

      if (first === null) {
        first = page;
      } else {
        if (page.sessionCreatedAt !== first.sessionCreatedAt) return null;
        const last = items[items.length - 1];
        const overlap = pageItems[0];
        if (last === undefined || overlap === undefined || compareItemOrder(overlap, last) !== 0) {
          return null;
        }
        pageItems = pageItems.slice(1);
      }
      items.push(...pageItems);

      // A next page that would not move past this one ends the read.
      if (page.pagination?.hasMore !== true || page.pagination.nextOffset - 1 <= offset) break;
      offset = page.pagination.nextOffset - 1;
    }

    const end = start + items.length;
    return {
      ...first,
      items,
      pagination: { offset: start, limit: items.length, total: end, hasMore: false, nextOffset: end }
    };
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const whole = await readPages();
    if (whole !== null) return whole;
  }
  throw new Error(`Session ${sessionId} changed during each of ${attempts} reads of its history; try again.`);
}
