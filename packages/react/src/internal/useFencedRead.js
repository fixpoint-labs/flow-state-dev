/**
 * The fenced read the workforce panels and the flow navigator share: open a
 * read on `useReadFence`, write what it returns only while it is still the
 * newest read of the identity in play, and hand back nothing an identity since
 * left was read under. A fix to how these reads guard against late or racing
 * responses is made here, once.
 *
 * Internal on purpose. Exporting a read would let a host mount it twice, which
 * is the one-read-per-host rule lost by export rather than by bug.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useReadFence } from "../hooks/useReadFence";
/** A read's error text: an `Error`'s own message when it has one, else the read's fallback. */
function describe(error, fallback) {
    return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
/**
 * One fenced read. `load` is held in a ref so a new closure does not restart
 * the effect; the identity tuple is what restarts it, same as `useReadFence`.
 * A `load` that returns after its identity has been left is discarded.
 */
export function useFencedRead(identity, empty, failureMessage, load, options = {}) {
    const { driver, enabled = true } = options;
    const [data, setData] = useState(empty);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [heldIdentity, setHeldIdentity] = useState(null);
    const loadRef = useRef(load);
    loadRef.current = load;
    const fence = useReadFence(identity, () => {
        setData(empty);
        setError(null);
        setIsLoading(true);
        setHeldIdentity(null);
    });
    const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);
    const read = useCallback(async () => {
        // Before `begin()`, never after: taking a sequence number supersedes a
        // read in flight, and a read that may not ask must cancel nothing.
        if (!enabled)
            return;
        const stillCurrent = fence.begin();
        if (stillCurrent === null)
            return;
        setIsLoading(true);
        setError(null);
        setHeldIdentity(fence.identity);
        try {
            const next = await loadRef.current(stillCurrent);
            if (!stillCurrent())
                return;
            setData(next);
        }
        catch (err) {
            if (!stillCurrent())
                return;
            setError(describe(err, failureMessage));
            throw err;
        }
        finally {
            if (stillCurrent())
                setIsLoading(false);
        }
    }, [fence, failureMessage, enabled]);
    useEffect(() => {
        if (driver === undefined) {
            // The error is drawn; a read on mount has nothing to try again on.
            read().catch(() => undefined);
            return;
        }
        return driver(read);
    }, [read, driver]);
    return {
        data: holdsCurrent ? data : empty,
        isLoading: holdsCurrent ? isLoading : true,
        error: holdsCurrent ? error : null,
        refresh: () => void read().catch(() => undefined)
    };
}
//# sourceMappingURL=useFencedRead.js.map