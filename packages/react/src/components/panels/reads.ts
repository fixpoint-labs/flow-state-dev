/**
 * The reads the workforce panels share.
 *
 * `Roster`, `BoardColumns` and `BoardList` page a collection; `WorkerDetail`
 * reads one item. All go through the package's internal `useFencedRead`
 * (`internal/useFencedRead.ts`), which the flow navigator's reads share, so the
 * fence protocol lives there, once. A live `BoardList` reads its board again on
 * each board notice (`liveBoardDriver`); a live `Roster` or `BoardColumns`
 * reads its collection again on another session's change to it, heard through
 * `client.subscribe` (`liveScopeDriver`, FIX-1506). Internal on purpose —
 * exporting a read would let a host mount it twice.
 */
import { useMemo } from "react";
import { readEveryCollectionPage, topic, type Client, type ResourcesApi, type WireNotice } from "@flow-state-dev/client";
import { coalescedReads } from "../../internal/coalescedReads";
import { LIVE_POLL_MS, mayBelongTo, storagePrefixOf } from "../../internal/scopeNotices";
import { useFencedRead, type ReadDriver } from "../../internal/useFencedRead";

/**
 * The slice of the one client a panel reads, and the type says which method.
 *
 * A host passes the client it already holds — with its own `fetcher`, so every
 * request carries whatever credential that transport adds. A panel that built
 * its own client would read through no credential and fail against any
 * deployment that authenticates (BR-29).
 */
export type PanelRowSource = { readonly resources: Pick<ResourcesApi, "listCollectionItems"> };

/** `WorkerDetail`'s read is one item, not a page — the method name says which (FIX-1500 BR-27). */
export type PanelItemSource = { readonly resources: Pick<ResourcesApi, "getCollectionItemState"> };

/**
 * A live `BoardList`'s slice: the board read, and the subscription that says
 * when to read it again. Both go through the one client, so the subscription
 * always carries the read's credential.
 */
export type PanelLiveSource = PanelRowSource & { readonly subscribe: Client["subscribe"] };

/**
 * A live `Roster`'s or `BoardColumns`' slice: the collection read, the
 * manifest that names the collection's storage path, and `subscribe`, which
 * says when to read again. All through the one client, so every read and the
 * subscription carry the host's credential.
 */
export type PanelNoticeSource = {
  readonly resources: Pick<ResourcesApi, "listCollectionItems" | "getResourceManifest">;
  readonly subscribe: Client["subscribe"];
};

/** How a live panel hears its changes: its board's notices (`BoardList`) or the scopes' resource notices. */
export type PanelLive = { readonly board: PanelLiveSource } | { readonly notices: PanelNoticeSource };

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
 * Read a board, and read it again whenever it changes (FIX-2429).
 *
 * The list subscribes its session's topic narrowed to the board, through the
 * client's `subscribe`, so a task settled in any session, on any process,
 * reaches it as a board notice, and a streaming reply in the session (its
 * `items` notices) never does. It reads on mount, on each notice, and on each
 * connect, reconnect or timer tick (`null`), which may have missed a change.
 *
 * Reads are coalesced: one in flight, and one queued for any number of
 * notices that arrive meanwhile. A notice says when to read, never what: the
 * rows drawn are always the read's.
 */
function liveBoardDriver(sessionId: string, boardRef: string, client: PanelLiveSource): ReadDriver {
  return (read) => {
    const reads = coalescedReads(read);
    const subscription = client.subscribe([topic.session(sessionId, { resource: boardRef })], {
      onChange: () => reads.request(),
      pollIntervalMs: LIVE_POLL_MS
    });
    reads.request();

    return () => {
      reads.close();
      subscription.close();
    };
  };
}

/**
 * Read a collection, and read it again whenever another session changes it.
 *
 * Subscribes the session's, the user's and the org's topics through the
 * client's `subscribe` (one socket per client, a timer wherever push can miss
 * a change), and reads again on a `resource` notice whose path is under the
 * collection, and on a connect, a reconnect, a tick or a `resync`. The
 * collection's storage path comes from the manifest, read once: a key such as
 * `roster` stores under `workforce/workers/…`. If the manifest can't be read,
 * every resource notice reads again: a read too many, never one missed. So
 * does a pattern with no static prefix.
 * Reads are coalesced: one in flight, one queued.
 */
function liveScopeDriver(sessionId: string, ref: string, client: PanelNoticeSource): ReadDriver {
  return (read) => {
    const reads = coalescedReads(read);
    let prefix: string | null | undefined;
    void client.resources.getResourceManifest(sessionId).then(
      (manifest) => {
        prefix = storagePrefixOf(manifest, ref);
      },
      () => {
        prefix = undefined;
      }
    );
    // Before the manifest lands, or if it fails, and for a pattern with no
    // static prefix (`**`, `[topic]/observations`), no path is ruled out.
    const names = (path: string | undefined): boolean => path === undefined || mayBelongTo(path, ref, prefix);

    const subscription = client.subscribe([topic.session(sessionId), topic.user(), topic.org()], {
      onChange: (notice: WireNotice | null) => {
        if (notice === null || notice.kind === "resync") return reads.request();
        if (notice.kind === "resource" && names(notice.topic.resource)) reads.request();
      },
      pollIntervalMs: LIVE_POLL_MS
    });
    reads.request();

    return () => {
      reads.close();
      subscription.close();
    };
  };
}

/**
 * Every row of a collection, for one session — traversing `nextCursor` until
 * the route stops returning one, through the client's shared
 * `readEveryCollectionPage` (up to `COLLECTION_READ_MAX_PAGES`, 1,000 pages).
 *
 * Deliberately no `loadMore`: the panels draw a standing list that a person
 * scans, not a feed they page through, and a cursor the host cannot see is
 * worse than none. `limit` sets the page **size** the read requests each
 * time, not a cap on what the panel shows — a collection larger than `limit`
 * is read in `limit`-sized fetches, because a panel that stopped at the first
 * page would truncate silently. The ceiling is a guard against a transport
 * that hands back a `nextCursor` forever, not a limit anyone is expected to
 * reach. A collection with pages left after it, or a server that repeats a
 * cursor, is an error (the panel's error line and Retry), never the rows read
 * so far (BR-19, BR-21).
 *
 * With `live.board`, `ref` is a task board, and the rows are read again on
 * each of its board notices (see `liveBoardDriver`). With `live.notices`, they
 * are read again on another session's change to the collection (see
 * `liveScopeDriver`). Without either they are read once, on mount.
 */
export function usePanelRows<TClient = unknown>(
  source: PanelRowSource,
  sessionId: string,
  ref: string,
  limit: number | undefined,
  failureMessage: string,
  live?: PanelLive
): PanelRows<TClient> {
  const liveSource = live === undefined ? undefined : "board" in live ? live.board : live.notices;
  const byBoard = live !== undefined && "board" in live;
  const driver = useMemo(
    () =>
      liveSource === undefined
        ? undefined
        : byBoard
          ? liveBoardDriver(sessionId, ref, liveSource as PanelLiveSource)
          : liveScopeDriver(sessionId, ref, liveSource as PanelNoticeSource),
    [liveSource, byBoard, sessionId, ref]
  );
  const { data, isLoading, error, refresh } = useFencedRead<readonly PanelRow<TClient>[]>(
    [source, sessionId, ref, limit],
    EMPTY,
    failureMessage,
    async (stillCurrent) => {
      const items = await readEveryCollectionPage(source.resources, sessionId, ref, { limit, keepReading: stillCurrent });
      return items.map((item) => ({ topic: item.topic, clientData: item.clientData as TClient }));
    },
    { driver }
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
      const result = await source.resources.getCollectionItemState(sessionId, ref, topic);
      // `result === null` is the ONLY absent case (the route's own contract).
      // A non-null result with no `clientData` is the collection's
      // metadata-only shape (`{ topic, storageKey, hint }`) — the topic
      // exists but this surface can't project it — and that is a read
      // failure, not an absent topic. Handed through as-is, it fails a
      // caller's own shape guard (e.g. `isWorker`) rather than being silently
      // indistinguishable from "no such item".
      if (result === null) return null;
      if (result.clientData === undefined) return result as unknown as TClient;
      return result.clientData as TClient;
    }
  );
  return { item: data, isLoading, error, refresh };
}
