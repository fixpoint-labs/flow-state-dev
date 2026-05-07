/**
 * Convenience hook around `useResourceCollection.list()` (FIX-427).
 *
 * Manages the React state lifecycle for a paginated list view: loading,
 * error, accumulated pages via `loadMore`, and refetching on mutations.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createResourceClient,
  type CollectionItemHandle,
  type CollectionListPage
} from "@flow-state-dev/client";
import {
  useResourceCollection,
  type CollectionListOptions
} from "./useResourceCollection";
import type { SessionView } from "./useSession";
import { useFlowContext } from "../context/FlowContext";

export type UseResourceCollectionListResult = {
  /** Items accumulated across `loadMore` calls. */
  items: CollectionItemHandle[];
  /** Pagination metadata for the latest page. */
  pagination: CollectionListPage["pagination"] | undefined;
  isLoading: boolean;
  error: Error | undefined;
  /** Re-fetch the first page from scratch. */
  refetch: () => void;
  /** Append the next page; no-op if `pagination.hasMore` is false. */
  loadMore: () => void;
};

export function useResourceCollectionList(
  session: SessionView,
  ref: string,
  options: { limit?: number; topicPrefix?: string } = {}
): UseResourceCollectionListResult {
  const { list, prefetched, count } = useResourceCollection(session, ref);
  const { baseUrl } = useFlowContext();
  const client = useMemo(() => createResourceClient({ baseUrl }), [baseUrl]);
  const limit = options.limit;
  const topicPrefix = options.topicPrefix;

  const [items, setItems] = useState<CollectionItemHandle[]>([]);
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
        // The hook's list() returns raw `{ topic, clientData? }`. Wrap each
        // item in a CollectionItemHandle with fetchContent() — the prefetched
        // window already exposes handles, so we mirror that ergonomic. We
        // reuse the same client-construction path via a one-shot list of an
        // empty key to read off the prefetched-style closure; in practice
        // we just re-call useResourceCollection's plumbing below.
        const handles: CollectionItemHandle[] = page.items.map((it) => ({
          topic: it.topic,
          clientData: it.clientData,
          fetchContent: async () => {
            const sessionId = session.sessionId;
            if (!sessionId) return null;
            const result = await client.getCollectionItemContent(sessionId, ref, it.topic);
            return result.content;
          },
        }));
        setPagination(page.pagination);
        setItems((prev) => (replace ? handles : [...prev, ...handles]));
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    },
    [list, client, limit, topicPrefix, session.sessionId, ref]
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

  // If a snapshot prefetched window exists and we have no fetched data yet,
  // surface it as the initial paint. Lets consumers render immediately
  // when `prefetchWindow > 0` without waiting on the network.
  const surfaced =
    items.length === 0 && prefetched !== undefined && !isLoading
      ? prefetched
      : items;
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
