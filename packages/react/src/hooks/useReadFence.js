/**
 * The read fence for any hook whose data belongs to one identity.
 *
 * Every such hook has the same two hazards, and getting either wrong is
 * silent — the component renders, with another identity's data in it:
 *
 * - **A response outliving its identity.** The user switches session or opens a
 *   different flow instance, or the session client is rebuilt on a
 *   `baseUrl`/token change, and a read started under the old one lands
 *   afterwards.
 * - **Two reads of the SAME identity racing.** A mount read, a manual refresh
 *   and a focus revalidation can be in flight together, so an older response
 *   arriving last would overwrite newer rows — regressing a row that has since
 *   completed. Identity alone cannot see this, because both name one identity;
 *   only the sequence number separates them. This is the half an
 *   `openLeafId !== leafId` guard silently misses.
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
 * `useCallback` closes over. It is a tuple rather than a single id because
 * some reads are keyed on more: a session listing on
 * `(sessionClient, address, userId)`, a suspension listing on
 * `(sessionId, status)`.
 *
 * Put the transport in the tuple, not only the subject. A hook keyed on the
 * subject alone agrees with itself when the client underneath it is rebuilt on
 * a `baseUrl` or token change, and leaves the previous backend's rows on
 * screen.
 *
 * A tuple of VALUES can repeat — leaving instance A for B and coming back
 * gives the same address and client again. Where a caller needs a finished
 * visit to be unrepeatable, it adds a token of its own to the tuple; the fence
 * compares whatever it is handed.
 *
 * ```ts
 * const fence = useReadFence([sessionClient, address, userId]);
 * const refresh = useCallback(async () => {
 *   const stillCurrent = fence.begin();
 *   if (stillCurrent === null) return;      // built for an identity since left
 *   const rows = await read();
 *   if (!stillCurrent()) return;            // superseded while in flight
 *   setRows(rows);
 * }, [fence, sessionClient, address, userId]);
 * ```
 */
import { useEffect, useMemo, useRef } from "react";
/** Element-wise, so a fresh array literal of the same values still matches. */
function sameIdentity(a, b) {
    if (a.length !== b.length)
        return false;
    return a.every((value, index) => Object.is(value, b[index]));
}
export function useReadFence(identity, 
/**
 * Drop whatever belonged to the identity just left — rows, errors, spinners.
 *
 * Owned here rather than left to each caller's own effect, because "what is
 * the identity" and "what do I clear when it changes" are the same question
 * and answering it twice is how they diverge: two hooks had already done
 * exactly that, one keyed on `[sessionId, sessionClient]` and the other on
 * `[sessionId]`, so rebuilding the client under an unchanged session left
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
onRetired) {
    // Held in a ref so the effect below can key on the identity alone. A fresh
    // closure every render is expected; putting it in the deps would re-run the
    // reset on every render instead of on every identity change.
    const onRetiredRef = useRef(onRetired);
    onRetiredRef.current = onRetired;
    // Retired with nothing to replace it — the unmount case.
    //
    // Every other kind of staleness this fence models arrives as a SUPERSEDING
    // identity: a new session, a rebuilt client, a different tuple. Unmounting
    // announces none of that, so without a teardown a read in flight keeps seeing
    // its own identity in play and runs to completion for a component that is
    // gone. React cancels nothing; an async walk is a plain promise chain.
    //
    // The cleanup fires on an identity change too, which is harmless and in fact
    // what makes one flag cover both: on a change it is cleared again by the very
    // next run of this effect, and on unmount there is no next run.
    const retiredRef = useRef(false);
    useEffect(() => {
        retiredRef.current = false;
        // Deliberately NOT called from the cleanup below. Retiring on unmount has
        // to stop reads WITHOUT running the reset: there is no component left to
        // clear state on, so it buys nothing, and a caller whose reset ever does
        // more than `setState` would be running it against an identity that no
        // longer exists.
        onRetiredRef.current?.();
        return () => {
            retiredRef.current = true;
        };
    }, 
    // eslint-disable-next-line react-hooks/exhaustive-deps
    identity);
    // The identity in play, mirrored during render so it is current by the time
    // any callback runs — no effect ordering to reason about.
    const currentRef = useRef(identity);
    currentRef.current = identity;
    const seqRef = useRef(0);
    // Memoised on the identity itself, so the fence a callback closes over is the
    // one belonging to the identity that callback was built for. A new object per
    // render would also re-create every caller's `useCallback` every render.
    return useMemo(() => {
        const mine = identity;
        const isCurrent = () => !retiredRef.current && sameIdentity(mine, currentRef.current);
        return {
            identity: mine,
            holds: (candidate) => !retiredRef.current && sameIdentity(candidate, currentRef.current),
            isCurrent,
            // Written as "ask the question, then claim a slot" rather than as two
            // copies of the comparison, so the ordering the doc calls load-bearing
            // is visible in the code and the two cannot drift apart.
            begin: () => {
                if (!isCurrent())
                    return null;
                const seq = ++seqRef.current;
                return () => isCurrent() && seq === seqRef.current;
            },
        };
    }, 
    // eslint-disable-next-line react-hooks/exhaustive-deps
    identity);
}
//# sourceMappingURL=useReadFence.js.map