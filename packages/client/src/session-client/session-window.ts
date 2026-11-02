/**
 * Read a long session from its newest end: the last page of its items first,
 * earlier pages when someone asks for them.
 *
 * A session's stored items come back oldest first, so a read that starts at
 * offset 0 and stops after a few pages shows a conversation's beginning and
 * drops its newest replies, the ones a person opened it to see. A window
 * starts at the end instead, and grows backward on demand.
 *
 * Every read here is one shape: from a start position to the session's end,
 * through {@link readSessionHistory}, the client's one paging loop.
 * A reply is stored while it is still being written and finishes in place,
 * and items are ordered by when they were stamped, so one can be stored
 * behind items already there. A read of only the items past the old end
 * misses both; a read from the window's start cannot.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { SessionsApi } from "../client";
import type { SessionStateSnapshotResponse } from "../types";
import { readSessionHistory } from "./session-history";

/** Items a window reads from the newest end, and adds per {@link readSessionEarlier}. */
export const SESSION_WINDOW_PAGE = 200;

/** What a window reads through: `client.sessions`, or anything with its `state`. */
export type SessionItemsSource = Pick<SessionsApi, "state">;

/**
 * A run of one session's items, from `start` to the session's end as it
 * stood when read. Hand it back to {@link readSessionEarlier} or
 * {@link refreshSessionWindow}; it carries what they need to read on.
 */
export type SessionItemsWindow = {
  readonly sessionId: string;
  /** The item types the window was read with. Positions count only these. */
  readonly itemTypes?: readonly string[];
  /** Oldest first: the session's items from `start` to `total`. */
  readonly items: readonly OutputItem[];
  /** Where `items[0]` sat in the session's whole item list. */
  readonly start: number;
  /** How many items the session held when read. */
  readonly total: number;
  /** Whether the session holds items before this window: show *Load earlier*. */
  readonly hasEarlier: boolean;
  /**
   * The server time the last read began, to follow the session from with
   * the session stream's `since`. An older server omits it.
   */
  readonly at?: number;
  /**
   * When the session read was created, for the session stream's
   * `sessionCreatedAt`. A later read that finds another session under the id
   * starts the window over. An older server omits it.
   */
  readonly sessionCreatedAt?: number;
};

/** Options for {@link readSessionTail}. */
export type ReadSessionTailOptions = {
  /** How many of the newest items to read. Default {@link SESSION_WINDOW_PAGE}. */
  readonly limit?: number;
  /** Only these item types, as `sessions.state`'s `itemTypes`. */
  readonly itemTypes?: readonly string[];
};

/** Options for {@link readSessionEarlier}. */
export type ReadSessionEarlierOptions = {
  /** How many earlier items to add. Default {@link SESSION_WINDOW_PAGE}. */
  readonly limit?: number;
};

/**
 * The session's newest `limit` items. A session that holds no more than that
 * is read in one call; a longer one takes a second, from its end.
 */
export async function readSessionTail(
  source: SessionItemsSource,
  sessionId: string,
  options: ReadSessionTailOptions = {}
): Promise<SessionItemsWindow> {
  const limit = options.limit ?? SESSION_WINDOW_PAGE;
  const { itemTypes } = options;
  const first = await source.state(sessionId, {
    includeItems: true,
    offset: 0,
    limit,
    ...(itemTypes === undefined ? {} : { itemTypes: [...itemTypes] })
  });
  if (first.pagination?.hasMore !== true) return windowOf(sessionId, itemTypes, 0, first);
  // Read on to wherever the end is by then: the session may have grown.
  const start = Math.max(0, first.pagination.total - limit);
  return windowOf(sessionId, itemTypes, start, await readSessionHistory(source, sessionId, { itemTypes, offset: start, pageLimit: limit }));
}

/**
 * The window grown backward by up to `limit` earlier items, read again to
 * the session's end. A window that already starts at the beginning comes
 * back as it is, with no call.
 */
export async function readSessionEarlier(
  source: SessionItemsSource,
  window: SessionItemsWindow,
  options: ReadSessionEarlierOptions = {}
): Promise<SessionItemsWindow> {
  if (window.start === 0) return window;
  const limit = options.limit ?? SESSION_WINDOW_PAGE;
  return reread(source, window, Math.max(0, window.start - limit));
}

/**
 * The window read again from its start to the session's end: new items, and
 * any item stored since among the ones it already held. For a view with no
 * live feed; one that follows the session takes new items from the stream.
 */
export async function refreshSessionWindow(source: SessionItemsSource, window: SessionItemsWindow): Promise<SessionItemsWindow> {
  return reread(source, window, window.start);
}

/**
 * Read the window's session again from `start`, through the client's one
 * paging loop ({@link readSessionHistory}). A session deleted and created
 * again under the id since is another session: the window starts over at its
 * end.
 */
async function reread(source: SessionItemsSource, window: SessionItemsWindow, start: number): Promise<SessionItemsWindow> {
  const { sessionId, itemTypes } = window;
  // Pages of what the window expects plus one, so a read is one call unless the session grew by more.
  const pageLimit = window.total - start + SESSION_WINDOW_PAGE;
  const read = await readSessionHistory(source, sessionId, { itemTypes, offset: start, pageLimit });
  if (window.sessionCreatedAt !== undefined && read.sessionCreatedAt !== window.sessionCreatedAt) {
    return readSessionTail(source, sessionId, itemTypes === undefined ? {} : { itemTypes });
  }
  return windowOf(sessionId, itemTypes, start, read);
}

function windowOf(
  sessionId: string,
  itemTypes: readonly string[] | undefined,
  start: number,
  read: SessionStateSnapshotResponse
): SessionItemsWindow {
  const items = read.items ?? [];
  return {
    sessionId,
    ...(itemTypes === undefined ? {} : { itemTypes }),
    items,
    start,
    total: read.pagination?.total ?? start + items.length,
    hasEarlier: start > 0,
    ...(read.at === undefined ? {} : { at: read.at }),
    ...(read.sessionCreatedAt === undefined ? {} : { sessionCreatedAt: read.sessionCreatedAt })
  };
}
