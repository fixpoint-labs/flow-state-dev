/**
 * Convenience hook around `useResourceCollection.list()` (FIX-427).
 *
 * Manages the React state lifecycle for a paginated list view: loading,
 * error, accumulated pages via `loadMore`, and refetching on mutations.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionItemHandle } from "@flow-state-dev/client";
import {
  useResourceCollection,
  type CollectionListOptions,
  type UseResourceCollectionResult
} from "./useResourceCollection";
import type { SessionView } from "./useSession";
import { useReadFence } from "./useReadFence";

/** One empty list for every render with nothing read, so derived memos hold steady. */
const NO_ITEMS: never[] = [];

/**
 * Apply a `client.live` overlay (FIX-739) over a fetched/prefetched item list:
 * override each item's `clientData` from its live entry, drop tombstoned
 * topics, and append live-created topics not in the fetched window (so a
 * mid-stream create surfaces without a refetch). Appended items land at the end
 * — list order reconciles on the next snapshot refetch. Returns the input
 * reference unchanged when there's no overlay, so non-live collections don't
 * re-render.
 */
export function applyLiveOverlay<TClient = unknown>(
  items: CollectionItemHandle<TClient>[],
  live: UseResourceCollectionResult<TClient>["live"],
  wrap: UseResourceCollectionResult<TClient>["wrap"]
): CollectionItemHandle<TClient>[] {
  if (live === undefined) return items;
  const seen = new Set<string>();
  const out: CollectionItemHandle<TClient>[] = [];
  for (const item of items) {
    seen.add(item.topic);
    const overlay = live[item.topic];
    if (overlay === undefined) {
      out.push(item);
    } else if (overlay.deleted !== true) {
      // The overlay carries the same projected shape as the baseline item.
      out.push({ ...item, clientData: overlay.clientData as TClient });
    }
    // deleted → omitted
  }
  for (const [topic, overlay] of Object.entries(live)) {
    if (seen.has(topic) || overlay.deleted === true) continue;
    out.push(wrap({ topic, clientData: overlay.clientData }));
  }
  return out;
}

/**
 * `TClient` (FIX-741) is the collection's projected per-item client-data type;
 * pass it via the hook generic, e.g.
 * `useResourceCollectionList<ClientDataOf<typeof memos>>(...)`. Defaults to
 * `unknown` so existing untyped call sites are unchanged.
 */
export type UseResourceCollectionListResult<TClient = unknown> = {
  /** Items accumulated across `loadMore` calls. */
  items: CollectionItemHandle<TClient>[];
  /** True when another page can be loaded via `loadMore` (an opaque cursor remains). */
  hasMore: boolean;
  isLoading: boolean;
  error: Error | undefined;
  /** Re-fetch the first page from scratch. */
  refetch: () => void;
  /** Append the next page; no-op when there's nothing more to load. */
  loadMore: () => void;
};

export function useResourceCollectionList<TClient = unknown>(
  session: SessionView,
  ref: string,
  options: { limit?: number; topicPrefix?: string } = {}
): UseResourceCollectionListResult<TClient> {
  const { list, prefetched, count, live, wrap } = useResourceCollection<TClient>(session, ref);
  const limit = options.limit;
  const topicPrefix = options.topicPrefix;

  // `wrap` changes with the client, the session and the ref, not with invalidation.
  const fence = useReadFence([wrap]);

  const [read, setRead] = useState<{
    identity: readonly unknown[];
    items: CollectionItemHandle<TClient>[];
    // Opaque cursor for the NEXT page; `undefined` once the last page is reached.
    nextCursor: string | undefined;
    fetched: boolean;
    error: Error | undefined;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Used to force a refetch when the underlying ref/baseUrl/options change.
  const [generation, setGeneration] = useState(0);

  const holdsCurrent = read !== null && fence.holds(read.identity);
  const items: CollectionItemHandle<TClient>[] = holdsCurrent ? read.items : NO_ITEMS;
  const nextCursor = holdsCurrent ? read.nextCursor : undefined;
  const fetched = holdsCurrent ? read.fetched : false;
  const error = holdsCurrent ? read.error : undefined;

  // The first-page read in flight, if any. Paging waits for it: an append
  // would supersede it and keep the rows it was replacing.
  const replacingRef = useRef<(() => boolean) | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | undefined, replace: boolean) => {
      if (!replace && replacingRef.current?.() === true) return;
      const stillCurrent = fence.begin();
      if (stillCurrent === null) return;
      if (replace) replacingRef.current = stillCurrent;
      const identity = fence.identity;
      setIsLoading(true);
      setRead((prev) => (prev === null || prev.error === undefined ? prev : { ...prev, error: undefined }));
      try {
        const queryOptions: CollectionListOptions = {};
        if (cursor !== undefined) queryOptions.cursor = cursor;
        if (limit !== undefined) queryOptions.limit = limit;
        if (topicPrefix !== undefined) queryOptions.topicPrefix = topicPrefix;
        const page = await list(queryOptions);
        if (!stillCurrent()) return;
        // Wrap raw `{ topic, clientData? }` page items as handles using the
        // shared wrap helper from useResourceCollection (one client per
        // hook tree, not one per convenience hook).
        const handles = page.items.map(wrap);
        setRead((prev) => ({
          identity,
          items: replace || prev === null || prev.identity !== identity ? handles : [...prev.items, ...handles],
          nextCursor: page.nextCursor,
          fetched: true,
          error: undefined
        }));
      } catch (err) {
        if (!stillCurrent()) return;
        const failure = err instanceof Error ? err : new Error(String(err));
        setRead((prev) =>
          prev !== null && prev.identity === identity
            ? { ...prev, error: failure }
            : { identity, items: [], nextCursor: undefined, fetched: false, error: failure }
        );
      } finally {
        if (replacingRef.current === stillCurrent) replacingRef.current = null;
        if (stillCurrent()) setIsLoading(false);
      }
    },
    [fence, list, wrap, limit, topicPrefix]
  );

  // Initial / re-fetch whenever inputs change. `generation` lets refetch()
  // force re-run without changing query inputs.
  useEffect(() => {
    void fetchPage(undefined, true);
  }, [fetchPage, generation]);

  const refetch = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  // Initial paint: when the snapshot exposes a prefetched window and we haven't
  // yet received a fetched page, surface the prefetched items (including during
  // the in-flight initial load). Once the first page resolves, `items` takes
  // over — render immediately, no network round-trip.
  const showingPrefetched = !fetched && items.length === 0 && prefetched !== undefined;
  const baseItems = showingPrefetched ? prefetched : items;
  // Apply the live overlay (FIX-739) over the fetched/prefetched window so a
  // `client.live: true` collection's list reflects mid-stream status changes,
  // deletes, and creates without a refetch. Reactive via `live` (snapshot-derived).
  const surfaced = useMemo(
    () => applyLiveOverlay(baseItems, live, wrap),
    [baseItems, live, wrap]
  );

  // Before the first fetch, `hasMore` is inferred from the prefetched window vs
  // the total count; after, it's driven by the presence of an opaque cursor.
  const hasMore = fetched
    ? nextCursor !== undefined
    : count !== undefined && prefetched !== undefined
      ? prefetched.length < count
      : false;

  const loadMore = useCallback(() => {
    if (nextCursor !== undefined) {
      void fetchPage(nextCursor, false);
      return;
    }
    // Still on the prefetched window (no cursor yet) but more remains: run the
    // first real fetch to establish the paging cursor.
    if (!fetched && hasMore) void fetchPage(undefined, true);
  }, [fetchPage, nextCursor, fetched, hasMore]);

  return {
    items: surfaced,
    hasMore,
    isLoading: holdsCurrent ? isLoading : true,
    error,
    refetch,
    loadMore
  };
}
