/**
 * Convenience hook for fetching a single collection item by topic (FIX-427).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createResourceClient,
  type CollectionItemHandle
} from "@flow-state-dev/client";
import { useResourceCollection } from "./useResourceCollection";
import type { SessionView } from "./useSession";
import { useFlowContext } from "../context/FlowContext";

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
  const { get } = useResourceCollection(session, ref);
  const { baseUrl } = useFlowContext();
  const client = useMemo(() => createResourceClient({ baseUrl }), [baseUrl]);

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
        if (result === null) {
          setItem(null);
        } else {
          setItem({
            topic: result.topic,
            clientData: result.clientData,
            fetchContent: async () => {
              const sessionId = session.sessionId;
              if (!sessionId) return null;
              const r = await client.getCollectionItemContent(sessionId, ref, result.topic);
              return r.content;
            }
          });
        }
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
  }, [get, client, session.sessionId, ref, topic, generation]);

  const refetch = useCallback(() => setGeneration((g) => g + 1), []);

  return { item, isLoading, error, refetch };
}
