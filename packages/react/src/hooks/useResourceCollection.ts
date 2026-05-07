/**
 * Hook for accessing a collection resource via paginated reads (FIX-427).
 *
 * Snapshot exposes only `count` and an opt-in `prefetched` window. Use
 * `list()` / `get()` for on-demand reads, or one of the convenience hooks
 * (`useResourceCollectionList`, `useResourceCollectionItem`).
 *
 * Caching lives per-instance: each hook call owns its own page cache keyed
 * by the normalized query. On `resource_change` items observed in the
 * session stream, entries for the affected ref are invalidated; active
 * subscribers refetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createResourceClient,
  type CollectionItemHandle,
  type CollectionItemState,
  type CollectionListPage,
  type CollectionSnapshotEntry,
  type CollectionSnapshotPrefetchedItem,
  type ResourceClient
} from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { SessionView } from "./useSession";
import { useFlowContext } from "../context/FlowContext";

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
  offset?: number;
  topicPrefix?: string;
};

/**
 * Return type for useResourceCollection.
 */
export type UseResourceCollectionResult = {
  /** Fetch a paginated page of items. Cached by normalized query. */
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
  prefetched: CollectionItemHandle[] | undefined;
  /** Total item count from the snapshot, when the collection is client-visible. */
  count: number | undefined;
};

/** @deprecated keep for soft back-compat with callers reading `CollectionItem`. */
export type CollectionItem = CollectionItemHandle;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type CachedPage = {
  page: CollectionListPage;
  epoch: number;
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
 * Returns `true` if a resource_change item likely affects items in `ref`.
 * Conservative: any path starting with `ref/` or exactly `ref` triggers
 * invalidation. False positives are tolerable; missed invalidations are not.
 */
function affectsCollection(item: OutputItem, ref: string): boolean {
  if (item.type !== "resource_change") return false;
  const path = (item as { resourcePath?: string }).resourcePath;
  if (typeof path !== "string") return false;
  return path === ref || path.startsWith(`${ref}/`);
}

/** Locate the snapshot entry for `ref` across all scopes. */
function findCollectionEntry(
  session: SessionView,
  ref: string
): CollectionSnapshotEntry | undefined {
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

function wrapItem(
  raw: { topic: string; clientData?: unknown; content?: string },
  client: ResourceClient,
  sessionId: string | undefined,
  ref: string
): CollectionItemHandle {
  return {
    topic: raw.topic,
    clientData: raw.clientData,
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

export function useResourceCollection(
  session: SessionView,
  ref: string
): UseResourceCollectionResult {
  const context = useFlowContext();
  const baseUrl = context.baseUrl;

  // FIX-427: hoist the client into a single useMemo. The previous hook
  // instantiated `createResourceClient` twice per render.
  const client = useMemo(
    () => createResourceClient({ baseUrl }),
    [baseUrl]
  );

  // Per-instance page cache keyed by normalized query. Held in a ref so
  // it survives re-renders without participating in render diffing.
  const cacheRef = useRef<Map<string, CachedPage>>(new Map());
  const epochRef = useRef<Map<string, number>>(new Map());
  // Bumped to force subscribers (the convenience hooks) to re-evaluate.
  const [invalidationToken, setInvalidationToken] = useState(0);

  const invalidate = useCallback(() => {
    cacheRef.current.clear();
    setInvalidationToken((t) => t + 1);
  }, []);

  // Watch the session items stream for resource_change events touching this
  // collection. The current pattern in useSession batches a snapshot refresh
  // at request completion; here we invalidate per-ref immediately so an
  // active list page reflects creates/updates/deletes without waiting for
  // the next snapshot.
  const lastSeenItemsLenRef = useRef(0);
  useEffect(() => {
    const items = session.items;
    const start = lastSeenItemsLenRef.current;
    lastSeenItemsLenRef.current = items.length;
    for (let i = start; i < items.length; i++) {
      if (affectsCollection(items[i]!, ref)) {
        invalidate();
        break;
      }
    }
  }, [session.items, ref, invalidate]);

  const list = useCallback(
    async (options?: CollectionListOptions): Promise<CollectionListPage> => {
      const sessionId = session.sessionId;
      if (!sessionId) {
        return {
          items: [],
          pagination: { offset: 0, limit: 0, total: 0, hasMore: false, nextOffset: 0 }
        };
      }
      const key = cacheKey(options);
      const cached = cacheRef.current.get(key);
      if (cached !== undefined) return cached.page;

      // Tag the in-flight request with a per-key epoch. If a SSE invalidation
      // races a list response, only the latest epoch wins on write-back.
      const nextEpoch = (epochRef.current.get(key) ?? 0) + 1;
      epochRef.current.set(key, nextEpoch);

      const page = await client.listCollectionItems(sessionId, ref, options);
      if (epochRef.current.get(key) === nextEpoch) {
        cacheRef.current.set(key, { page, epoch: nextEpoch });
      }
      return page;
    },
    [client, ref, session.sessionId]
  );

  const get = useCallback(
    async (topic: string): Promise<CollectionItemState | null> => {
      const sessionId = session.sessionId;
      if (!sessionId) return null;
      return client.getCollectionItemState(sessionId, ref, topic);
    },
    [client, ref, session.sessionId]
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

  const collectionEntry = useMemo(
    () => findCollectionEntry(session, ref),
    [session.snapshot?.resources, ref]
  );

  const prefetched = useMemo<CollectionItemHandle[] | undefined>(() => {
    const raw = collectionEntry?.prefetched as CollectionSnapshotPrefetchedItem[] | undefined;
    if (raw === undefined) return undefined;
    return raw.map((item) => wrapItem(item, client, session.sessionId, ref));
  }, [collectionEntry, client, session.sessionId, ref]);

  return {
    list,
    get,
    query,
    actions,
    refetch: invalidate,
    prefetched,
    count: collectionEntry?.count,
    // Touch token so React keeps stable identity per invalidation cycle.
    ...(invalidationToken === Number.MIN_SAFE_INTEGER ? { __t: invalidationToken } : {})
  } as UseResourceCollectionResult;
}
