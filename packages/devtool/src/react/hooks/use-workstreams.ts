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
 * ## What it reads
 *
 * One page — the newest background work, since the listing is ordered
 * `created_at DESC` — plus a sentinel read when that page comes back full, so
 * the panel can say whether there is more without walking the whole history.
 * See `fetchWorkstreamPage` for why the budget is one read per turn.
 */
import { useCallback, useEffect, useState } from "react";
import type { SessionClient, WorkstreamSummary } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { useReadFence } from "./use-read-fence";

/** Stable empty list, so a stale hold does not hand back a new array each render. */
const EMPTY_ROWS: WorkstreamSummary[] = [];

/**
 * Read the Workstream axis for one session.
 *
 * ## One page, not the whole history
 *
 * `docs/architecture/server-and-client.md` fixes the budget for this axis:
 * "The cost is one Workstream read per turn, independent of task-board
 * activity." That is a contract, not a tuning preference — it is what makes an
 * axis read on every interaction affordable — and `useSession` in
 * `@flow-state-dev/react` honours it with a single `listWorkstreams` call.
 *
 * The listing is ordered `created_at DESC`, so that one page IS the newest
 * background work. An earlier version of this hook walked every page to the
 * end, on a premise that turned out to be false: it claimed a single read
 * showed the OLDEST page and hid the newest. The opposite is true, and paging
 * bought completeness at a cost that grew with board activity — precisely what
 * the budget above forbids.
 *
 * ## What it costs to still tell the truth about `truncated`
 *
 * A single read cannot distinguish "this is the whole list" from "this is the
 * first page of a longer one", and `truncated` has to be right in BOTH
 * directions: claiming a cap that is not there sends someone looking for work
 * that does not exist, and hiding one presents a partial list as whole.
 *
 * So a non-empty page is followed by ONE sentinel read for the row after it.
 * The cost is one request for a session with no background work and two for any
 * other — a constant either way, which is the property the budget is actually
 * protecting. It cannot be one in the common case: the page size belongs to the
 * deployment, so this side cannot tell a short page from a full one and has to
 * ask. A row spawning between the two reads shifts the boundary, and the answer
 * stays correct — the list really did just get longer.
 *
 * `stillWanted` gates the sentinel because it is a second request, and a read
 * whose result may not be written is a read worth not making. `undefined` means
 * the read was abandoned rather than completed — it has no honest `truncated`
 * to report, so it returns no page at all rather than a misleading one.
 */
async function fetchWorkstreamPage(
  sessionClient: SessionClient,
  sessionId: string,
  stillWanted: () => boolean
): Promise<{ rows: WorkstreamSummary[]; truncated: boolean } | undefined> {
  // No `limit`: a host may configure `maxWorkstreamListLimit` below any page
  // size this side would pick, and the route REJECTS an out-of-range limit with
  // a 400 rather than clamping it. Omitting it takes the deployment's own
  // default.
  const rows = await sessionClient.listWorkstreams(sessionId);
  if (rows.length === 0) return { rows, truncated: false };

  if (!stillWanted()) return undefined;
  const beyond = await sessionClient.listWorkstreams(sessionId, {
    offset: rows.length,
  });
  return { rows, truncated: beyond.length > 0 };
}

export type UseWorkstreamsResult = {
  workstreams: WorkstreamSummary[];
  isLoading: boolean;
  error: string | null;
  /**
   * More background work exists than this page shows. The panel renders it;
   * it is never silently swallowed.
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
  //
  // The reset rides the same identity, so the two cannot disagree about what
  // "the identity changed" means. `isLoading` is cleared here rather than on the
  // no-session path: retiring an identity retires its spinner, whichever way the
  // identity changed. A read still in flight will decline to clear the flag once
  // its identity is stale — correctly, it no longer owns it — so if this did
  // not, a `true` left by the old identity would have no owner at all. Safe for
  // an ordinary switch because this clear and `refresh`'s synchronous `true`
  // land in one commit and batch: `true` for a real session, `false` for none.
  // The identity the state below was read under, written with it in the same
  // batch. Everything this hook RETURNS is derived from it during render.
  //
  // Making the check render-synchronous was not enough on its own: the check
  // knew the identity was stale, but the rows a consumer reads were still the
  // old ones until an effect cleared them. Live mode selects its subscription
  // out of those rows DURING that render, so the previous session's stream
  // opened under the new workspace — the same render-versus-effect trap the
  // fence exists to remove, one layer out.
  //
  // The reset below is now bookkeeping: it drops the retired data so nothing
  // holds it, and correctness no longer waits on it.
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
  const fence = useReadFence([sessionId, sessionClient], () => {
    setWorkstreams([]);
    setError(null);
    setTruncated(false);
    setIsLoading(false);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

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
    const mine: readonly unknown[] = [sessionId, sessionClient];

    if (!sessionId) {
      if (!stillCurrent()) return;
      setWorkstreams([]);
      setError(null);
      setTruncated(false);
      setHeldIdentity(mine);
      return;
    }

    setIsLoading(true);
    setError(null);
    setHeldIdentity(mine);
    try {
      const page = await fetchWorkstreamPage(sessionClient, sessionId, stillCurrent);
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

  // Derived, never returned raw. A hold from a replaced identity reads as "no
  // data yet for this one", which is what it is — and `isLoading` says so, so
  // nothing renders an empty list as "there is no background work".
  return {
    workstreams: holdsCurrent ? workstreams : EMPTY_ROWS,
    isLoading: holdsCurrent ? isLoading : sessionId !== null,
    error: holdsCurrent ? error : null,
    truncated: holdsCurrent ? truncated : false,
    refresh,
  };
}
