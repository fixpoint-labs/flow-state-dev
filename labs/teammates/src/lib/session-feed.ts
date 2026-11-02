/**
 * One feed per session, shared by every watch on it and closed when the last
 * watch stops. The feed itself is the client's `sessionFeed`: the session's
 * newest items, then the session stream, with a send's own streamed response
 * kept as it is written ({@link SessionFeed.followResponse}).
 */
import { sessionFeed, type Client, type SessionConnectionState } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";

export interface SessionFeed {
  /** Every item so far, in display order. */
  items(): readonly OutputItem[];
  /** Called on every change, and at once when the history is already read. Returns the stop. */
  watch(onChange: (items: readonly OutputItem[]) => void): () => void;
  /** Called with the connection's state now and on each change of it. Returns the stop. */
  watchState(onChange: (state: SessionConnectionState) => void): () => void;
  /** Keep a send's streamed response, its messages as they are written, until it ends. */
  followResponse(response: Response): void;
}

/** The feeds of one client, by session id. */
export function sessionFeeds(client: Client): (sessionId: string) => SessionFeed {
  const feeds = new Map<string, SessionFeed>();
  return (sessionId) => {
    let feed = feeds.get(sessionId);
    if (feed === undefined) {
      feed = shared(client, sessionId, () => feeds.delete(sessionId));
      feeds.set(sessionId, feed);
    }
    return feed;
  };
}

function shared(client: Client, sessionId: string, onClosed: () => void): SessionFeed {
  const feed = sessionFeed(client, sessionId);
  let watches = 0;
  // One more watch on the feed; its stop closes the feed with the last one.
  const hold = (stop: () => void) => {
    watches += 1;
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      stop();
      watches -= 1;
      if (watches > 0) return;
      feed.close();
      onClosed();
    };
  };
  // The history has landed once the feed shows items, or once it says how far they can be trusted.
  const loaded = () => {
    const { items, state } = feed.getSnapshot();
    return items.length > 0 || state !== "connecting";
  };
  return {
    items: () => feed.getSnapshot().items,
    followResponse: (response) => feed.followResponse(response),
    watch(onChange) {
      let last: readonly OutputItem[] | undefined;
      const tell = (items: readonly OutputItem[]) => {
        // Nothing until the history lands, and a change of connection state alone leaves the items as they were.
        if (!loaded() || items === last) return;
        last = items;
        onChange(items);
      };
      const stop = feed.subscribe(({ items }) => tell(items));
      tell(feed.getSnapshot().items);
      return hold(stop);
    },
    watchState(onChange) {
      let last: SessionConnectionState | undefined;
      const tell = (state: SessionConnectionState) => {
        if (state === last) return;
        last = state;
        onChange(state);
      };
      const stop = feed.subscribe(({ state }) => tell(state));
      tell(feed.getSnapshot().state);
      return hold(stop);
    },
  };
}
