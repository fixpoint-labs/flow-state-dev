/**
 * The one read both panels make (FIX-1477 S5, S6).
 *
 * `Roster` and `BoardColumns` differ in what they draw and agree on how they
 * fetch: every page of a collection's per-item state, for one session, fenced
 * on its identity. Internal on purpose — exporting it would let a host mount
 * the same read twice and pay for it twice, which is the shape the
 * navigator's own reads module exists to prevent.
 *
 * The fence answers two hazards a collection read has, and an "is this still
 * the ref I want?" comparison answers only the first: a response can outlive
 * the ref it was started for (the host swaps its transport, or the panel is
 * re-pointed at another board), and two reads of the SAME ref can race — a
 * mount read against a host's refresh, where both name one ref and agree with
 * any identity check. Only the sequence number `begin()` hands out separates
 * those.
 */
import { useCallback, useEffect, useState } from "react";
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
  const [rows, setRows] = useState<readonly PanelRow<TClient>[]>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);

  const fence = useReadFence([source, sessionId, ref, limit], () => {
    setRows(EMPTY);
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
      const collected: PanelRow<TClient>[] = [];
      let cursor: string | undefined;
      for (let pageCount = 0; pageCount < MAX_PAGES; pageCount++) {
        const page = await source.listCollectionItems(sessionId, ref, {
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor })
        });
        if (!stillCurrent()) return;
        for (const item of page.items) {
          collected.push({ topic: item.topic, clientData: item.clientData as TClient });
        }
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      setRows(collected);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describe(err, failureMessage));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, source, sessionId, ref, limit, failureMessage]);

  useEffect(() => {
    void read();
  }, [read]);

  return {
    rows: holdsCurrent ? rows : EMPTY,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}

/** One collection item, plus the state of reading it — the single-item counterpart of {@link PanelRows}. */
export type PanelItem<TClient = unknown> = {
  /** `null` while loading AND when the topic is absent — see `isLoading`. */
  readonly item: TClient | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Re-read the item. Safe to call from a host affordance. */
  readonly refresh: () => void;
};

/**
 * One collection item, for one session — the single-item counterpart of
 * {@link usePanelRows}, sharing its fence and abort semantics (FIX-1500 S5).
 *
 * Not exported for the same reason `usePanelRows` is not: it exists so a host
 * cannot mount the same read twice and pay for it twice. `SeatDetail` is the
 * one caller, and it mounts this hook only while there is a topic to read —
 * "mounting is the gate" (see `flow-navigator/FlowNavigator.ts`'s
 * `LeafSessionList`), so a seat with no public roster row makes no call at
 * all rather than calling and discarding a `null`.
 *
 * `item` is `null` for both "still loading" and "the topic is not present in
 * the collection" — `isLoading` is what tells them apart; a caller checks
 * that first; this matches the shape `usePanelRows` already has read/render
 * split into.
 */
export function usePanelItem<TClient = unknown>(
  source: PanelItemSource,
  sessionId: string,
  ref: string,
  topic: string,
  failureMessage: string
): PanelItem<TClient> {
  const [item, setItem] = useState<TClient | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);

  const fence = useReadFence([source, sessionId, ref, topic], () => {
    setItem(null);
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
      const result = await source.getCollectionItemState(sessionId, ref, topic);
      if (!stillCurrent()) return;
      setItem(result === null || result.clientData === undefined ? null : (result.clientData as TClient));
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describe(err, failureMessage));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, source, sessionId, ref, topic, failureMessage]);

  useEffect(() => {
    void read();
  }, [read]);

  return {
    item: holdsCurrent ? item : null,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}
