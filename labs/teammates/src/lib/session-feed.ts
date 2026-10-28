/**
 * One session's items, live: the snapshot, then the session stream from where
 * the snapshot ended, merged as the client says to (by request and item id,
 * keeping the later copy, in `compareItemOrder`). One feed per session, shared
 * by every watch on it, and closed when the last watch stops.
 */
import { compareItemOrder, type Client } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";

/** How many items one snapshot page reads. */
const PAGE = 500;

export interface SessionFeed {
  /** Every item so far, in display order. */
  items(): OutputItem[];
  /** Called on every change, and at once when the snapshot is already read. Returns the stop. */
  watch(onChange: (items: OutputItem[]) => void): () => void;
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
    if (had === undefined || compareItemOrder(had, item) <= 0) byKey.set(key, item);
  };
  const publish = () => {
    sorted = [...byKey.values()].sort(compareItemOrder);
    for (const listener of listeners) listener(sorted);
  };

  const start = async () => {
    let offset = 0;
    let at: number | undefined;
    let createdAt: number | undefined;
    for (;;) {
      const page = await client.sessions.state(sessionId, { includeItems: true, offset, limit: PAGE });
      at ??= page.at;
      createdAt ??= page.sessionCreatedAt;
      for (const item of page.items ?? []) keep(item);
      if (page.pagination?.hasMore !== true) break;
      offset = page.pagination.nextOffset;
    }
    if (closed) return;
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
  void start().catch((error: unknown) => console.error(`teammates: session ${sessionId} could not be read`, error));

  return {
    items: () => sorted,
    watch(onChange) {
      listeners.add(onChange);
      if (loaded) onChange(sorted);
      return () => {
        listeners.delete(onChange);
        if (listeners.size > 0) return;
        closed = true;
        stop?.();
        onClosed();
      };
    },
  };
}
