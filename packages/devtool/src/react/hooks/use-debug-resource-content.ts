/**
 * Lazily fetches the content blob for a single resource or one item of a
 * collection on the debug surface.
 *
 * Dormant until the consumer calls `fetch`. `topic === null` selects the
 * single-resource path; a string topic selects the collection-item path.
 *
 * Fenced on the workspace as well as on `(sessionId, ref, topic)`. Content is
 * the one read here an operator copies out or downloads, so presenting the copy
 * they were looking at a moment ago is the worst version of this bug — the
 * resource ref is per-instance under isolation, and a body arriving after the
 * switch says nothing about who it belongs to.
 */
import { useCallback, useState } from "react";
import { useDevTool } from "../context/devtool-context";
import { describeReadError } from "../lib/instance-ownership";
import { useWorkspaceFence } from "./use-workspace-fence";

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
  const { sessionClient, workspaceToken } = useDevTool();
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useWorkspaceFence([sessionId, ref, topic], () => {
    setContent(null);
    setError(null);
    setIsLoading(false);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const fetch = useCallback(async () => {
    if (!sessionId || !ref) return;
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    setIsLoading(true);
    setError(null);
    setHeldIdentity([workspaceToken, sessionClient, sessionId, ref, topic]);
    try {
      const body =
        topic === null
          ? await sessionClient.debug.fetchResourceContent(sessionId, ref)
          : await sessionClient.debug.fetchCollectionItemContent(sessionId, ref, topic);
      if (!stillCurrent()) return;
      setContent(body);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describeReadError(err, "Failed to fetch content"));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, workspaceToken, sessionClient, sessionId, ref, topic]);

  return {
    content: holdsCurrent ? content : null,
    isLoading: holdsCurrent ? isLoading : false,
    error: holdsCurrent ? error : null,
    fetch,
  };
}
