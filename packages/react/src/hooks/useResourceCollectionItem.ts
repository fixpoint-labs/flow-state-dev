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
import { useResourceCollection } from "./useResourceCollection";
import type { SessionView } from "./useSession";

/**
 * `TClient` (FIX-741) is the collection's projected per-item client-data type;
 * pass it via the hook generic, e.g.
 * `useResourceCollectionItem<ClientDataOf<typeof memos>>(...)`. Defaults to
 * `unknown` so existing untyped call sites are unchanged.
 */
export type UseResourceCollectionItemResult<TClient = unknown> = {
  item: CollectionItemHandle<TClient> | null;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
};

export function useResourceCollectionItem<TClient = unknown>(
  session: SessionView,
  ref: string,
  topic: string
): UseResourceCollectionItemResult<TClient> {
  const { get, wrap, live } = useResourceCollection<TClient>(session, ref);

  const [read, setRead] = useState<{
    identity: typeof wrap;
    item: CollectionItemHandle<TClient> | null;
    error: Error | undefined;
  } | null>(null);
  const holdsCurrent = read !== null && read.identity === wrap;
  const item = holdsCurrent ? read.item : null;
  const error = holdsCurrent ? read.error : undefined;
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [generation, setGeneration] = useState(0);

  // Each run's cleanup cancels the read before it, so the newest read wins.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setRead((prev) => (prev === null || prev.error === undefined ? prev : { ...prev, error: undefined }));
    void (async () => {
      try {
        const result = await get(topic);
        if (cancelled) return;
        setRead({ identity: wrap, item: result === null ? null : wrap(result), error: undefined });
      } catch (err) {
        if (!cancelled) {
          const failure = err instanceof Error ? err : new Error(String(err));
          setRead((prev) =>
            prev !== null && prev.identity === wrap
              ? { ...prev, error: failure }
              : { identity: wrap, item: null, error: failure }
          );
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
  const liveEntry = live?.[topic];

  // Apply the overlay over the fetched baseline so the item reflects mid-stream
  // mutations with no refetch:
  //   - tombstone (`deleted`) → the item is gone now, even if the baseline (or
  //     a slower refetch) still has the last-fetched state. Show `null`.
  //   - present + baseline → merge the live `clientData` over the baseline.
  //   - present + no baseline yet → build a handle from the overlay so a
  //     create/update that arrives before (or instead of) the baseline fetch is
  //     still surfaced. `wrap` provides the lazy `fetchContent`.
  //   - no overlay → the baseline passes through unchanged (non-live path).
  const itemWithLive = useMemo<CollectionItemHandle<TClient> | null>(() => {
    if (liveEntry === undefined) return item;
    if (liveEntry.deleted === true) return null;
    // The overlay carries the same projected shape as the baseline item.
    if (item !== null) return { ...item, clientData: liveEntry.clientData as TClient };
    return wrap({ topic, clientData: liveEntry.clientData });
  }, [item, liveEntry, topic, wrap]);

  return { item: itemWithLive, isLoading: holdsCurrent ? isLoading : true, error, refetch };
}
