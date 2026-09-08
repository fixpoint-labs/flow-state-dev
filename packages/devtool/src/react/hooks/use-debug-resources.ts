/**
 * Fetches the privileged debug resource tree for a session.
 *
 * Wraps `sessionClient.debug.listResources`. Surfaces the 403 case as a
 * dedicated `disabled` flag so the panel can render an explanatory notice
 * instead of an error: the server-side debug gate
 * (`debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS=1`) and the origin allow
 * list both reject with 403 and a typed body payload.
 *
 * Fenced on the workspace: a resource tree belongs to one instance's session,
 * and per-instance isolation means a tree that outlives its workspace is another
 * copy's data shown under the selected one.
 */
import { useCallback, useEffect, useState } from "react";
import type { DebugResourcesResponse } from "@flow-state-dev/client";
import { ClientHttpError } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { describeReadError } from "../lib/instance-ownership";
import { useWorkspaceFence } from "./use-workspace-fence";

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
  const { sessionClient, workspaceToken } = useDevTool();
  const [data, setData] = useState<DebugResourcesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  // Held with the data, and everything returned derives from it during render —
  // the disabled and error flags included, since a stale "debug disabled" notice
  // under a new workspace is as wrong as stale rows.
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useWorkspaceFence([sessionId], () => {
    setData(null);
    setError(null);
    setDisabled(false);
    setIsLoading(false);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const refresh = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    const mine: readonly unknown[] = [workspaceToken, sessionClient, sessionId];
    if (!sessionId) {
      setData(null);
      setError(null);
      setDisabled(false);
      setHeldIdentity(mine);
      return;
    }
    setIsLoading(true);
    setError(null);
    setDisabled(false);
    setHeldIdentity(mine);
    try {
      const result = await sessionClient.debug.listResources(sessionId);
      if (!stillCurrent()) return;
      setData(result);
    } catch (err) {
      if (!stillCurrent()) return;
      if (isDebugDisabledError(err)) {
        setDisabled(true);
        setData(null);
      } else {
        setError(describeReadError(err, "Failed to fetch debug resources"));
      }
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, workspaceToken, sessionClient, sessionId]);

  // Fetch on mount and whenever the read identity changes. The refresh
  // callback's identity is stable for a given workspace and session.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data: holdsCurrent ? data : null,
    isLoading: holdsCurrent ? isLoading : sessionId !== null,
    error: holdsCurrent ? error : null,
    refresh,
    disabled: holdsCurrent ? disabled : false,
  };
}
