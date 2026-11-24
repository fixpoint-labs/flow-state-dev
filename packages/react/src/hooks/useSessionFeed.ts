/**
 * `useSessionFeed(sessionId, options)`: one session followed live, for a
 * screen that is not a `useSession` chat view, such as a board of workers or a
 * task's transcript. It holds the client's `sessionFeed` for the session while
 * the screen shows it: its items, its unfinished runs and how far the
 * connection can be trusted, read again on every change.
 *
 * `items` is `undefined` until the history read lands, so a screen tells
 * "nothing yet" from "nothing there". `followResponse` hands the feed a send's
 * streamed `Response`, so an answer shows as it is written; the session stream
 * carries the finished copies from there. A new session id closes the old
 * feed and opens one for the new session; unmounting closes it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  sessionFeed,
  type Client,
  type SessionConnectionStatus,
  type SessionFeed,
  type SessionFeedSnapshot
} from "@flow-state-dev/client";
import type { OutputItem, SessionRun } from "@flow-state-dev/core/items";
import { useClient } from "../internal/useClient";

/** Options for {@link useSessionFeed}. */
export type UseSessionFeedOptions = {
  /** Keep only these item types. Default: every type. */
  itemTypes?: readonly string[];
  /** Keep transient items too. Default `false`. */
  includeTransient?: boolean;
  /**
   * The client to follow the session through, for a host that holds its own
   * (its user, origin and `fetcher`). Pass a stable reference. Default: the
   * provider's client.
   */
  client?: Pick<Client, "sessions">;
};

/** What {@link useSessionFeed} shows of one session now. */
export type UseSessionFeedResult = {
  /** The session the feed follows. */
  sessionId: string;
  /** The newest history items and every item kept since, in display order; `undefined` until the history read lands. */
  items: readonly OutputItem[] | undefined;
  /** The session holds items older than `items[0]`: call {@link loadEarlier}. */
  hasEarlier: boolean;
  /** The session's unfinished runs as the stream last named them; `null` until it has. */
  runs: readonly SessionRun[] | null;
  /** How far `items` and `runs` can be trusted. */
  state: SessionConnectionStatus;
  /** The last history read's failure, while it is read again and after the feed gave up; `null` once a read lands. */
  error: Error | null;
  /** Add the page of history before `items[0]`. */
  loadEarlier(): Promise<void>;
  /** Keep a send's streamed response (`send(..., { stream: true })`): its items as they are written. */
  followResponse(response: Response): void;
};

const NO_FEED = (): (() => void) => () => {};
const NO_SNAPSHOT = (): undefined => undefined;

/**
 * Follow session `sessionId` live. `null` or `undefined` follows nothing and
 * returns `undefined`, as it does until the feed for this session is open.
 */
export function useSessionFeed(
  sessionId: string | null | undefined,
  options: UseSessionFeedOptions = {}
): UseSessionFeedResult | undefined {
  const built = useClient();
  const client = options.client ?? built;
  const typesKey = options.itemTypes?.join("\u0001");
  const [open, setOpen] = useState<{ sessionId: string; feed: SessionFeed }>();

  useEffect(() => {
    if (sessionId == null || sessionId === "") return;
    const feed = sessionFeed(client, sessionId, {
      ...(options.itemTypes === undefined ? {} : { itemTypes: [...options.itemTypes] }),
      ...(options.includeTransient === undefined ? {} : { includeTransient: options.includeTransient })
    });
    setOpen({ sessionId, feed });
    return () => {
      feed.close();
      setOpen(undefined);
    };
    // `typesKey` stands for `itemTypes`: a new array of the same types keeps the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId, typesKey, options.includeTransient]);

  const feed = open !== undefined && open.sessionId === sessionId ? open.feed : undefined;
  const snapshot: SessionFeedSnapshot | undefined = useSyncExternalStore(
    feed === undefined ? NO_FEED : feed.subscribe,
    feed === undefined ? NO_SNAPSHOT : feed.getSnapshot,
    feed === undefined ? NO_SNAPSHOT : feed.getSnapshot
  );
  if (feed === undefined || snapshot === undefined || sessionId == null) return undefined;
  return {
    sessionId,
    // No items until the history lands, so an empty session reads as empty only once it has been read.
    items: snapshot.historyLoaded ? snapshot.items : undefined,
    hasEarlier: snapshot.hasEarlier,
    runs: snapshot.runs,
    state: snapshot.state,
    error: snapshot.error,
    loadEarlier: feed.loadEarlier,
    followResponse: feed.followResponse
  };
}
