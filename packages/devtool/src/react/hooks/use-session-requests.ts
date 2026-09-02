import { useCallback, useEffect, useState } from "react";
import type { SessionRequestSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { useReadFence } from "./use-read-fence";

/** Stable empty list, so a stale hold does not hand back a new array each render. */
const EMPTY_REQUESTS: SessionRequestSummary[] = [];

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
  // into a child session while the conversation that started it is still
  // running.
  //
  // Shared with `use-child-sessions` rather than restated: this hook previously
  // ASSIGNED its own ref inside the read, so a callback the panel handed to a
  // view that has since unmounted rewrote the guard for every reader.
  // The identity these rows were read under, stamped with them. What this hook
  // RETURNS is derived from it during render, because live mode picks its
  // subscription target out of `requests` — and a reset that only runs in an
  // effect leaves the previous session's `in_progress` row selectable for the
  // whole of the switching render.
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useReadFence([sessionId, sessionClient], () => {
    setRequests([]);
    setError(null);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const refresh = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    const mine: readonly unknown[] = [sessionId, sessionClient];
    if (!sessionId) {
      setRequests([]);
      setHeldIdentity(mine);
      return;
    }
    setIsLoading(true);
    setError(null);
    setHeldIdentity(mine);
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Derived, never returned raw — see the hold above.
  return {
    requests: holdsCurrent ? requests : EMPTY_REQUESTS,
    isLoading: holdsCurrent ? isLoading : sessionId !== null,
    error: holdsCurrent ? error : null,
    refresh,
  };
}
