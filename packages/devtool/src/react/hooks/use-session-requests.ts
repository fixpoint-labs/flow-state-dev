import { useCallback, useEffect, useState } from "react";
import type { SessionRequestSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { useReadFence } from "./use-read-fence";

export function useSessionRequests(sessionId: string | null) {
  const { sessionClient, recoveryClient, config, autoRecoverInterrupted } = useDevTool();
  const [requests, setRequests] = useState<SessionRequestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which session the rows on screen belong to. Holding the previous session's
  // requests across a switch is not cosmetic: live mode picks its subscription
  // target out of this list, so a stale in-progress row makes the panel attach
  // to a request in the session the user just left and render its items under
  // the new one. Reachable from the navigator, and reliably so when descending
  // into a Workstream while the conversation that started it is still running.
  //
  // Shared with `use-workstreams` rather than restated: this hook previously
  // ASSIGNED its own ref inside the read, so a callback the panel handed to a
  // view that has since unmounted rewrote the guard for every reader.
  const fence = useReadFence([sessionId, sessionClient]);

  const refresh = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
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
      if (!stillCurrent()) return;
      setRequests(result);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(err instanceof Error ? err.message : "Failed to fetch requests");
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [
    fence,
    sessionClient,
    recoveryClient,
    sessionId,
    config.userId,
    autoRecoverInterrupted,
  ]);

  // Drop the previous session's rows before the new session's read lands. Runs
  // before the fetch effect below, which shares its dependency.
  useEffect(() => {
    setRequests([]);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { requests, isLoading, error, refresh };
}
