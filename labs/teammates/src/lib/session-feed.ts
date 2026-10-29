/**
 * One session's items, live: the snapshot, then the session stream from where
 * the snapshot ended, merged as the client says to (by request and item id,
 * keeping the later copy, in `compareItemOrder`). One feed per session, shared
 * by every watch on it, and closed when the last watch stops.
 *
 * The session stream sends an item once it is finished, and a request's stream
 * read by id carries no text as it is written, so an answer being written
 * comes from the send's own response: {@link SessionFeed.followResponse} keeps
 * its messages as they grow, and its tool results and components as they land.
 */
import { bindStoreToCallbacks, compareItemOrder, createRequestStreamStore, createSSEClientFromResponse, type Client } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";

/** How many items one snapshot page reads. */
const PAGE = 500;
/** How long a failed snapshot read waits before it is read again. */
const RETRY_MS = 2_000;
/** The kinds of item a send's own stream is kept for. */
const FOLLOWED = new Set(["message", "tool_output", "component"]);

export interface SessionFeed {
  /** Every item so far, in display order. */
  items(): OutputItem[];
  /** Called on every change, and at once when the snapshot is already read. Returns the stop. */
  watch(onChange: (items: OutputItem[]) => void): () => void;
  /** Keep a send's streamed response, its messages as they are written, until it ends. */
  followResponse(response: Response): void;
}

/** The feeds of one client, by session id. */
export function sessionFeeds(client: Client): (sessionId: string) => SessionFeed {
  const feeds = new Map<string, SessionFeed>();
  return (sessionId) => {
    let feed = feeds.get(sessionId);
    if (feed === undefined) {
      feed = follow(client, sessionId, () => feeds.delete(sessionId));
      feeds.set(sessionId, feed);
    }
    return feed;
  };
}

function follow(client: Client, sessionId: string, onClosed: () => void): SessionFeed {
  const byKey = new Map<string, OutputItem>();
  const listeners = new Set<(items: OutputItem[]) => void>();
  let sorted: OutputItem[] = [];
  let stop: (() => void) | undefined;
  let closed = false;
  let loaded = false;

  const keep = (item: OutputItem) => {
    const key = `${item.requestId}:${item.id}`;
    const had = byKey.get(key);
    // A request's stream can trail the session's: a finished copy is never replaced by a partial one.
    if (had?.status === "completed" && item.status !== "completed") return;
    if (had === undefined || compareItemOrder(had, item) <= 0) byKey.set(key, item);
  };
  const publish = () => {
    sorted = [...byKey.values()].sort(compareItemOrder);
    for (const listener of listeners) listener(sorted);
  };

  /**
   * Every page of the snapshot, or `undefined` when the history moved while it
   * was read. As `useSession` reads it: each later page starts one item early,
   * on the last item already held, and a page that doesn't start there means a
   * keyed item was emitted again or a request removed, so a later item may
   * have been skipped, and one the stream would never send.
   */
  const readPages = async () => {
    const items: OutputItem[] = [];
    let first: { at?: number; sessionCreatedAt?: number } | undefined;
    for (let offset = 0; ; ) {
      const page = await client.sessions.state(sessionId, { includeItems: true, offset, limit: PAGE });
      let pageItems = page.items ?? [];
      if (first === undefined) {
        first = page;
      } else {
        const last = items[items.length - 1];
        const overlap = pageItems[0];
        if (page.sessionCreatedAt !== first.sessionCreatedAt || last === undefined || overlap === undefined || compareItemOrder(overlap, last) !== 0) {
          return undefined;
        }
        pageItems = pageItems.slice(1);
      }
      items.push(...pageItems);
      if (page.pagination?.hasMore !== true) return { items, at: first.at, createdAt: first.sessionCreatedAt };
      offset = page.pagination.nextOffset - 1;
    }
  };

  /** The streamed responses followed, each with its stop. */
  const responses = new Set<() => void>();
  const followResponse = (response: Response) => {
    if (closed) return;
    const store = createRequestStreamStore();
    let done = false;
    const end = () => {
      done = true;
      responses.delete(end);
      handle.close();
    };
    const handle = createSSEClientFromResponse({
      response,
      ...bindStoreToCallbacks(store, {
        onChange: () => {
          if (done) return;
          store.flushDeltas();
          // Messages as they are written, and tool results and components as they land, so a card
          // a turn draws (a message sent, a task filed) sits where it happened, not sorted in later.
          for (const item of store.getSorted()) if (FOLLOWED.has(item.type)) keep(item);
          publish();
          // Ended: the session stream carries its finished items from here.
          if (store.status !== "in_progress") end();
        },
      }),
    });
    responses.add(end);
  };

  const start = async () => {
    let read: Awaited<ReturnType<typeof readPages>>;
    do read = await readPages();
    while (read === undefined && !closed);
    if (closed || read === undefined) return;
    const { at, createdAt } = read;
    for (const item of read.items) keep(item);
    loaded = true;
    publish();
    const handle = client.sessions.stream(sessionId, {
      ...(at === undefined ? {} : { since: at }),
      ...(createdAt === undefined ? {} : { sessionCreatedAt: createdAt }),
      onItem: (event) => {
        keep(event.item);
        publish();
      },
    });
    stop = () => handle.close();
  };
  // A failed read is read again while anyone watches; the feed stays cached, so nothing else would.
  const startUntilRead = async (): Promise<void> => {
    try {
      await start();
    } catch (error: unknown) {
      console.error(`teammates: session ${sessionId} could not be read; reading again`, error);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      if (!closed && !loaded) return startUntilRead();
    }
  };
  void startUntilRead();

  return {
    items: () => sorted,
    followResponse,
    watch(onChange) {
      listeners.add(onChange);
      if (loaded) onChange(sorted);
      return () => {
        listeners.delete(onChange);
        if (listeners.size > 0) return;
        closed = true;
        stop?.();
        for (const end of [...responses]) end();
        onClosed();
      };
    },
  };
}
