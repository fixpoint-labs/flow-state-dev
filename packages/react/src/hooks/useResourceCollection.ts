/**
 * Hook for accessing a collection resource via paginated reads (FIX-427).
 *
 * Snapshot exposes only `count` and an opt-in `prefetched` window. Use
 * `list()` / `get()` for on-demand reads, or one of the convenience hooks
 * (`useResourceCollectionList`, `useResourceCollectionItem`).
 *
 * Caching lives per-instance: each hook call owns its own page cache keyed
 * by the normalized query, for the current client, session and collection. On
 * `resource_change` items observed in the session stream, entries for the
 * affected ref are invalidated; active subscribers refetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CollectionItemHandle,
  type CollectionItemState,
  type CollectionListPage,
  type CollectionSnapshotEntry,
  type CollectionSnapshotPrefetchedItem,
  type ResourcesApi
} from "@flow-state-dev/client";
import type { SessionView } from "./useSession";
import { useReadFence, type ReadFence } from "./useReadFence";
import { useClient } from "../internal/useClient";

/**
 * Mutation actions available on the collection, shaped by declared permissions.
 * Methods always exist; the server returns 403 when a permission is missing.
 */
export type CollectionActions = {
  create: (options: { topic: string; content?: string }) => Promise<{ topic: string }>;
  update: (options: { topic: string; content: string }) => Promise<void>;
  delete: (options: { topic: string }) => Promise<void>;
};

/** Options accepted by `list()` and the convenience list hook. */
export type CollectionListOptions = {
  limit?: number;
  /** Opaque pagination cursor from a prior page's `nextCursor`. */
  cursor?: string;
  topicPrefix?: string;
};

/**
 * Return type for useResourceCollection.
 *
 * `TClient` (FIX-741) is the collection's projected per-item client-data type;
 * pass it via the hook generic, e.g.
 * `useResourceCollection<ClientDataOf<typeof memos>>(...)`. Defaults to `unknown`
 * so existing untyped call sites are unchanged.
 */
export type UseResourceCollectionResult<TClient = unknown> = {
  /**
   * Fetch a paginated page of items. Cached by normalized query. A `list` kept
   * from before a session, ref or client change still reads, uncached, for the
   * identity it was made for.
   */
  list: (options?: CollectionListOptions) => Promise<CollectionListPage>;
  /** Fetch a single item by topic. Returns `null` if not present. */
  get: (topic: string) => Promise<CollectionItemState | null>;
  /** Alias for list(); reads more naturally when a topicPrefix is the focus. */
  query: (options: CollectionListOptions) => Promise<CollectionListPage>;
  /** Mutation actions (create/update/delete content). */
  actions: CollectionActions;
  /** Clear the per-instance page cache and re-trigger active subscribers. */
  refetch: () => void;
  /** Items inlined in the snapshot when `prefetchWindow > 0`, wrapped as handles. */
  prefetched: CollectionItemHandle<TClient>[] | undefined;
  /** Total item count from the snapshot, when the collection is client-visible. */
  count: number | undefined;
  /**
   * Per-topic live overlay from the snapshot (FIX-739), populated for
   * `client.live: true` collections. A created/updated entry carries
   * `clientData`; a deleted entry is a tombstone (`deleted: true`). The
   * convenience hooks apply this over their fetched items so list/item reads
   * reflect mid-stream mutations without a refetch.
   */
  live: Record<string, { clientData?: unknown; deleted?: boolean }> | undefined;
  /**
   * Wraps a raw `{ topic, clientData? }` page item from `list()` as a
   * `CollectionItemHandle` with the FIX-296 lazy `fetchContent()` ergonomic.
   * Reuses the hook's resource client; the convenience hooks
   * (`useResourceCollectionList` / `useResourceCollectionItem`) share this
   * to avoid constructing redundant clients.
   */
  wrap: (raw: { topic: string; clientData?: unknown; content?: string }) => CollectionItemHandle<TClient>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type CachedPage = {
  page: CollectionListPage;
};

type PageCache = {
  owner: ReadFence | null;
  pages: Map<string, CachedPage>;
};

/** Normalized cache key — sorted JSON of the query. */
function cacheKey(options: CollectionListOptions | undefined): string {
  if (!options) return "{}";
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(options).sort()) {
    const v = (options as Record<string, unknown>)[k];
    if (v !== undefined) sorted[k] = v;
  }
  return JSON.stringify(sorted);
}

/**
 * Returns `true` if a resource_change path likely affects items in `ref`.
 * Conservative: any path starting with `ref/` or exactly `ref` triggers
 * invalidation. False positives are tolerable; missed invalidations are not.
 */
function pathAffectsCollection(path: string, ref: string): boolean {
  return path === ref || path.startsWith(`${ref}/`);
}

/**
 * Locate the snapshot entry for `ref` across all scopes. None while the view
 * still holds the previous session's snapshot: `useSession` keeps it on a
 * switch until the new session's snapshot is read.
 */
export function findCollectionEntry(
  session: SessionView,
  ref: string
): CollectionSnapshotEntry | undefined {
  if (session.snapshot?.sessionId !== session.sessionId) return undefined;
  const resources = session.snapshot?.resources;
  if (!resources) return undefined;
  for (const scope of ["session", "user", "org"] as const) {
    const scopeResources = resources[scope];
    if (scopeResources && ref in scopeResources) {
      const candidate = scopeResources[ref];
      if (candidate && typeof candidate === "object") {
        return candidate as CollectionSnapshotEntry;
      }
    }
  }
  return undefined;
}

function wrapItem<TClient>(
  raw: { topic: string; clientData?: unknown; content?: string },
  client: ResourcesApi,
  sessionId: string | undefined,
  ref: string
): CollectionItemHandle<TClient> {
  return {
    topic: raw.topic,
    // Runtime payload is the server's JsonValue projection; the cast threads the
    // declared TClient (FIX-741), backed by the projection contract.
    clientData: raw.clientData as TClient,
    fetchContent: async () => {
      if (!sessionId) return null;
      if (raw.content !== undefined) return raw.content;
      const result = await client.getCollectionItemContent(sessionId, ref, raw.topic);
      return result.content;
    }
  };
}

// ---------------------------------------------------------------------------
// useResourceCollection
// ---------------------------------------------------------------------------

export function useResourceCollection<TClient = unknown>(
  session: SessionView,
  ref: string
): UseResourceCollectionResult<TClient> {
  // One memoized client per hook: the fence below keys on it.
  const client = useClient().resources;

  const sessionId = session.sessionId;

  // The fence object names one stay: A → B → A does not reuse the first cache.
  const fence = useReadFence([client, sessionId, ref]);

  // Replaced on the first read under a new fence, not from an effect: a child
  // effect can call `list` before this hook's effects run.
  const cacheRef = useRef<PageCache>({ owner: null, pages: new Map() });
  // Generation counter — bumped on invalidation. Captured before each list()
  // await, then compared after to discard stale write-backs from races
  // between SSE invalidations and in-flight requests. Also flows into the
  // memoized callbacks so convenience hooks can re-run their effects.
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);

  const invalidate = useCallback(() => {
    cacheRef.current.pages.clear();
    generationRef.current++;
    setGeneration(generationRef.current);
  }, []);

  // Watch the session's resource_change notice channel for events touching
  // this collection. `session.items` filters out transients by default, so
  // a hook earlier in the file's history that watched `session.items` for
  // `resource_change` rows missed every mid-stream mutation when the caller
  // did not opt into transients. `session.resourceChanges` is the dedicated
  // side channel: surfaced regardless of the items filter, so every active
  // ref subscriber gets a chance to invalidate the moment the change lands.
  const lastSeenResourceChangeIdxRef = useRef(0);
  useEffect(() => {
    const changes = session.resourceChanges;
    const start = lastSeenResourceChangeIdxRef.current;
    lastSeenResourceChangeIdxRef.current = changes.length;
    for (let i = start; i < changes.length; i++) {
      if (pathAffectsCollection(changes[i]!.resourcePath, ref)) {
        invalidate();
        break;
      }
    }
  }, [session.resourceChanges, ref, invalidate]);

  const collectionEntry = useMemo(
    () => findCollectionEntry(session, ref),
    [session.snapshot, session.sessionId, ref]
  );

  // Snapshot refresh as a fallback invalidator, behind the
  // `session.resourceChanges` watcher above. useSession calls
  // `refreshSnapshot()` at request completion when any resource changed
  // during streaming, which updates `count` (always emitted, FIX-427 §3.6).
  // Invalidate whenever count moves so cached pages refetch on the next call.
  const lastSeenCountRef = useRef<number | undefined>(collectionEntry?.count);
  useEffect(() => {
    const next = collectionEntry?.count;
    if (next !== lastSeenCountRef.current) {
      lastSeenCountRef.current = next;
      invalidate();
    }
  }, [collectionEntry?.count, invalidate]);

  const list = useCallback(
    async (options?: CollectionListOptions): Promise<CollectionListPage> => {
      if (!sessionId) {
        return { items: [] };
      }
      // Still answers for the identity it closed over. This cache belongs to the one in play.
      if (!fence.isCurrent()) {
        return client.listCollectionItems(sessionId, ref, options);
      }
      if (cacheRef.current.owner !== fence) {
        cacheRef.current = { owner: fence, pages: new Map() };
      }
      const cache = cacheRef.current;
      const key = cacheKey(options);
      const cached = cache.pages.get(key);
      if (cached !== undefined) return cached.page;

      // Skip the write if invalidate() bumped generation. Write `cache`, not
      // `cacheRef.current`: a switch replaces that ref while this is in flight.
      const startGen = generationRef.current;
      const page = await client.listCollectionItems(sessionId, ref, options);
      if (startGen === generationRef.current) {
        cache.pages.set(key, { page });
      }
      return page;
    },
    // generation is in deps so the callback identity flips on invalidation;
    // convenience hooks watching `list` re-run their effects and refetch.
    [client, ref, sessionId, fence, generation]
  );

  const get = useCallback(
    async (topic: string): Promise<CollectionItemState | null> => {
      const sessionId = session.sessionId;
      if (!sessionId) return null;
      return client.getCollectionItemState(sessionId, ref, topic);
    },
    // `generation` is in deps so the callback identity flips on invalidation;
    // `useResourceCollectionItem` watches `get` and refetches the active topic
    // when a resource_change bumps the generation (e.g., a memo transitioning
    // from `writing` → `published` while the user is viewing it).
    [client, ref, session.sessionId, generation]
  );

  const query = useCallback(
    (options: CollectionListOptions) => list(options),
    [list]
  );

  const actions = useMemo<CollectionActions>(() => ({
    create: async (options) => {
      const sessionId = session.sessionId;
      if (!sessionId) throw new Error("No active session");
      const result = await client.createCollectionItem(sessionId, ref, options);
      invalidate();
      return result;
    },
    update: async (options) => {
      const sessionId = session.sessionId;
      if (!sessionId) throw new Error("No active session");
      await client.updateResourceContent(sessionId, ref, options.topic, {
        content: options.content
      });
      invalidate();
    },
    delete: async (options) => {
      const sessionId = session.sessionId;
      if (!sessionId) throw new Error("No active session");
      await client.deleteCollectionItem(sessionId, ref, options.topic);
      invalidate();
    }
  }), [client, ref, session.sessionId, invalidate]);

  const wrap = useCallback(
    (raw: { topic: string; clientData?: unknown; content?: string }) =>
      wrapItem<TClient>(raw, client, session.sessionId, ref),
    [client, session.sessionId, ref]
  );

  const prefetched = useMemo<CollectionItemHandle<TClient>[] | undefined>(() => {
    const raw = collectionEntry?.prefetched as CollectionSnapshotPrefetchedItem[] | undefined;
    if (raw === undefined) return undefined;
    return raw.map(wrap);
  }, [collectionEntry, wrap]);

  return {
    list,
    get,
    query,
    actions,
    refetch: invalidate,
    prefetched,
    count: collectionEntry?.count,
    live: collectionEntry?.live,
    wrap,
  };
}
