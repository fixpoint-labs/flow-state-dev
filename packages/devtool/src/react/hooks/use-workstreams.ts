/**
 * Lists the Workstreams hanging off one session (FIX-1071).
 *
 * Wraps `sessionClient.listWorkstreams`, the same client-method idiom the other
 * listing hooks use — transport lives in the client, never here.
 *
 * Deliberately **not** polled. The listing is a read of all-time history whose
 * per-row cost is a request-store lookup, so it refetches on mount, when the
 * session changes, and when something asks it to: the panel's own Refresh
 * button, and the panel-wide focus revalidation. That matches what
 * `useSession`'s `workstreams` does in `@flow-state-dev/react`, so the DevTool
 * shows a developer the same freshness their own app would get rather than a
 * livelier view no product surface has.
 *
 * An empty list is the ordinary answer for a session with no background work,
 * not an error — see the panel for how that is rendered.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkstreamSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export type UseWorkstreamsResult = {
  workstreams: WorkstreamSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useWorkstreams(sessionId: string | null): UseWorkstreamsResult {
  const { sessionClient } = useDevTool();
  const [workstreams, setWorkstreams] = useState<WorkstreamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which session the rows on screen belong to. Descending into a Workstream
  // swaps the panel's session while a read for the previous one may still be in
  // flight, and a late resolve would relabel the parent's background work as the
  // child's — rows the user can then click through to. Compared by value on
  // arrival rather than cancelled, because there is nothing to cancel.
  const requestedRef = useRef<string | null>(sessionId);

  const refresh = useCallback(async () => {
    requestedRef.current = sessionId;
    if (!sessionId) {
      setWorkstreams([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const rows = await sessionClient.listWorkstreams(sessionId);
      if (requestedRef.current !== sessionId) return;
      setWorkstreams(rows);
    } catch (err) {
      if (requestedRef.current !== sessionId) return;
      // The rows already on screen are kept: a failed re-read means the list may
      // be stale, and blanking it would claim the session has no background work
      // — which is a different, and wrong, statement.
      setError(
        err instanceof Error ? err.message : "Failed to fetch workstreams"
      );
    } finally {
      if (requestedRef.current === sessionId) setIsLoading(false);
    }
  }, [sessionClient, sessionId]);

  // Drop the previous session's rows before the new session's read lands, so a
  // slow fetch never shows one conversation's background work under another's
  // id. Runs before the fetch effect below, which shares its dependency.
  useEffect(() => {
    setWorkstreams([]);
    setError(null);
  }, [sessionId]);

  // Fetch on mount and whenever the session id changes. `refresh`'s identity is
  // stable for a given session id.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { workstreams, isLoading, error, refresh };
}
