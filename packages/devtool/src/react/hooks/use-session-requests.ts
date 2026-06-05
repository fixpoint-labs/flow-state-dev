import { useCallback, useEffect, useState } from "react";
import type { SessionRequestSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export function useSessionRequests(sessionId: string | null) {
  const { sessionClient } = useDevTool();
  const [requests, setRequests] = useState<SessionRequestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setRequests([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // Request full item logs so requests that completed before this view
      // opened still render their trace tree (FIX-733).
      const result = await sessionClient.listSessionRequests(sessionId, {
        includeItems: true
      });
      setRequests(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch requests");
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { requests, isLoading, error, refresh };
}
