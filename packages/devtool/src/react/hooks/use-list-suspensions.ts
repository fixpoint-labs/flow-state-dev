/**
 * Fetches the privileged debug suspensions list for a session (FIX-141).
 *
 * Wraps `sessionClient.debug.listSuspensions`, the same client-method idiom
 * the resource-debug hooks use (transport lives in the client, never here).
 * Surfaces the 403 debug-gate case as a dedicated `disabled` flag so the
 * panel can render an explanatory notice rather than a generic error.
 *
 * An empty list is the natural response when durable execution is not
 * configured (the suspensions store is simply empty), so callers distinguish
 * "no suspensions" from "debug disabled" via `disabled`.
 *
 * Renders inside the workspace-keyed subtree, so a visit that ends unmounts it
 * and a late row has nowhere to land — see `use-session-state` for why that
 * makes a second retirement mechanism here the wrong thing to add. Which copy a
 * pending suspension is resolved against does NOT rest on that: it comes from
 * the record's own owner, in `suspensions-view`.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  DebugSuspensionsResponse,
  SuspensionRecord,
  SuspensionStatus
} from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { isDebugDisabledError } from "../lib/debug-errors";
import { describeReadError } from "../lib/instance-ownership";

export type UseListSuspensionsResult = {
  suspensions: SuspensionRecord[];
  isLoading: boolean;
  error: string | null;
  disabled: boolean;
  refresh: () => Promise<void>;
};

/**
 * Lists suspensions for `sessionId`, optionally narrowed to a single
 * `status`. Refetches whenever the session id or status filter changes.
 */
export function useListSuspensions(
  sessionId: string | null,
  status?: SuspensionStatus
): UseListSuspensionsResult {
  const { sessionClient } = useDevTool();
  const [suspensions, setSuspensions] = useState<SuspensionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSuspensions([]);
      setError(null);
      setDisabled(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setDisabled(false);
    try {
      const result: DebugSuspensionsResponse =
        await sessionClient.debug.listSuspensions(sessionId, { status });
      setSuspensions(result.suspensions);
    } catch (err) {
      if (isDebugDisabledError(err)) {
        setDisabled(true);
        setSuspensions([]);
      } else {
        setError(describeReadError(err, "Failed to fetch suspensions"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, sessionId, status]);

  // Fetch on mount and whenever the session id or status filter changes. The
  // refresh callback's identity is stable for a given (sessionId, status).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { suspensions, isLoading, error, disabled, refresh };
}
