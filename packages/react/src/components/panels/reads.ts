/**
 * The reads the workforce panels share.
 *
 * `Roster`, `BoardColumns` and `BoardList` page a collection; `SeatDetail`
 * reads one item. All go through `useFencedRead`, so the fence protocol lives
 * once. A live `BoardList` reads its board again on the session's changes
 * (`liveBoardDriver`). Internal on purpose — exporting a read would let a host
 * mount it twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareItemOrder, type ClientFetch, type ResourceClient } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { useReadFence } from "../../hooks/useReadFence";
import { coalescedReads, followSession } from "../../internal/followSession";

/**
 * The panels read one method and no more, and the type says which.
 *
 * A host passes the resource client it already holds — with its own `fetcher`,
 * so every request carries whatever credential that transport adds. A panel
 * that built its own client would read through no credential and fail against
 * any deployment that authenticates (BR-29).
 */
export type PanelRowSource = Pick<ResourceClient, "listCollectionItems">;

/** `SeatDetail`'s read is one item, not a page — the method name says which (FIX-1500 BR-27). */
export type PanelItemSource = Pick<ResourceClient, "getCollectionItemState">;

/** One row as a panel receives it: its topic, and the collection's projection of its state. */
export type PanelRow<TClient = unknown> = {
  readonly topic: string;
  readonly clientData: TClient;
};

export type PanelRows<TClient = unknown> = {
  readonly rows: readonly PanelRow<TClient>[];
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Re-read the collection. Safe to call from a host affordance. */
  readonly refresh: () => void;
};

/** Stable empty list, so a stale hold hands back the same reference each render. */
const EMPTY: PanelRow<never>[] = [];

/**
 * A ceiling on pages read for ONE identity, not on rows.
 *
 * The panels are "a list a person scans" (see `usePanelRows`), not a feed
 * with an unbounded tail, so this is a guard against a misbehaving transport
 * handing back a `nextCursor` forever rather than a limit anyone is expected
 * to reach. At the route's largest page (`STATE_LIST_MAX_LIMIT`, 200 —
 * `packages/engine/src/routes/resource-routes.ts`) this still covers 200,000
 * rows. Reaching it with a `nextCursor` still outstanding is a read failure,
 * not a result: the panel shows its error, never the pages it got as if they
 * were the whole list (BR-19, BR-21).
 */
const MAX_PAGES = 1000;

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

type FencedRead<T> = {
  readonly data: T;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
};

/**
 * What starts an identity's reads, when reading once on mount is not all it
 * does. Handed the read (which settles however it went); returns what stops
 * everything it started. Held stable by the caller: a new one restarts the
 * reads. A re-read under rows already drawn shows no loading note: every
 * panel draws that only while it has no rows.
 */
type ReadDriver = (read: () => Promise<void>) => () => void;

/**
 * One fenced read. `load` is held in a ref so a new closure does not restart
 * the effect; the identity tuple is what restarts it, same as `useReadFence`.
 * A `load` that returns after its identity has been left is discarded.
 */
function useFencedRead<T>(
  identity: readonly unknown[],
  empty: T,
  failureMessage: string,
  load: (stillCurrent: () => boolean) => Promise<T>,
  driver?: ReadDriver
): FencedRead<T> {
  const [data, setData] = useState(empty);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fence = useReadFence(identity, () => {
    setData(empty);
    setError(null);
    setIsLoading(true);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const read = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    setIsLoading(true);
    setError(null);
    setHeldIdentity(fence.identity);
    try {
      const next = await loadRef.current(stillCurrent);
      if (!stillCurrent()) return;
      setData(next);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describe(err, failureMessage));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, failureMessage]);

  useEffect(() => {
    if (driver === undefined) {
      void read();
      return;
    }
    return driver(read);
  }, [read, driver]);

  return {
    data: holdsCurrent ? data : empty,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}

/** Where a live read hears about changes, and the transport the stream is sent with. */
export type PanelLive = {
  readonly baseUrl?: string;
  readonly fetcher?: ClientFetch;
};

/**
 * Whether an item says a task on board `boardRef` changed. Two equality
 * checks: the substrate's `task-change` component, naming this board.
 */
function namesBoard(item: OutputItem, boardRef: string): boolean {
  if (item.type !== "component") return false;
  const component = item as { component?: unknown; data?: { collectionId?: unknown } | null };
  return component.component === "task-change" && component.data?.collectionId === boardRef;
}

/**
 * Read a board, and read it again whenever the session keeps a change to it.
 *
 * The stream opens before the board is read on mount, and its opening scan
 * reaches back a minute on the server's own clock. So a change kept around
 * the mount read, before it, during it or after it, is heard, and every change
 * to this board heard for the first time reads it again, whichever scan finds
 * it. A board with no change in the last minute costs one read on mount; a
 * change the opening scan finds adds a read, coalesced with any others as
 * below. Nothing here compares a server's clock with this page's.
 *
 * Reads are coalesced: one in flight, and one queued for any number of
 * changes that arrive meanwhile. A copy the stream delivers again (the same
 * request id and item id, stamped no later than one already heard), as a
 * reconnect does, wakes nothing. What the item carries is never drawn: it says
 * when to read, never what. A stream refused, missing or stopped leaves the
 * rows as they are, with no error.
 */
function liveBoardDriver(sessionId: string, boardRef: string, live: PanelLive): ReadDriver {
  return (read) => {
    const heard = new Map<string, OutputItem>();
    const reads = coalescedReads(read);

    const close = followSession({
      sessionId,
      baseUrl: live.baseUrl,
      fetcher: live.fetcher,
      itemTypes: ["component"],
      onItem: ({ requestId, item }) => {
        if (!namesBoard(item, boardRef)) return;
        const key = `${requestId}\u0000${item.id}`;
        const held = heard.get(key);
        if (held !== undefined && compareItemOrder(item, held) <= 0) return;
        heard.set(key, item);
        reads.request();
      }
    });
    reads.request();

    return () => {
      reads.close();
      close();
    };
  };
}

/**
 * Every row of a collection, for one session — traversing `nextCursor` until
 * the route stops returning one.
 *
 * Deliberately no `loadMore`: the panels draw a standing list that a person
 * scans, not a feed they page through, and a cursor the host cannot see is
 * worse than none. `limit` sets the page **size** the read requests each
 * time, not a cap on what the panel shows — a collection larger than `limit`
 * still renders every row, in `limit`-sized fetches, because a panel that
 * stopped at the first page would truncate silently. The read is bounded by
 * `MAX_PAGES`, which says what happens past it.
 *
 * With `live`, `ref` is a task board, and the rows are read again whenever
 * the session keeps a change to it (see `liveBoardDriver`). Without it they
 * are read once, on mount.
 */
export function usePanelRows<TClient = unknown>(
  source: PanelRowSource,
  sessionId: string,
  ref: string,
  limit: number | undefined,
  failureMessage: string,
  live?: PanelLive
): PanelRows<TClient> {
  const liveBaseUrl = live?.baseUrl;
  const liveFetcher = live?.fetcher;
  const isLive = live !== undefined;
  const driver = useMemo(
    () =>
      isLive ? liveBoardDriver(sessionId, ref, { baseUrl: liveBaseUrl, fetcher: liveFetcher }) : undefined,
    [isLive, sessionId, ref, liveBaseUrl, liveFetcher]
  );
  const { data, isLoading, error, refresh } = useFencedRead<readonly PanelRow<TClient>[]>(
    [source, sessionId, ref, limit],
    EMPTY,
    failureMessage,
    async (stillCurrent) => {
      const collected: PanelRow<TClient>[] = [];
      let cursor: string | undefined;
      for (let pageCount = 0; pageCount < MAX_PAGES; pageCount++) {
        const page = await source.listCollectionItems(sessionId, ref, {
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor })
        });
        if (!stillCurrent()) return collected;
        for (const item of page.items) {
          collected.push({ topic: item.topic, clientData: item.clientData as TClient });
        }
        if (page.nextCursor === undefined) return collected;
        cursor = page.nextCursor;
      }
      throw new Error(
        `Stopped after ${MAX_PAGES} pages with more still to read, rather than show part of the list as all of it.`
      );
    },
    driver
  );
  return { rows: data, isLoading, error, refresh };
}

/** One collection item, plus the state of reading it. `item` is `null` while loading and when the topic is absent — `isLoading` tells them apart. */
export type PanelItem<TClient = unknown> = {
  readonly item: TClient | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Re-read the item. Safe to call from a host affordance. */
  readonly refresh: () => void;
};

/** One collection item for one session. Same fence as {@link usePanelRows}. */
export function usePanelItem<TClient = unknown>(
  source: PanelItemSource,
  sessionId: string,
  ref: string,
  topic: string,
  failureMessage: string
): PanelItem<TClient> {
  const { data, isLoading, error, refresh } = useFencedRead<TClient | null>(
    [source, sessionId, ref, topic],
    null,
    failureMessage,
    async () => {
      const result = await source.getCollectionItemState(sessionId, ref, topic);
      // `result === null` is the ONLY absent case (the route's own contract).
      // A non-null result with no `clientData` is the collection's
      // metadata-only shape (`{ topic, storageKey, hint }`) — the topic
      // exists but this surface can't project it — and that is a read
      // failure, not an absent topic. Handed through as-is, it fails a
      // caller's own shape guard (e.g. `isSeat`) rather than being silently
      // indistinguishable from "no such item".
      if (result === null) return null;
      if (result.clientData === undefined) return result as unknown as TClient;
      return result.clientData as TClient;
    }
  );
  return { item: data, isLoading, error, refresh };
}
