/**
 * Lazily fetches and paginates a collection's items via the debug surface.
 *
 * The hook is dormant until the consumer calls `loadMore` (typical pattern:
 * fire it the first time the user expands a collection row). Each call
 * appends a page; `topicFilter` changes reset accumulation so the next
 * `loadMore` starts from the beginning.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugCollectionItem } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export type UseDebugCollectionItemsOptions = {
  topicFilter?: string;
  pageSize?: number;
};

export type UseDebugCollectionItemsResult = {
  items: DebugCollectionItem[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
};

// Hard ceiling on accumulated items per session view. Server pages cap
// individual responses at 500, but unbounded "Load more" clicks would let a
// massive collection grow this array without limit — the panel renders every
// item, so we cap accumulation rather than virtualizing.
const MAX_ACCUMULATED_ITEMS = 5000;

export function useDebugCollectionItems(
  sessionId: string | null,
  ref: string | null,
  options: UseDebugCollectionItemsOptions = {}
): UseDebugCollectionItemsResult {
  const { sessionClient } = useDevTool();
  const { topicFilter, pageSize } = options;
  const [items, setItems] = useState<DebugCollectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  // Mirrors items.length synchronously so the cap decision doesn't depend on
  // React's deferred setState batching.
  const accumulatedCountRef = useRef(0);

  // Fetch one page using the latest accumulated cursor. Append on success.
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (!sessionId || !ref) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await sessionClient.debug.listCollectionItems(sessionId, ref, {
          cursor,
          limit: pageSize,
          topic: topicFilter && topicFilter.length > 0 ? topicFilter : undefined
        });
        const priorCount = cursor === null ? 0 : accumulatedCountRef.current;
        const mergedCount = priorCount + result.items.length;
        const capped = mergedCount >= MAX_ACCUMULATED_ITEMS;
        const nextCount = capped ? MAX_ACCUMULATED_ITEMS : mergedCount;
        accumulatedCountRef.current = nextCount;
        cursorRef.current = capped ? null : result.nextCursor;
        setItems((prev) => {
          const merged = cursor === null ? result.items : [...prev, ...result.items];
          return capped ? merged.slice(0, MAX_ACCUMULATED_ITEMS) : merged;
        });
        setHasMore(!capped && result.nextCursor !== null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch collection items");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionClient, sessionId, ref, pageSize, topicFilter]
  );

  const loadMore = useCallback(async () => {
    await fetchPage(cursorRef.current);
  }, [fetchPage]);

  const refresh = useCallback(async () => {
    cursorRef.current = null;
    accumulatedCountRef.current = 0;
    setItems([]);
    setHasMore(true);
    await fetchPage(null);
  }, [fetchPage]);

  // Reset accumulated state when the filter or target changes. The next
  // `loadMore`/`refresh` call repopulates from the top. We don't auto-fetch;
  // consumers gate the first fetch by their own UI signal (e.g., expanding
  // the row).
  useEffect(() => {
    cursorRef.current = null;
    accumulatedCountRef.current = 0;
    setItems([]);
    setHasMore(true);
    setError(null);
  }, [sessionId, ref, topicFilter]);

  return { items, isLoading, error, hasMore, loadMore, refresh };
}
