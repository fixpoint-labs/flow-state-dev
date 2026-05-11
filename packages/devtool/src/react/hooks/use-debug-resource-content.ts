/**
 * Lazily fetches the content blob for a single resource or one item of a
 * collection on the debug surface.
 *
 * Dormant until the consumer calls `fetch`. `topic === null` selects the
 * single-resource path; a string topic selects the collection-item path.
 */
import { useCallback, useState } from "react";
import { useDevTool } from "../context/devtool-context";

export type UseDebugResourceContentResult = {
  content: string | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
};

export function useDebugResourceContent(
  sessionId: string | null,
  ref: string | null,
  topic: string | null
): UseDebugResourceContentResult {
  const { sessionClient } = useDevTool();
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!sessionId || !ref) return;
    setIsLoading(true);
    setError(null);
    try {
      const body =
        topic === null
          ? await sessionClient.debug.fetchResourceContent(sessionId, ref)
          : await sessionClient.debug.fetchCollectionItemContent(sessionId, ref, topic);
      setContent(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch content");
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, sessionId, ref, topic]);

  return { content, isLoading, error, fetch };
}
