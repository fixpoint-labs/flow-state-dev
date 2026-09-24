/**
 * The reads the workforce panels share.
 *
 * `Roster` and `BoardColumns` page a collection; `SeatDetail` reads one item.
 * Both go through `useFencedRead`, so the fence protocol lives once. Internal
 * on purpose — exporting a read would let a host mount it twice.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResourceClient } from "@flow-state-dev/client";
import { useReadFence } from "../../hooks/useReadFence";

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
 * Both panels are "a list a person scans" (see `usePanelRows`), not a feed
 * with an unbounded tail, so this is a guard against a misbehaving transport
 * handing back a `nextCursor` forever rather than a limit anyone is expected
 * to reach. At the route's largest page (`STATE_LIST_MAX_LIMIT`, 200 —
 * `packages/engine/src/routes/resource-routes.ts`) this still covers 200,000
 * rows before it gives up and shows what it has.
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
 * One fenced read. `load` is held in a ref so a new closure does not restart
 * the effect; the identity tuple is what restarts it, same as `useReadFence`.
 * A `load` that returns after its identity has been left is discarded.
 */
function useFencedRead<T>(
  identity: readonly unknown[],
  empty: T,
  failureMessage: string,
  load: (stillCurrent: () => boolean) => Promise<T>
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
    void read();
  }, [read]);

  return {
    data: holdsCurrent ? data : empty,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}

/**
 * Every row of a collection, for one session — traversing `nextCursor` until
 * the route stops returning one.
 *
 * Deliberately no `loadMore`: both panels draw a standing list that a person
 * scans, not a feed they page through, and a cursor the host cannot see is
 * worse than none. `limit` sets the page **size** the read requests each
 * time, not a cap on what the panel shows — a collection larger than `limit`
 * still renders every row, in `limit`-sized fetches (bounded by `MAX_PAGES`,
 * see above), because a panel that stopped at the first page would truncate
 * silently (BR-19, BR-21).
 */
export function usePanelRows<TClient = unknown>(
  source: PanelRowSource,
  sessionId: string,
  ref: string,
  limit: number | undefined,
  failureMessage: string
): PanelRows<TClient> {
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
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      return collected;
    }
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
      return result === null || result.clientData === undefined ? null : (result.clientData as TClient);
    }
  );
  return { item: data, isLoading, error, refresh };
}
