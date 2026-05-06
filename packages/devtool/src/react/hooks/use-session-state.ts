import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionDetail, SessionStateSnapshotResponse } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export function useSessionState(sessionId: string | null) {
  const { sessionClient } = useDevTool();
  const [snapshot, setSnapshot] = useState<SessionStateSnapshotResponse | null>(null);
  const [prevSnapshot, setPrevSnapshot] = useState<SessionStateSnapshotResponse | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const isFirstFetch = useRef(true);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSnapshot(null);
      setPrevSnapshot(null);
      setDetail(null);
      isFirstFetch.current = true;
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [result, sessionDetail] = await Promise.all([
        sessionClient.getSessionState(sessionId, { includeInternal: true, includeInternalState: true }),
        sessionClient.getSession(sessionId)
      ]);
      setSnapshot((current) => {
        // Don't track diff on initial load — only on refreshes.
        if (!isFirstFetch.current && current) {
          setPrevSnapshot(current);
        }
        isFirstFetch.current = false;
        return result;
      });
      setDetail(sessionDetail);
      setLastFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch state");
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, sessionId]);

  useEffect(() => {
    isFirstFetch.current = true;
    void refresh();
  }, [refresh]);

  return { snapshot, prevSnapshot, detail, isLoading, error, lastFetchedAt, refresh };
}
