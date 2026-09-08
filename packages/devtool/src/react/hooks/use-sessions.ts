import { useCallback, useEffect, useState } from "react";
import type { FlowListEntry, SessionSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { describeReadError } from "../lib/instance-ownership";
import { useReadFence } from "./use-read-fence";

/** Stable empty list, so a stale hold does not hand back a new array each render. */
const EMPTY_SESSIONS: SessionSummary[] = [];

/**
 * Sessions of one flow instance. A collection member's rows are filed under
 * its exact id, so they are listed by `flowId`; a singleton lists by kind,
 * which also finds sessions saved before owners were recorded. `flow.id` is
 * the address every route takes either way.
 *
 * Fenced on the instance rather than on the workspace: this list belongs to a
 * copy, not to the session open inside it, so picking a session must not make
 * it re-read. What it must not do is show one copy's rows under another — two
 * navigator rows of the same kind are exactly the case where a late response
 * lands in the wrong list.
 */
export function useSessions(flow: Pick<FlowListEntry, "id" | "cardinality"> | null) {
  const { sessionClient, recoveryClient, config } = useDevTool();
  const flowId = flow?.id ?? null;
  const cardinality = flow?.cardinality;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useReadFence([sessionClient, flowId, cardinality, config.userId], () => {
    setSessions([]);
    setError(null);
    setIsLoading(false);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const refresh = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    const mine: readonly unknown[] = [sessionClient, flowId, cardinality, config.userId];
    if (!flowId) {
      setSessions([]);
      setHeldIdentity(mine);
      return;
    }
    setIsLoading(true);
    setError(null);
    setHeldIdentity(mine);
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
      if (!stillCurrent()) return;
      setSessions(result);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describeReadError(err, "Failed to fetch sessions"));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, sessionClient, recoveryClient, flowId, cardinality, config.userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSession = useCallback(async (): Promise<string | null> => {
    if (!flowId) return null;
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return null;
    try {
      const detail = await sessionClient.createSession({
        flowKind: flowId,
        userId: config.userId,
      });
      // The operator may have collapsed this row, or opened another copy, while
      // the create was in flight. The session exists — it just isn't this
      // navigator row's to open, and handing its id back would select it under
      // whichever instance is now expanded.
      if (!stillCurrent()) return null;
      await refresh();
      return detail.id;
    } catch (err) {
      if (!stillCurrent()) return null;
      setError(describeReadError(err, "Failed to create session"));
      return null;
    }
  }, [fence, sessionClient, flowId, config.userId, refresh]);

  return {
    sessions: holdsCurrent ? sessions : EMPTY_SESSIONS,
    isLoading: holdsCurrent ? isLoading : flowId !== null,
    error: holdsCurrent ? error : null,
    refresh,
    createSession,
  };
}
