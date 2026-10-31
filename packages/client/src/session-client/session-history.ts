/**
 * Reading a session's whole history in pages, and the one rule for which of
 * two copies of an item to keep. Shared by {@link sessionFeed} and
 * `useSession`, which join the same three sources: snapshots, a send's own
 * stream and the session stream.
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
  readonly itemTypes?: string[];
  /** Items per page. Default {@link SESSION_HISTORY_PAGE_LIMIT}. */
  readonly pageLimit?: number;
  /** Starts over at most this many times. Default {@link SESSION_HISTORY_READ_ATTEMPTS}. */
  readonly attempts?: number;
};

/**
 * Every item of a session, as one snapshot: the first page's `at`,
 * `sessionCreatedAt`, state and resources, with every page's items.
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

  const readPages = async (): Promise<SessionStateSnapshotResponse | null> => {
    let offset = 0;
    let first: SessionStateSnapshotResponse | null = null;
    const items: OutputItem[] = [];

    while (true) {
      const page = await sessions.state(sessionId, {
        includeItems: true,
        itemTypes: options.itemTypes,
        offset,
        limit
      });
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

      if (page.pagination?.hasMore !== true) break;
      offset = page.pagination.nextOffset - 1;
    }

    return {
      ...first,
      items,
      pagination: { offset: 0, limit: items.length, total: items.length, hasMore: false, nextOffset: items.length }
    };
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const whole = await readPages();
    if (whole !== null) return whole;
  }
  throw new Error(`Session ${sessionId} changed during each of ${attempts} reads of its history; try again.`);
}

/** Whether a copy of an item is finished: anything but `in_progress`. */
function isFinished(item: OutputItem): boolean {
  return item.status !== "in_progress";
}

/**
 * Whether `next` may replace `held`, two copies of one item (the same
 * `requestId` and `id`). Never an unfinished copy over a finished one, and
 * never a finished copy over one the server stamped later. A keyed item is
 * sent again, finished, each time it is emitted, with a later time and index
 * (`compareItemOrder`), and its copies can arrive in any order.
 */
export function mayReplaceItem(held: OutputItem | undefined, next: OutputItem): boolean {
  if (held === undefined || !isFinished(held)) return true;
  return isFinished(next) && compareItemOrder(next, held) >= 0;
}
