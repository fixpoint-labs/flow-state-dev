/**
 * `useFocusRevalidate` — runs a callback when the DevTool regains the user's
 * attention (the tab becomes visible again, or the window regains focus), so
 * the open session can be brought current after the developer returns from
 * working elsewhere.
 *
 * Deliberately event-driven, not a steady poller: it adds no load while the
 * developer is away or idle. Throttled to survive focus thrash, and gated on
 * document visibility so background-tab focus quirks don't fire it.
 */
import { useEffect, useRef } from "react";

export type UseFocusRevalidateOptions = {
  /** When false, no listeners are attached. Defaults to true. */
  enabled?: boolean;
  /**
   * Minimum gap between runs, in ms. Mirrors SWR's `focusThrottleInterval`
   * default so a rapid visibility+focus burst (or quick tab in/out) fires at
   * most once per window. Defaults to 5000.
   */
  throttleMs?: number;
};

const DEFAULT_THROTTLE_MS = 5000;

/**
 * Calls `callback` when the page becomes visible/focused again, at most once
 * per `throttleMs`. Listens to both `visibilitychange` and the window `focus`
 * event: the former covers tab switches, the latter covers clicking back into
 * a browser window that was never hidden (e.g. an editor open side-by-side).
 * Every run is guarded on `document.visibilityState === "visible"`, so a
 * same-gesture visibility+focus pair collapses into a single call.
 */
export function useFocusRevalidate(
  callback: () => void,
  options: UseFocusRevalidateOptions = {},
): void {
  const { enabled = true, throttleMs = DEFAULT_THROTTLE_MS } = options;

  // Hold the latest callback in a ref so the listener effect doesn't
  // re-subscribe on every render when the caller passes an inline function.
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Seeded to -Infinity so the first focus/visibility event after mount always
  // runs, independent of the wall clock — the "I tabbed away right after
  // opening and came back" case must not be swallowed by the throttle window.
  const lastRunRef = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!enabled) return;

    const maybeRun = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRunRef.current < throttleMs) return;
      lastRunRef.current = now;
      callbackRef.current();
    };

    document.addEventListener("visibilitychange", maybeRun);
    window.addEventListener("focus", maybeRun);
    return () => {
      document.removeEventListener("visibilitychange", maybeRun);
      window.removeEventListener("focus", maybeRun);
    };
  }, [enabled, throttleMs]);
}
