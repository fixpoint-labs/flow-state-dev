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
function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

/** What a fenced read hands its caller. */
type FencedRead<T> = {
  readonly data: T;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
};

/**
 * What starts an identity's reads, when reading once on mount is not all it
 * does. Handed the read (which settles however it went); returns what stops
 * everything it started. Held stable by the caller: a new one restarts the
 * reads. A re-read under rows already drawn shows no loading note: every
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
export function useFencedRead<T>(
  identity: readonly unknown[],
  empty: T,
  failureMessage: string,
  load: (stillCurrent: () => boolean) => Promise<T>,
  options: FencedReadOptions = {}
): FencedRead<T> {
  const { driver, enabled = true } = options;
  const [data, setData] = useState(empty);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
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
    if (!enabled) return;
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    setIsLoading(true);
    setError(null);
    setHeldIdentity(fence.identity);
    try {
      const next = await loadRef.current(stillCurrent);
      if (!stillCurrent()) return;
      setData(next);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describe(err, failureMessage));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, failureMessage, enabled]);

  useEffect(() => {
    if (driver === undefined) {
      void read();
      return;
    }
    return driver(read);
  }, [read, driver]);

  return {
    data: holdsCurrent ? data : empty,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}
