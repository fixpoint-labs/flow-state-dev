/**
 * Fetches the privileged debug resource tree for a session.
 *
 * Wraps `sessionClient.debug.listResources`. Surfaces the 403 case as a
 * dedicated `disabled` flag so the panel can render an explanatory notice
 * instead of an error: the server-side debug gate
 * (`debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS=1`) and the origin allow
 * list both reject with 403 and a typed body payload.
 */
import { useCallback, useEffect, useState } from "react";
import type { DebugResourcesResponse } from "@flow-state-dev/client";
import { ClientHttpError } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export type UseDebugResourcesResult = {
  data: DebugResourcesResponse | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  disabled: boolean;
};

const DISABLED_REASONS = new Set([
  "debug_endpoints_disabled",
  "debug_endpoints_origin_rejected"
]);

/**
 * True only when the response body's `error` field matches one of the
 * documented debug-disabled reasons. Other 403s (session ownership, IP
 * gateways, misconfigured proxies) surface as generic errors so the panel
 * doesn't display a misleading "enable with FSDEV_DEBUG_ENDPOINTS=1" notice
 * when the endpoint is already enabled.
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

export function useDebugResources(
  sessionId: string | null
): UseDebugResourcesResult {
  const { sessionClient } = useDevTool();
  const [data, setData] = useState<DebugResourcesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setData(null);
      setError(null);
      setDisabled(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setDisabled(false);
    try {
      const result = await sessionClient.debug.listResources(sessionId);
      setData(result);
    } catch (err) {
      if (isDebugDisabledError(err)) {
        setDisabled(true);
        setData(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch debug resources");
      }
    } finally {
      setIsLoading(false);
    }
  }, [sessionClient, sessionId]);

  // Fetch on mount and whenever the session id changes. The refresh callback's
  // identity is stable across renders with the same sessionId.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, isLoading, error, refresh, disabled };
}
