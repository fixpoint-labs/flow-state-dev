// FIX-2776.
/**
 * One live feed per open session, shared by every screen that shows it.
 *
 * A conversation, the composer under it, a task's Session and Inbox's detail
 * can all show one session at once. Each reads it through
 * {@link useSharedSessionFeed}, and the provider holds one `useSessionFeed`
 * (react's) per session any of them shows, so a session on screen twice is
 * one stream, not two. The feed closes when the last screen showing its
 * session goes. Modelled on claude-code-style's `src/app/feed.ts`, with the
 * sharing a Shift Manager page needs because several of its panes show one
 * session.
 *
 * What a feed holds is react's `UseSessionFeedResult`: the session's newest
 * items and each item kept since, `undefined` until the history read lands;
 * its connection; its unfinished runs; and `loadEarlier`.
 *
 * A feed whose history read gave up (`stopped`) never reads again on its own;
 * {@link useRetrySessionFeed} closes it and opens a new one for the session.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Client } from "@flow-state-dev/client";
import { useSessionFeed, type UseSessionFeedResult } from "@flow-state-dev/react";

/** The feeds open on the page: which sessions are shown, how many times, and what each feed holds now. */
type Registry = {
  /** Show `sessionId`; returns the call that stops showing it. */
  acquire(sessionId: string): () => void;
  /** What the feed for `sessionId` holds now, or `undefined` while none is open or it hasn't answered. */
  get(sessionId: string): UseSessionFeedResult | undefined;
  subscribe(listener: () => void): () => void;
  /** Close `sessionId`'s feed and open a new one, for every screen showing it. */
  restart(sessionId: string): void;
};

const FeedsContext = createContext<Registry | null>(null);

/** One session's feed, held while any screen shows the session: it hands each change to `publish`. */
function FeedHost({ sessionId, client, publish }: { sessionId: string; client: Pick<Client, "sessions">; publish: (sessionId: string, feed: UseSessionFeedResult | undefined) => void }) {
  const feed = useSessionFeed(sessionId, { client });
  useEffect(() => {
    publish(sessionId, feed);
    // `feed` is a new object each render; publish when what it holds changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, sessionId, feed?.items, feed?.hasEarlier, feed?.runs, feed?.state, feed?.error]);
  useEffect(() => () => publish(sessionId, undefined), [publish, sessionId]);
  return null;
}

/** Hold the page's session feeds, through `client`: one per session a screen shows. */
export function SessionFeedsProvider({ client, children }: { client: Pick<Client, "sessions">; children: ReactNode }) {
  const counts = useRef(new Map<string, number>());
  const held = useRef(new Map<string, UseSessionFeedResult>());
  const listeners = useRef(new Set<() => void>());
  const [shown, setShown] = useState<readonly string[]>([]);
  // Each session's feed generation: a restart bumps it, which keys a new `FeedHost`.
  const [generations, setGenerations] = useState<ReadonlyMap<string, number>>(new Map());

  const publish = useCallback((sessionId: string, feed: UseSessionFeedResult | undefined) => {
    if (feed === undefined) held.current.delete(sessionId);
    else held.current.set(sessionId, feed);
    for (const listener of [...listeners.current]) listener();
  }, []);

  const registry = useMemo<Registry>(
    () => ({
      acquire: (sessionId) => {
        const count = counts.current.get(sessionId) ?? 0;
        counts.current.set(sessionId, count + 1);
        if (count === 0) setShown([...counts.current.keys()]);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const left = (counts.current.get(sessionId) ?? 1) - 1;
          if (left > 0) counts.current.set(sessionId, left);
          else {
            counts.current.delete(sessionId);
            setShown([...counts.current.keys()]);
          }
        };
      },
      get: (sessionId) => held.current.get(sessionId),
      restart: (sessionId) => setGenerations((was) => new Map(was).set(sessionId, (was.get(sessionId) ?? 0) + 1)),
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [],
  );

  return (
    <FeedsContext.Provider value={registry}>
      {shown.map((sessionId) => (
        <FeedHost key={`${sessionId}\u0000${generations.get(sessionId) ?? 0}`} sessionId={sessionId} client={client} publish={publish} />
      ))}
      {children}
    </FeedsContext.Provider>
  );
}

const NO_SUBSCRIBE = () => () => {};

/**
 * Show session `sessionId` live, through the page's one feed for it.
 * `null` shows nothing and returns `undefined`, as it does until the feed
 * answers. Throws outside a {@link SessionFeedsProvider}.
 */
export function useSharedSessionFeed(sessionId: string | null | undefined): UseSessionFeedResult | undefined {
  const registry = useContext(FeedsContext);
  if (registry === null) throw new Error("useSharedSessionFeed: no SessionFeedsProvider above this component");
  useEffect(() => (sessionId == null || sessionId === "" ? undefined : registry.acquire(sessionId)), [registry, sessionId]);
  return useSyncExternalStore(
    sessionId == null ? NO_SUBSCRIBE : registry.subscribe,
    () => (sessionId == null ? undefined : registry.get(sessionId)),
    () => (sessionId == null ? undefined : registry.get(sessionId)),
  );
}

/**
 * Read session `sessionId` again from scratch: close the page's feed for it
 * and open a new one, for every screen showing it. What a Retry under a feed
 * that gave up calls. Throws outside a {@link SessionFeedsProvider}.
 */
export function useRetrySessionFeed(sessionId: string | null | undefined): () => void {
  const registry = useContext(FeedsContext);
  if (registry === null) throw new Error("useRetrySessionFeed: no SessionFeedsProvider above this component");
  return useCallback(() => {
    if (sessionId != null && sessionId !== "") registry.restart(sessionId);
  }, [registry, sessionId]);
}
