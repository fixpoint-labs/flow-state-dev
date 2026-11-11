/**
 * Convenience hook that fetches a session resource's content immediately and
 * exposes loading state: the resource's client data from the session snapshot,
 * and its rendered content (prefetched in the snapshot, else fetched), on mount
 * and on session/ref changes. Useful when content is always needed right away.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionView } from "./useSession";
import { useClient } from "../internal/useClient";
import { findSnapshotResource } from "../internal/findSnapshotResource";

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
  const resources = useClient().resources;
  const entry = useMemo(
    () => findSnapshotResource(session.snapshot?.resources, ref, "single"),
    [session.snapshot?.resources, ref]
  );
  const clientData = entry?.clientData ?? null;
  const fetchContent = useCallback(async (): Promise<string | null> => {
    const sessionId = session.sessionId;
    if (!sessionId) return null;
    // Content prefetched in the snapshot is returned as it is.
    if (entry?.content !== undefined) return entry.content;
    return (await resources.getResourceContent(sessionId, ref)).content;
  }, [session.sessionId, ref, resources, entry?.content]);
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
