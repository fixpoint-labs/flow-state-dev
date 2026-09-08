/**
 * Fetches the privileged debug resource tree for a session.
 *
 * Wraps `sessionClient.debug.listResources`. Surfaces the 403 case as a
 * dedicated `disabled` flag so the panel can render an explanatory notice
 * instead of an error: the server-side debug gate
 * (`debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS=1`) and the origin allow
 * list both reject with 403 and a typed body payload.
 *
 * Renders inside the workspace-keyed subtree, so a visit that ends unmounts it
 * and a late tree has nowhere to land — see `use-session-state` for why that
 * makes a second retirement mechanism here the wrong thing to add.
 */
import { useCallback, useEffect, useState } from "react";
import type { DebugResourcesResponse } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { isDebugDisabledError } from "../lib/debug-errors";
import { describeReadError } from "../lib/instance-ownership";

export type UseDebugResourcesResult = {
  data: DebugResourcesResponse | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  disabled: boolean;
};

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
        setError(describeReadError(err, "Failed to fetch debug resources"));
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
