import { useCallback, useEffect, useState } from "react";
import type { FlowListEntry, SessionSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

/**
 * Sessions of one flow instance. A collection member's rows are filed under
 * its exact id, so they are listed by `flowId`; a singleton lists by kind,
 * which also finds sessions saved before owners were recorded. `flow.id` is
 * the address every route takes either way.
 */
export function useSessions(flow: Pick<FlowListEntry, "id" | "cardinality"> | null) {
  const { sessionClient, recoveryClient, config } = useDevTool();
  const flowId = flow?.id ?? null;
  const cardinality = flow?.cardinality;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!flowId) {
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
      const result = await sessionClient.listSessions({
        ...(cardinality === "collection" ? { flowId } : { flowKind: flowId }),
        userId: config.userId,
      });
      setSessions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sessions");
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, recoveryClient, flowId, cardinality, config.userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSession = useCallback(async (): Promise<string | null> => {
    if (!flowId) return null;
    try {
      const detail = await sessionClient.createSession({
        flowKind: flowId,
        userId: config.userId,
      });
      await refresh();
      return detail.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      return null;
    }
  }, [sessionClient, flowId, config.userId, refresh]);

  return { sessions, isLoading, error, refresh, createSession };
}
