export type ReadFence = {
    /**
     * The identity this fence was built for.
     *
     * Stamp held data with THIS, never with a restatement of the same values. A
     * hook that keeps its rows has to record which identity they were read under,
     * and hand-assembling that tuple a second time is a duplicate of the one
     * passed in — one that has to be kept in step by hand, in the exact place
     * where getting it wrong shows another identity's data and nothing fails.
     * Handing back the array removes the second copy rather than documenting it.
     */
    identity: readonly unknown[];
    /**
     * Is `candidate` the identity currently in play?
     *
     * For deriving OUTPUT, not for gating a write. A hook holds the identity its
     * data was read under and asks this during render, so a consumer never sees
     * rows belonging to an identity that has already been replaced — the gap a
     * reset effect leaves open.
     */
    holds: (candidate: readonly unknown[]) => boolean;
    /**
     * Is the identity THIS fence was built for still the one in play?
     *
     * The question on its own, costing nothing. For a caller that has no read to
     * make and only needs to know whether it is speaking for the current identity
     * — a click handler that resumed on the far side of an `await`, say.
     *
     * Separate from `begin` because the sequence number is a scarce, shared
     * thing. A caller that only wants the answer used to have to call `begin`,
     * and taking a sequence number it had no read to use SUPERSEDES whatever read
     * is genuinely in flight, so an unrelated question would discard a good
     * response. `begin` is the door for reads; this is the door for questions.
     *
     * Same comparison as `holds`, but against the identity the caller was BUILT
     * with rather than one it passes in — so it cannot be answered by restating
     * the tuple at the call site, which is the hand-maintained duplicate this
     * whole module exists to remove.
     */
    isCurrent: () => boolean;
    /**
     * Open a read. Returns the predicate for "may this result still be written",
     * or `null` when the caller was built for an identity that is no longer in
     * play — in which case there is no read to make.
     *
     * The staleness check happens BEFORE a sequence number is taken, and that
     * ordering is load-bearing: the sequence is shared across identities, so a
     * stale caller taking one would supersede a legitimate read already in flight
     * for the identity on screen, trading a wrong write for a dropped one.
     *
     * Call it only when there is a read. Every non-read caller is a latent
     * version of the bug in the paragraph above; `isCurrent` is what they want.
     */
    begin: () => (() => boolean) | null;
};
export declare function useReadFence(identity: readonly unknown[], 
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
onRetired?: () => void): ReadFence;
//# sourceMappingURL=useReadFence.d.ts.map