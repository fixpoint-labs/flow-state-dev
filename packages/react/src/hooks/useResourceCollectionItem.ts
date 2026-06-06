/**
 * Convenience hook for fetching a single collection item by topic (FIX-427).
 *
 * The fetched item is the baseline; when the collection declares
 * `client.live: true`, mid-stream mutations land in the snapshot's per-topic
 * `live` overlay (`mergeResourceChangeIntoSnapshot`). This hook reads that
 * overlay and layers it over the baseline's `clientData`, so a subscribed item
 * reflects a `pending → writing → published` transition without a refetch
 * (FIX-739).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CollectionItemHandle } from "@flow-state-dev/client";
import { findCollectionEntry, useResourceCollection } from "./useResourceCollection";
import type { SessionView } from "./useSession";

export type UseResourceCollectionItemResult = {
  item: CollectionItemHandle | null;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
};

export function useResourceCollectionItem(
  session: SessionView,
  ref: string,
  topic: string
): UseResourceCollectionItemResult {
  const { get, wrap } = useResourceCollection(session, ref);

  const [item, setItem] = useState<CollectionItemHandle | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    void (async () => {
      try {
        const result = await get(topic);
        if (cancelled) return;
        setItem(result === null ? null : wrap(result));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get, wrap, topic, generation]);

  const refetch = useCallback(() => setGeneration((g) => g + 1), []);

  // Live overlay (FIX-739): when a `client.live: true` collection mutates this
  // topic mid-stream, the change lands in the snapshot's per-topic `live` map.
  const liveEntry = useMemo(() => {
    const entry = findCollectionEntry(session, ref);
    return entry?.live?.[topic];
  }, [session.snapshot?.resources, ref, topic]);

  // Apply the overlay over the fetched baseline so the item reflects mid-stream
  // mutations with no refetch:
  //   - tombstone (`deleted`) → the item is gone now, even if the baseline (or
  //     a slower refetch) still has the last-fetched state. Show `null`.
  //   - present + baseline → merge the live `clientData` over the baseline.
  //   - present + no baseline yet → build a handle from the overlay so a
  //     create/update that arrives before (or instead of) the baseline fetch is
  //     still surfaced. `wrap` provides the lazy `fetchContent`.
  //   - no overlay → the baseline passes through unchanged (non-live path).
  const itemWithLive = useMemo<CollectionItemHandle | null>(() => {
    if (liveEntry === undefined) return item;
    if (liveEntry.deleted === true) return null;
    if (item !== null) return { ...item, clientData: liveEntry.clientData };
    return wrap({ topic, clientData: liveEntry.clientData });
  }, [item, liveEntry, topic, wrap]);

  return { item: itemWithLive, isLoading, error, refetch };
}
