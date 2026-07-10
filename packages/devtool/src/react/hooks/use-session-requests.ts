import { useCallback, useEffect, useState } from "react";
import type { SessionRequestSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export function useSessionRequests(sessionId: string | null) {
  const { sessionClient, recoveryClient, config, autoRecoverInterrupted } = useDevTool();
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
      // Sweep stale active-request entries before listing, same as the
      // session-list refresh — but ONLY when the host opted in via
      // `autoRecoverInterrupted` (default false). Merely opening/refreshing a
      // session must not mutate a stale `in_progress` row to `interrupted` as
      // a side effect unless the panel explicitly asked for that behavior.
      if (autoRecoverInterrupted && config.userId.trim().length > 0) {
        await recoveryClient
          .checkInterrupted({ userId: config.userId })
          .catch((err) => {
            console.warn("[devtool] checkInterrupted failed", err);
          });
      }
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
  }, [sessionClient, recoveryClient, sessionId, config.userId, autoRecoverInterrupted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { requests, isLoading, error, refresh };
}
