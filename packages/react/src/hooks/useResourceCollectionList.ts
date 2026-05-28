/**
 * Convenience hook around `useResourceCollection.list()` (FIX-427).
 *
 * Manages the React state lifecycle for a paginated list view: loading,
 * error, accumulated pages via `loadMore`, and refetching on mutations.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  CollectionItemHandle,
  CollectionListPage
} from "@flow-state-dev/client";
import {
  useResourceCollection,
  type CollectionListOptions
} from "./useResourceCollection";
import type { SessionView } from "./useSession";

export type UseResourceCollectionListResult = {
  /** Items accumulated across `loadMore` calls. */
  items: CollectionItemHandle[];
  /** Pagination metadata for the latest page. */
  pagination: CollectionListPage["pagination"] | undefined;
  isLoading: boolean;
  error: Error | undefined;
  /** Re-fetch the first page from scratch. */
  refetch: () => void;
  /** Append the next page; no-op once `pagination.nextCursor` is `null`. */
  loadMore: () => void;
};

export function useResourceCollectionList(
  session: SessionView,
  ref: string,
  options: { limit?: number; topicPrefix?: string } = {}
): UseResourceCollectionListResult {
  const { list, prefetched, count, wrap } = useResourceCollection(session, ref);
  const limit = options.limit;
  const topicPrefix = options.topicPrefix;

  const [items, setItems] = useState<CollectionItemHandle[]>([]);
  const [pagination, setPagination] = useState<CollectionListPage["pagination"] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  // Used to force a refetch when the underlying ref/baseUrl/options change.
  const [generation, setGeneration] = useState(0);

  const fetchPage = useCallback(
    async (cursor: string | null, replace: boolean) => {
      setIsLoading(true);
      setError(undefined);
      try {
        const queryOptions: CollectionListOptions = {};
        if (cursor !== null) queryOptions.cursor = cursor;
        if (limit !== undefined) queryOptions.limit = limit;
        if (topicPrefix !== undefined) queryOptions.topicPrefix = topicPrefix;
        const page = await list(queryOptions);
        // Wrap raw `{ topic, clientData? }` page items as handles using the
        // shared wrap helper from useResourceCollection (one client per
        // hook tree, not one per convenience hook).
        const handles = page.items.map(wrap);
        setPagination(page.pagination);
        setItems((prev) => (replace ? handles : [...prev, ...handles]));
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    },
    [list, wrap, limit, topicPrefix]
  );

  // Initial / re-fetch whenever inputs change. `generation` lets refetch()
  // force re-run without changing query inputs. First page omits the cursor.
  useEffect(() => {
    void fetchPage(null, true);
  }, [fetchPage, generation]);

  const refetch = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  const loadMore = useCallback(() => {
    // No fetched page yet (still showing the prefetched window): start a fresh
    // cursored scan from the top and replace the prefetched snapshot with the
    // real first page. Prefetched items are a display-only snapshot window, not
    // a cursor anchor, so we can't keyset-page from them — re-scanning from the
    // top is the least surprising correct behavior.
    if (pagination === undefined) {
      void fetchPage(null, true);
      return;
    }
    // `nextCursor === null` means the end of pages.
    if (pagination.nextCursor === null) return;
    void fetchPage(pagination.nextCursor, false);
  }, [fetchPage, pagination]);

  // Initial paint: when the snapshot exposes a prefetched window and we
  // haven't yet received a fetched page, surface the prefetched items
  // (including during the in-flight initial load). Once the first page
  // resolves, `items` takes over. This is the whole point of declaring
  // `prefetchWindow` — render immediately, no network round-trip.
  const surfaced =
    items.length === 0 && prefetched !== undefined ? prefetched : items;
  // Synthesize pagination from the snapshot while only prefetched items show.
  // `nextCursor: null` when the prefetched window already covers the whole
  // collection (nothing more to load); otherwise a non-null sentinel so
  // `loadMore` is enabled — its first call re-scans from the top (see above).
  const surfacedPagination =
    pagination ??
    (count !== undefined && prefetched !== undefined
      ? {
          limit: prefetched.length,
          nextCursor: prefetched.length < count ? "" : null
        }
      : undefined);

  return {
    items: surfaced,
    pagination: surfacedPagination,
    isLoading,
    error,
    refetch,
    loadMore
  };
}
