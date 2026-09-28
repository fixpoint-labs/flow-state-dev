/**
 * `usePoll` — re-run a read on an interval while `enabled`, one at a time.
 *
 * The next tick is scheduled only after the previous read settles. A fixed
 * `setInterval` would start a read while the last is still in flight, and the
 * DevTool's reads are fenced so a newer read retires an older one: on a
 * connection slower than the interval, every read would be retired by the next
 * and no snapshot would ever land.
 */
import { useEffect, useRef } from "react";

/**
 * @param enabled Poll while true; turning it false stops the next tick.
 * @param read The read to repeat. Awaited before the next tick is scheduled.
 * @param intervalMs Gap between one read settling and the next starting.
 */
export function usePoll(enabled: boolean, read: () => unknown, intervalMs: number): void {
  // Latest `read` in a ref so a new callback identity does not restart the chain.
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        await readRef.current();
      } finally {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      }
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}
