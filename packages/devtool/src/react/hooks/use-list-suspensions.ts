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
import { describeReadError } from "../lib/instance-ownership";
import { useWorkspaceFence } from "./use-workspace-fence";

/** Stable empty list, so a stale hold does not hand back a new array each render. */
const EMPTY_SUSPENSIONS: SuspensionRecord[] = [];

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
  const { sessionClient, workspaceToken } = useDevTool();
  const [suspensions, setSuspensions] = useState<SuspensionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  // A pending suspension carries an approve/reject control, so a row surviving
  // its workspace is not just stale display — it is a resolvable gate offered
  // under the wrong copy.
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useWorkspaceFence([sessionId, status], () => {
    setSuspensions([]);
    setError(null);
    setDisabled(false);
    setIsLoading(false);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const refresh = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    const mine: readonly unknown[] = [workspaceToken, sessionClient, sessionId, status];
    if (!sessionId) {
      setSuspensions([]);
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
      const result: DebugSuspensionsResponse =
        await sessionClient.debug.listSuspensions(sessionId, { status });
      if (!stillCurrent()) return;
      setSuspensions(result.suspensions);
    } catch (err) {
      if (!stillCurrent()) return;
      if (isDebugDisabledError(err)) {
        setDisabled(true);
        setSuspensions([]);
      } else {
        setError(describeReadError(err, "Failed to fetch suspensions"));
      }
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, workspaceToken, sessionClient, sessionId, status]);

  // Fetch on mount and whenever the read identity changes. The refresh
  // callback's identity is stable for a given (workspace, sessionId, status).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    suspensions: holdsCurrent ? suspensions : EMPTY_SUSPENSIONS,
    isLoading: holdsCurrent ? isLoading : sessionId !== null,
    error: holdsCurrent ? error : null,
    disabled: holdsCurrent ? disabled : false,
    refresh,
  };
}
