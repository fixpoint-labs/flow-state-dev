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

/**
 * `TClient` (FIX-741) is the collection's projected per-item client-data type;
 * pass it via the hook generic, e.g.
 * `useResourceCollectionList<ClientDataOf<typeof memos>>(...)`. Defaults to
 * `unknown` so existing untyped call sites are unchanged.
 */
export type UseResourceCollectionListResult<TClient = unknown> = {
  /** Items accumulated across `loadMore` calls. */
  items: CollectionItemHandle<TClient>[];
  /** Pagination metadata for the latest page. */
  pagination: CollectionListPage["pagination"] | undefined;
  isLoading: boolean;
  error: Error | undefined;
  /** Re-fetch the first page from scratch. */
  refetch: () => void;
  /** Append the next page; no-op if `pagination.hasMore` is false. */
  loadMore: () => void;
};

export function useResourceCollectionList<TClient = unknown>(
  session: SessionView,
  ref: string,
  options: { limit?: number; topicPrefix?: string } = {}
): UseResourceCollectionListResult<TClient> {
  const { list, prefetched, count, wrap } = useResourceCollection<TClient>(session, ref);
  const limit = options.limit;
  const topicPrefix = options.topicPrefix;

  const [items, setItems] = useState<CollectionItemHandle<TClient>[]>([]);
  const [pagination, setPagination] = useState<CollectionListPage["pagination"] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  // Used to force a refetch when the underlying ref/baseUrl/options change.
  const [generation, setGeneration] = useState(0);

  const fetchPage = useCallback(
    async (offset: number, replace: boolean) => {
      setIsLoading(true);
      setError(undefined);
      try {
        const queryOptions: CollectionListOptions = { offset };
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
  // force re-run without changing query inputs.
  useEffect(() => {
    void fetchPage(0, true);
  }, [fetchPage, generation]);

  const refetch = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (!pagination?.hasMore) return;
    void fetchPage(pagination.nextOffset, false);
  }, [fetchPage, pagination]);

  // Initial paint: when the snapshot exposes a prefetched window and we
  // haven't yet received a fetched page, surface the prefetched items
  // (including during the in-flight initial load). Once the first page
  // resolves, `items` takes over. This is the whole point of declaring
  // `prefetchWindow` — render immediately, no network round-trip.
  const surfaced =
    items.length === 0 && prefetched !== undefined ? prefetched : items;
  const surfacedPagination =
    pagination ??
    (count !== undefined && prefetched !== undefined
      ? {
          offset: 0,
          limit: prefetched.length,
          total: count,
          hasMore: prefetched.length < count,
          nextOffset: prefetched.length
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
