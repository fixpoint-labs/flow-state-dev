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
import { useCallback, useEffect, useState } from "react";
import type { SessionClient, WorkstreamSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { useReadFence } from "./use-read-fence";

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
 * The largest `offset` the route accepts; past it the request is a 400.
 *
 * Reached only when duplicates have pushed the read position far beyond the
 * rows actually kept, which also makes it the walk's termination guarantee.
 */
const MAX_WORKSTREAM_OFFSET = 10_000;

/**
 * Read every page the server will give us for one session.
 *
 * `limit` is deliberately NOT sent: a host may configure `maxWorkstreamListLimit`
 * below any page size we'd pick, and the route REJECTS an out-of-range limit
 * with a 400 rather than clamping it. Omitting it takes the server's own
 * default, whatever the deployment set, and the walk advances by what actually
 * arrived.
 *
 * ## The read position is not the row count
 *
 * The listing is ordered `created_at DESC` — newest first — and it is a live
 * table, not a snapshot. A Workstream that spawns between two page requests
 * lands at the FRONT and shifts every later offset boundary by one, so a walk
 * that advances by the rows it has KEPT re-reads whatever straddled the
 * boundary. That shows up as a duplicate row and an inflated count.
 *
 * The route exposes only `limit`/`offset` — there is no cursor or snapshot to
 * ask for — so the two are tracked separately: the read position advances by
 * what each page actually contained, and identity is enforced on the way in.
 * The dedupe is not belt-and-braces; it is the thing that makes the count
 * truthful, because the shifted page really does hand back a row we hold.
 *
 * A row inserted ahead of the walk is missed rather than duplicated. An offset
 * listing cannot see behind itself, and the next refresh picks it up — under-
 * reporting one brand-new row for one read beats showing the same session twice.
 *
 * ## `truncated` has to be right in both directions
 *
 * Reporting less than exists is the defect this paging fixed; reporting more
 * than exists is the same defect pointing the other way, and on a debugging
 * surface it sends someone looking for background work that is not there. So
 * reaching the bound is not by itself evidence of a remainder — a final page
 * can land exactly on it — and the only thing that settles it is asking whether
 * a row follows, at the READ POSITION rather than at the row count.
 *
 * An ABANDONED walk answers neither. It returns `undefined` rather than a page,
 * because it read fewer rows than exist and has no honest value for either
 * field: `truncated: true` would tell the user their list is capped when it was
 * merely dropped, and `truncated: false` would present a partial list as whole.
 * A distinct return makes that unrepresentable instead of merely discouraged.
 *
 * ## Stopping is a different question from discarding
 *
 * The caller's fence decides whether a result may be WRITTEN. It cannot decide
 * whether the work should CONTINUE, and asking it once at the end is how a
 * retired walk went on issuing pages — up to twenty on a busy session, and up
 * to five hundred under a host configured with `maxWorkstreamListLimit: 1`,
 * each dragging a per-row status lookup behind it, all of it thrown away on
 * arrival. `stillWanted` is threaded in rather than read off the hook's refs so
 * this stays a function of its arguments.
 */
async function fetchAllWorkstreams(
  sessionClient: SessionClient,
  sessionId: string,
  stillWanted: () => boolean
): Promise<{ rows: WorkstreamSummary[]; truncated: boolean } | undefined> {
  const rows: WorkstreamSummary[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (rows.length < MAX_WORKSTREAM_ROWS && offset < MAX_WORKSTREAM_OFFSET) {
    // Checked before each SUBSEQUENT page, never before the first: a walk that
    // gives up before reading anything leaves the panel with no completed read
    // at all, which is a worse answer than a superseded one.
    if (offset > 0 && !stillWanted()) return undefined;
    const page = await sessionClient.listWorkstreams(sessionId, { offset });
    // An empty page is the end of the list. It is also the terminating case if
    // the client's parent-mismatch filter ever drops a whole page — that is a
    // server bug the client already warns about, and stopping short beats
    // re-reading the same offset forever.
    if (page.length === 0) return { rows, truncated: false };
    offset += page.length;
    for (const workstream of page) {
      if (seen.has(workstream.id)) continue;
      seen.add(workstream.id);
      rows.push(workstream);
    }
  }

  // Overshot the bound, because the server's page size need not divide it. The
  // rows past the cap are proof of a remainder, so no probe is needed.
  if (rows.length > MAX_WORKSTREAM_ROWS) {
    return { rows: rows.slice(0, MAX_WORKSTREAM_ROWS), truncated: true };
  }

  // Stopped on the offset ceiling rather than on the end of the list, so what
  // follows is unread by construction.
  if (offset >= MAX_WORKSTREAM_OFFSET) return { rows, truncated: true };

  // Landed exactly on the row bound. One probe for a sentinel distinguishes
  // "the list is this long" from "the list is longer" — the only case where the
  // loop's exit condition alone is wrong. It reads from the position the walk
  // actually reached, which duplicates may have pushed past the row count.
  //
  // The probe is a subsequent page like any other, so it is gated too.
  if (!stillWanted()) return undefined;
  const beyond = await sessionClient.listWorkstreams(sessionId, { offset });
  return { rows, truncated: beyond.length > 0 };
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

  // Guarded twice, per the contract in
  // `docs/architecture/server-and-client.md` ("Reads are guarded twice") —
  // identity retires a response belonging to a superseded read, sequence orders
  // reads within one identity. Both live in `useReadFence`, which carries the
  // reasoning for why identity is compared by value rather than through a
  // mutable cell; this hook and `use-session-requests` had drifted into two
  // different wrong answers to the same question.
  const fence = useReadFence([sessionId, sessionClient]);

  // Declared BEFORE the fetch effect so it runs first on the same commit: the
  // previous session's rows are dropped before the new session's read starts.
  //
  // `isLoading` is reset here for the same reason, and here rather than on the
  // no-session path: retiring an identity retires its spinner, whichever way
  // the identity changed. A read still in flight will decline to clear the flag
  // once its identity is stale — correctly, it no longer owns it — so if this
  // did not, a `true` left by the old identity would have no owner at all.
  // Ordering makes it safe for an ordinary session switch: this effect and the
  // fetch effect run in the same commit, this one first, and `refresh` sets the
  // flag back to `true` synchronously before its first `await`, so the pair
  // batches into one render — `true` for a real session, `false` for none.
  useEffect(() => {
    setWorkstreams([]);
    setError(null);
    setTruncated(false);
    setIsLoading(false);
  }, [sessionId, sessionClient]);

  const refresh = useCallback(async () => {
    // `null` means this callback was built for a session since left — an
    // approval resolving against a workspace the operator has moved on from.
    // There is no read to make.
    //
    // Both the success and failure paths share `stillCurrent`, because the
    // asymmetry was a bug: an older read that rejects while a newer one is in
    // flight would otherwise set `error`, and the newer success would write
    // rows without clearing it — a stale failure banner over fresh data.
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;

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
      const page = await fetchAllWorkstreams(sessionClient, sessionId, stillCurrent);
      // `undefined` is a walk that stopped because it was retired, not a page.
      // It holds a partial list and no meaningful `truncated`, so there is
      // nothing here to write — and the fence below would refuse it anyway.
      if (page === undefined) return;
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
  }, [fence, sessionClient, sessionId]);

  // Fetch on mount and whenever the read identity changes. `refresh`'s identity
  // is stable for a given session id and client.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { workstreams, isLoading, error, truncated, refresh };
}
