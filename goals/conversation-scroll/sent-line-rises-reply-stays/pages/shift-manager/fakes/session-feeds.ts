/** The page's session feeds, read and followed from the script. See `../shared.ts`. */
export * from "../../../lib/session-feeds";
import { useMemo, useSyncExternalStore } from "react";
import { script } from "../../script";
import { itemsOf } from "../shared";

/** One session's feed: the script's lines now, then again on each change to them. */
export function useSharedSessionFeed(sessionId: string | null | undefined) {
  // The script's lines, as one string per change, so an unchanged script reads the same snapshot.
  const lines = useSyncExternalStore(
    (listener) => script.subscribe(listener),
    () => (sessionId == null ? "" : JSON.stringify(itemsOf(sessionId))),
  );
  return useMemo(
    () =>
      sessionId == null
        ? undefined
        : { sessionId, items: JSON.parse(lines), hasEarlier: false, runs: null, state: "live" as const, error: null, loadEarlier: async () => {}, followResponse: () => {} },
    [sessionId, lines],
  );
}

/** Retry: the script never gives up, so there is nothing to open again. */
export function useRetrySessionFeed() {
  return () => undefined;
}
