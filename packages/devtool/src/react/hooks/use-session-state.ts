/**
 * The open session's state snapshot and its session record — the two reads the
 * detail sidebar renders.
 *
 * Fenced on the workspace, and derived from the fence during render rather than
 * cleared in an effect. The detail panel is where isolated per-instance state
 * shows up, so a snapshot outliving its workspace is the most direct way for one
 * copy's data to be presented as another's.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionDetail, SessionStateSnapshotResponse } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { describeReadError } from "../lib/instance-ownership";
import { useWorkspaceFence } from "./use-workspace-fence";

export function useSessionState(sessionId: string | null) {
  const { sessionClient, workspaceToken } = useDevTool();
  const [snapshot, setSnapshot] = useState<SessionStateSnapshotResponse | null>(null);
  const [prevSnapshot, setPrevSnapshot] = useState<SessionStateSnapshotResponse | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const isFirstFetch = useRef(true);

  // The identity this data was read under, held with it. Everything returned is
  // derived from it during render — an effect-only reset leaves a window where
  // the previous workspace's state is still what the sidebar reads.
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useWorkspaceFence([sessionId], () => {
    setSnapshot(null);
    setPrevSnapshot(null);
    setDetail(null);
    setError(null);
    setIsLoading(false);
    setLastFetchedAt(null);
    setHeldIdentity(null);
    isFirstFetch.current = true;
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const refresh = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    const mine: readonly unknown[] = [workspaceToken, sessionClient, sessionId];
    if (!sessionId) {
      setSnapshot(null);
      setPrevSnapshot(null);
      setDetail(null);
      setHeldIdentity(mine);
      isFirstFetch.current = true;
      return;
    }
    setIsLoading(true);
    setError(null);
    setHeldIdentity(mine);
    try {
      const [result, sessionDetail] = await Promise.all([
        sessionClient.getSessionState(sessionId),
        sessionClient.getSession(sessionId)
      ]);
      if (!stillCurrent()) return;
      setSnapshot((current) => {
        // Don't track diff on initial load — only on refreshes.
        if (!isFirstFetch.current && current) {
          setPrevSnapshot(current);
        }
        isFirstFetch.current = false;
        return result;
      });
      setDetail(sessionDetail);
      setLastFetchedAt(Date.now());
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describeReadError(err, "Failed to fetch state"));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, workspaceToken, sessionClient, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    snapshot: holdsCurrent ? snapshot : null,
    prevSnapshot: holdsCurrent ? prevSnapshot : null,
    detail: holdsCurrent ? detail : null,
    isLoading: holdsCurrent ? isLoading : sessionId !== null,
    error: holdsCurrent ? error : null,
    lastFetchedAt: holdsCurrent ? lastFetchedAt : null,
    refresh,
  };
}
