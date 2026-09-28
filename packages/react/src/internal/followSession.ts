/**
 * Following a session's stream from a view that reads the session some other
 * way, and re-reading on what it hears. Internal: shared by `useSession`'s
 * `live` and `BoardList`'s, so both keep one meaning for when the stream
 * vouches for a session and when it has stopped.
 */
import { createSessionSSEClient, type ClientFetch } from "@flow-state-dev/client";
import type { SessionItemEvent, SessionRunsChangedEvent } from "@flow-state-dev/core/items";

export type FollowSessionOptions = {
  readonly sessionId: string;
  readonly baseUrl?: string;
  /** The transport the stream is sent with, so it carries the view's credential. */
  readonly fetcher?: ClientFetch;
  readonly since?: number;
  readonly sessionCreatedAt?: number;
  readonly itemTypes?: string[];
  /**
   * A finished item the session kept. `history` is true for an item the
   * stream's very first read found: one kept before the stream opened, as far
   * back as that read reaches. An item a reconnect delivers again is not
   * history; telling a repeat apart is the caller's (`requestId` and `item.id`,
   * ordered by `compareItemOrder`).
   */
  readonly onItem: (event: SessionItemEvent, meta: { readonly history: boolean }) => void;
  /** The session's unfinished runs: named first on every connection, then on each change. */
  readonly onRuns?: (event: SessionRunsChangedEvent) => void;
  /**
   * The stream had named the runs and has stopped following the session: a
   * reconnect failed, or it was refused for good. A stream refused or dropped
   * before it named anything reports nothing, and the view carries on as it
   * would without the stream.
   */
  readonly onLapsed?: () => void;
};

/**
 * Open the session's stream. Returns what closes it.
 *
 * Every connection names the runs first, and an item's `at` stays the point
 * the connection's first read reached back to until that read's items are all
 * sent. So an item whose `at` is the one the opening notice carried was found
 * by that connection's first read.
 */
export function followSession(options: FollowSessionOptions): () => void {
  let following = false;
  let connection = 0;
  let openingAt: number | undefined;

  const handle = createSessionSSEClient({
    sessionId: options.sessionId,
    baseUrl: options.baseUrl,
    fetcher: options.fetcher,
    since: options.since,
    sessionCreatedAt: options.sessionCreatedAt,
    itemTypes: options.itemTypes,
    onItem: (event) => {
      options.onItem(event, { history: connection === 1 && event.at === openingAt });
    },
    onRuns: (event) => {
      if (openingAt === undefined) {
        connection += 1;
        openingAt = event.at;
      }
      following = true;
      options.onRuns?.(event);
    },
    // The first try after a drop takes about a second, the stream's own pace;
    // once one has failed, what it last said may no longer be current.
    onReconnecting: ({ attempt }) => {
      openingAt = undefined;
      if (following && attempt >= 2) options.onLapsed?.();
    },
    // Refused for good, or the session is gone.
    onStop: () => {
      if (following) options.onLapsed?.();
    }
  });
  return () => handle.close();
}

/**
 * Run `read` on request, one at a time. A request made while a read runs
 * queues exactly one more, however many arrive, which starts once that read
 * settles. `close` drops the queued one.
 */
export function coalescedReads(read: () => Promise<void>): { request: () => void; close: () => void } {
  let running = false;
  let queued = false;
  let closed = false;

  const run = (): void => {
    running = true;
    const settled = (): void => {
      running = false;
      if (closed || !queued) return;
      queued = false;
      run();
    };
    read().then(settled, settled);
  };

  return {
    request: () => {
      if (closed) return;
      if (running) queued = true;
      else run();
    },
    close: () => {
      closed = true;
      queued = false;
    }
  };
}
