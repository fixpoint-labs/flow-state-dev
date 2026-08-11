/**
 * Lists the Workstreams hanging off one session (FIX-1071).
 *
 * Wraps `sessionClient.listWorkstreams`, the same client-method idiom the other
 * listing hooks use — transport lives in the client, never here.
 *
 * Deliberately **not** polled. The listing is a read of all-time history whose
 * per-row cost is a request-store lookup, so it refetches on mount, when the
 * session changes, and when something asks it to: the panel's own Refresh
 * button, and the panel-wide focus revalidation. That matches what
 * `useSession`'s `workstreams` does in `@flow-state-dev/react`, so the DevTool
 * shows a developer the same freshness their own app would get rather than a
 * livelier view no product surface has.
 *
 * An empty list is the ordinary answer for a session with no background work,
 * not an error — see the panel for how that is rendered.
 *
 * ## Why this pages, and where it stops
 *
 * The route returns 25 rows when the caller names no `limit`, and orders by
 * creation time. A single unparameterized read therefore shows the OLDEST page
 * and silently omits everything after it — and a panel that renders a count
 * beside a truncated list is claiming the rest does not exist. So this reads
 * until the server runs out, bounded at {@link MAX_WORKSTREAM_ROWS}, and
 * reports `truncated` when it stopped at the bound rather than at the end.
 * The panel says so on screen; a silent cap would be the same lie in a
 * different place.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionClient, WorkstreamSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

/**
 * The most rows this hook will accumulate for one session.
 *
 * A bound rather than an unbounded walk because every row costs the server a
 * request-store lookup, and this list is all-time history that only grows. 500
 * is 20 pages at the route's default page size and stays far inside its
 * `offset` ceiling of 10,000.
 */
export const MAX_WORKSTREAM_ROWS = 500;

/**
 * Read every page the server will give us for one session.
 *
 * `limit` is deliberately NOT sent: a host may configure `maxWorkstreamListLimit`
 * below any page size we'd pick, and the route REJECTS an out-of-range limit
 * with a 400 rather than clamping it. Omitting it takes the server's own
 * default, whatever the deployment set, and the walk advances by what actually
 * arrived.
 */
async function fetchAllWorkstreams(
  sessionClient: SessionClient,
  sessionId: string
): Promise<{ rows: WorkstreamSummary[]; truncated: boolean }> {
  const rows: WorkstreamSummary[] = [];
  while (rows.length < MAX_WORKSTREAM_ROWS) {
    const page = await sessionClient.listWorkstreams(sessionId, {
      offset: rows.length,
    });
    // An empty page is the end of the list. It is also the terminating case if
    // the client's parent-mismatch filter ever drops a whole page — that is a
    // server bug the client already warns about, and stopping short beats
    // re-reading the same offset forever.
    if (page.length === 0) return { rows, truncated: false };
    rows.push(...page);
  }
  return { rows, truncated: true };
}

export type UseWorkstreamsResult = {
  workstreams: WorkstreamSummary[];
  isLoading: boolean;
  error: string | null;
  /**
   * The listing stopped at {@link MAX_WORKSTREAM_ROWS} with more rows still on
   * the server. The panel renders this; it is never silently swallowed.
   */
  truncated: boolean;
  refresh: () => Promise<void>;
};

export function useWorkstreams(sessionId: string | null): UseWorkstreamsResult {
  const { sessionClient } = useDevTool();
  const [workstreams, setWorkstreams] = useState<WorkstreamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // Two guards, because the two hazards are different — the contract in
  // `docs/architecture/server-and-client.md` ("Reads are guarded twice").
  //
  // GENERATION advances whenever the read identity changes: the session id, or
  // the session client, which the context rebuilds when `baseUrl` or the bearer
  // token changes. It retires a response from a superseded identity — a read
  // for the parent conversation landing after the user descended into a
  // Workstream would otherwise relabel the parent's background work as the
  // child's.
  //
  // SEQUENCE orders reads WITHIN one identity. The mount read, a manual
  // Refresh and a focus revalidation share a generation and can be in flight
  // together, so an older response arriving last would overwrite newer rows —
  // regressing a row that has since completed back to active. Session identity
  // alone cannot see that, because both reads name the same session. Only the
  // most recently STARTED read may write, on either outcome.
  const generationRef = useRef(0);
  const seqRef = useRef(0);

  // Declared BEFORE the fetch effect so it runs first on the same commit: the
  // previous session's rows are dropped before the new session's read starts,
  // and the generation bump retires anything still in flight for the old one.
  useEffect(() => {
    generationRef.current += 1;
    setWorkstreams([]);
    setError(null);
    setTruncated(false);
  }, [sessionId, sessionClient]);

  const refresh = useCallback(async () => {
    const generation = generationRef.current;
    const seq = ++seqRef.current;
    // Superseded by a read that has STARTED, not merely by one that has already
    // landed. Fencing on "nothing newer has been applied yet" leaves a hole on
    // the failure path: an older read that rejects while a newer one is still in
    // flight passes that fence, sets `error`, and the newer success then writes
    // rows without clearing it — a stale failure banner sitting over fresh data.
    // Both paths share this fence, because the asymmetry was the bug.
    const stillCurrent = () =>
      generationRef.current === generation && seq === seqRef.current;

    if (!sessionId) {
      if (!stillCurrent()) return;
      setWorkstreams([]);
      setError(null);
      setTruncated(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchAllWorkstreams(sessionClient, sessionId);
      if (!stillCurrent()) return;
      setWorkstreams(page.rows);
      setTruncated(page.truncated);
      // Cleared on the way OUT as well as on the way in. The clear at the start
      // of this read cannot retire an error a slower, older read raises after it.
      setError(null);
    } catch (err) {
      if (!stillCurrent()) return;
      // The rows already on screen are kept: a failed re-read means the list may
      // be stale, and blanking it would claim the session has no background work
      // — which is a different, and wrong, statement.
      setError(
        err instanceof Error ? err.message : "Failed to fetch workstreams"
      );
    } finally {
      // Only the newest read for the current identity owns the spinner, so an
      // older read resolving late cannot clear it while a newer one is running.
      if (stillCurrent()) setIsLoading(false);
    }
  }, [sessionClient, sessionId]);

  // Fetch on mount and whenever the read identity changes. `refresh`'s identity
  // is stable for a given session id and client.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { workstreams, isLoading, error, truncated, refresh };
}
