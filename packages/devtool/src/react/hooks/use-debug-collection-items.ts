/**
 * Lazily fetches and paginates a collection's items via the debug surface.
 *
 * The hook is dormant until the consumer calls `loadMore` (typical pattern:
 * fire it the first time the user expands a collection row). Each call
 * appends a page; `topicFilter` changes reset accumulation so the next
 * `loadMore` starts from the beginning.
 *
 * Fenced on the workspace as well as `(sessionId, ref, topicFilter)`. A cursor
 * is the part that has to retire rather than merely stop: a page arriving after
 * a switch would append one instance's items onto another's list AND advance a
 * cursor that no longer describes anything.
 */
import { useCallback, useRef, useState } from "react";
import type { DebugCollectionItem } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { describeReadError } from "../lib/instance-ownership";
import { useWorkspaceFence } from "./use-workspace-fence";

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

/** Stable empty list, so a stale hold does not hand back a new array each render. */
const EMPTY_ITEMS: DebugCollectionItem[] = [];

export function useDebugCollectionItems(
  sessionId: string | null,
  ref: string | null,
  options: UseDebugCollectionItemsOptions = {}
): UseDebugCollectionItemsResult {
  const { sessionClient, workspaceToken } = useDevTool();
  const { topicFilter, pageSize } = options;
  const [items, setItems] = useState<DebugCollectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  // Mirrors items.length synchronously so the cap decision doesn't depend on
  // React's deferred setState batching.
  const accumulatedCountRef = useRef(0);

  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useWorkspaceFence([sessionId, ref, topicFilter], () => {
    cursorRef.current = null;
    accumulatedCountRef.current = 0;
    setItems([]);
    setHasMore(true);
    setError(null);
    setIsLoading(false);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  // Fetch one page using the latest accumulated cursor. Append on success.
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (!sessionId || !ref) return;
      const stillCurrent = fence.begin();
      if (stillCurrent === null) return;
      setIsLoading(true);
      setError(null);
      setHeldIdentity([workspaceToken, sessionClient, sessionId, ref, topicFilter]);
      try {
        const result = await sessionClient.debug.listCollectionItems(sessionId, ref, {
          cursor,
          limit: pageSize,
          topic: topicFilter && topicFilter.length > 0 ? topicFilter : undefined
        });
        // Nothing below this line may run for a retired page: it would both
        // append foreign items and install a cursor into the live walk.
        if (!stillCurrent()) return;
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
        if (!stillCurrent()) return;
        setError(describeReadError(err, "Failed to fetch collection items"));
      } finally {
        if (stillCurrent()) setIsLoading(false);
      }
    },
    [fence, workspaceToken, sessionClient, sessionId, ref, pageSize, topicFilter]
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

  // The reset that used to live in an effect here now rides the fence's
  // `onRetired`, which is keyed on the same identity the reads are — so "what
  // is the identity" and "what do I clear when it changes" cannot drift apart,
  // and the clear happens before this render's consumers read anything.
  //
  // We still don't auto-fetch: consumers gate the first fetch by their own UI
  // signal (e.g. expanding the row).

  return {
    items: holdsCurrent ? items : EMPTY_ITEMS,
    isLoading: holdsCurrent ? isLoading : false,
    error: holdsCurrent ? error : null,
    hasMore: holdsCurrent ? hasMore : true,
    loadMore,
    refresh,
  };
}
