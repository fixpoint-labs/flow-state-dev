/** What a fenced read hands its caller. */
type FencedRead<T> = {
    readonly data: T;
    readonly isLoading: boolean;
    readonly error: string | null;
    readonly refresh: () => void;
};
/**
 * What starts an identity's reads, when reading once on mount is not all it
 * does. Handed the read, which rejects when it failed and is still the
 * newest (so a live read can try again) and resolves otherwise; returns what
 * stops everything it started. Held stable by the caller: a new one restarts
 * the reads. A re-read under rows already drawn shows no loading note: every
 * panel draws that only while it has no rows.
 */
export type ReadDriver = (read: () => Promise<void>) => () => void;
/** How a fenced read runs, beyond reading once on mount. */
type FencedReadOptions = {
    /** Starts the identity's reads instead of the one read on mount. */
    readonly driver?: ReadDriver;
    /**
     * Whether the read may ask for anything. While `false`, a read (a mount, a
     * driver's, a `refresh`) returns before taking a sequence number and writes
     * nothing, so it supersedes no read in flight. Default `true`. The
     * navigator's leaf list sets it: a closed leaf asks for nothing. A caller
     * that turns it on and off keeps something in the identity that changes with
     * it, so the change starts a fresh read.
     */
    readonly enabled?: boolean;
};
/**
 * One fenced read. `load` is held in a ref so a new closure does not restart
 * the effect; the identity tuple is what restarts it, same as `useReadFence`.
 * A `load` that returns after its identity has been left is discarded.
 */
export declare function useFencedRead<T>(identity: readonly unknown[], empty: T, failureMessage: string, load: (stillCurrent: () => boolean) => Promise<T>, options?: FencedReadOptions): FencedRead<T>;
export {};
//# sourceMappingURL=useFencedRead.d.ts.map