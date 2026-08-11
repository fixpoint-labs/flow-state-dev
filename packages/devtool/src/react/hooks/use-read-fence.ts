/**
 * The read fence shared by the panel's session-scoped hooks.
 *
 * Every one of them has the same two hazards, and getting either wrong is
 * silent — the panel renders, with another session's data in it:
 *
 * - **A response outliving its identity.** The user switches session, or the
 *   session client is rebuilt on a `baseUrl`/token change, and a read started
 *   under the old one lands afterwards.
 * - **Two reads of the SAME identity racing.** A mount read, a manual refresh
 *   and a focus revalidation can be in flight together, so an older response
 *   arriving last would overwrite newer rows — regressing a row that has since
 *   completed. Identity alone cannot see this, because both name one session.
 *
 * ## Why identity is compared by value
 *
 * The obvious implementation is a mutable cell — a ref holding "the session I
 * am reading for", assigned at the top of the read. Both ways of using one are
 * wrong, and both were live in this codebase:
 *
 * - Assigned inside the read, a callback outliving its session REDEFINES the
 *   shared cell, corrupting the guard for every reader rather than only itself.
 * - Read inside the read (a generation counter bumped in an effect), a stale
 *   callback BORROWS whatever value is current, agrees with itself, and writes.
 *
 * Capturing the counter at creation instead fails differently: `useCallback`
 * recomputes during render while the bump lives in an effect, so a freshly made
 * callback captures the previous value and never matches again.
 *
 * Comparing the identity a closure was BUILT with against the identity in play
 * has none of these timings. Both sides are values, a stale closure necessarily
 * holds a stale one, and nothing is assigned by a reader.
 *
 * ## Use
 *
 * `identity` is the read's own dependency list — the same values its
 * `useCallback` closes over. It is a tuple rather than a session id because
 * some reads are keyed on more: a suspension listing on `(sessionId, status)`,
 * the debug content reads on `(sessionId, ref, topic)`.
 *
 * Used by `use-session-requests` and `use-workstreams`. Five other
 * session-scoped hooks still read without any fence — FIX-1092 tracks
 * extending it to them.
 *
 * ```ts
 * const fence = useReadFence([sessionId, sessionClient]);
 * const refresh = useCallback(async () => {
 *   const stillCurrent = fence.begin();
 *   if (stillCurrent === null) return;      // built for a session since left
 *   const rows = await read();
 *   if (!stillCurrent()) return;            // superseded while in flight
 *   setRows(rows);
 * }, [fence, sessionId, sessionClient]);
 * ```
 */
import { useEffect, useMemo, useRef } from "react";

/** Element-wise, so a fresh array literal of the same values still matches. */
function sameIdentity(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

export type ReadFence = {
  /**
   * Open a read. Returns the predicate for "may this result still be written",
   * or `null` when the caller was built for an identity that is no longer in
   * play — in which case there is no read to make.
   *
   * The staleness check happens BEFORE a sequence number is taken, and that
   * ordering is load-bearing: the sequence is shared across identities, so a
   * stale caller taking one would supersede a legitimate read already in flight
   * for the identity on screen, trading a wrong write for a dropped one.
   */
  begin: () => (() => boolean) | null;
};

export function useReadFence(
  identity: readonly unknown[],
  /**
   * Drop whatever belonged to the identity just left — rows, errors, spinners.
   *
   * Owned here rather than left to each caller's own effect, because "what is
   * the identity" and "what do I clear when it changes" are the same question
   * and answering it twice is how they diverge: these two hooks had already
   * done exactly that, one keyed on `[sessionId, sessionClient]` and the other
   * on `[sessionId]`, so rebuilding the client under an unchanged session left
   * the previous backend's rows on screen.
   *
   * Exposing the identity for callers to key their own effect on would not have
   * closed it — a deps array must be statically sized, so each caller would
   * still be writing a list that has to agree with this one by hand.
   *
   * Runs on mount too (clearing already-empty state, which costs nothing), and
   * before the caller's fetch effect, since `useReadFence` is called above it.
   * That ordering is load-bearing where a caller sets a spinner synchronously:
   * the clear and the new read's set land in one commit and batch.
   */
  onRetired?: () => void
): ReadFence {
  // Held in a ref so the effect below can key on the identity alone. A fresh
  // closure every render is expected; putting it in the deps would re-run the
  // reset on every render instead of on every identity change.
  const onRetiredRef = useRef(onRetired);
  onRetiredRef.current = onRetired;

  useEffect(
    () => {
      onRetiredRef.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    identity
  );

  // The identity in play, mirrored during render so it is current by the time
  // any callback runs — no effect ordering to reason about.
  const currentRef = useRef(identity);
  currentRef.current = identity;
  const seqRef = useRef(0);

  // Memoised on the identity itself, so the fence a callback closes over is the
  // one belonging to the identity that callback was built for. A new object per
  // render would also re-create every caller's `useCallback` every render.
  return useMemo<ReadFence>(
    () => {
      const mine = identity;
      return {
        begin: () => {
          if (!sameIdentity(mine, currentRef.current)) return null;
          const seq = ++seqRef.current;
          return () =>
            sameIdentity(mine, currentRef.current) && seq === seqRef.current;
        },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    identity
  );
}
