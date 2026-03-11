import { useCallback, useEffect, useState } from "react";
import type { SessionStateSnapshotResponse } from "@flow-state-dev/client";
import { useDevTool } from "@/context/devtool-context";

export function useSessionState(sessionId: string | null) {
  const { sessionClient } = useDevTool();
  const [snapshot, setSnapshot] = useState<SessionStateSnapshotResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSnapshot(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await sessionClient.getSessionState(sessionId);
      setSnapshot(result);
      setLastFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch state");
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { snapshot, isLoading, error, lastFetchedAt, refresh };
}
