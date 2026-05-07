/**
 * Convenience hook for fetching a single collection item by topic (FIX-427).
 */
import { useCallback, useEffect, useState } from "react";
import type { CollectionItemHandle } from "@flow-state-dev/client";
import { useResourceCollection } from "./useResourceCollection";
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

  return { item, isLoading, error, refetch };
}
