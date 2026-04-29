import { useCallback, useEffect, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { useDevTool } from "@/context/devtool-context";

export function useSessions(flowKind: string | null) {
  const { sessionClient, recoveryClient, config } = useDevTool();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!flowKind) {
      setSessions([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // Sweep stale active-request entries before listing so any request
      // whose process died is shown as `interrupted` rather than stuck
      // `in_progress`. Failure here is non-fatal — fall through to the
      // list regardless.
      if (config.userId.trim().length > 0) {
        await recoveryClient
          .checkInterrupted({ userId: config.userId })
          .catch((err) => {
            console.warn("[devtool] checkInterrupted failed", err);
          });
      }
      const result = await sessionClient.listSessions({ flowKind });
      setSessions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sessions");
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, recoveryClient, flowKind, config.userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSession = useCallback(async (): Promise<string | null> => {
    if (!flowKind) return null;
    try {
      const detail = await sessionClient.createSession({
        flowKind,
        userId: config.userId,
      });
      await refresh();
      return detail.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      return null;
    }
  }, [sessionClient, flowKind, config.userId, refresh]);

  return { sessions, isLoading, error, refresh, createSession };
}
