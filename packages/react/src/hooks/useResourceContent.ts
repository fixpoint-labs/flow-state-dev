/**
 * Convenience hook that fetches resource content immediately and exposes loading state.
 *
 * Combines useResource's `fetchContent()` with automatic invocation on mount and
 * session/ref changes. Useful when content is always needed right away.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useResource } from "./useResource";
import type { SessionView } from "./useSession";

/**
 * Return type for useResourceContent — content fetched eagerly.
 */
export type UseResourceContentResult = {
  /** Client data derived from the resource's state. */
  clientData: unknown;
  /** The rendered content string, or null if not yet loaded or unavailable. */
  content: string | null;
  /** True while the content fetch is in progress. */
  isLoading: boolean;
  /** Re-fetch the content. */
  refetch: () => void;
};

/**
 * Reads a single resource's clientData and immediately fetches its content.
 * Content is refetched when the session snapshot changes.
 */
export function useResourceContent(
  session: SessionView,
  ref: string
): UseResourceContentResult {
  const { clientData, fetchContent } = useResource(session, ref);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(() => {
    const id = ++fetchIdRef.current;
    setIsLoading(true);
    fetchContent()
      .then((result) => {
        // Only update if this is still the latest fetch
        if (fetchIdRef.current === id) {
          setContent(result);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (fetchIdRef.current === id) {
          setContent(null);
          setIsLoading(false);
        }
      });
  }, [fetchContent]);

  // Auto-fetch content on mount and when dependencies change
  useEffect(() => {
    if (!session.sessionId) return;
    doFetch();
  }, [session.sessionId, ref, doFetch]);

  return { clientData, content, isLoading, refetch: doFetch };
}
