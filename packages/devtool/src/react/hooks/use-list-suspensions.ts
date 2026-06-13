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
 */
import { useCallback, useEffect, useState } from "react";
import type {
  DebugSuspensionsResponse,
  SuspensionRecord,
  SuspensionStatus
} from "@flow-state-dev/client";
import { ClientHttpError } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export type UseListSuspensionsResult = {
  suspensions: SuspensionRecord[];
  isLoading: boolean;
  error: string | null;
  disabled: boolean;
  refresh: () => Promise<void>;
};

const DISABLED_REASONS = new Set([
  "debug_endpoints_disabled",
  "debug_endpoints_origin_rejected"
]);

/**
 * True only when the response body's `error` field matches a documented
 * debug-disabled reason. Mirrors `use-debug-resources` so both surfaces treat
 * the gate identically.
 */
function isDebugDisabledError(err: unknown): boolean {
  if (!(err instanceof ClientHttpError)) return false;
  if (err.status !== 403) return false;
  const body = err.body;
  if (body === null || typeof body !== "object" || !("error" in body)) {
    return false;
  }
  const reason = (body as { error?: unknown }).error;
  return typeof reason === "string" && DISABLED_REASONS.has(reason);
}

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
        setError(
          err instanceof Error ? err.message : "Failed to fetch suspensions"
        );
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
