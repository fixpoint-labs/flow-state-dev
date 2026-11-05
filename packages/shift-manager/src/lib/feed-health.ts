/**
 * How a session feed on screen tells the page its connection state, so the
 * connection bar and the stale styling count it. `LabProvider`
 * provides the reporter; outside one, reports go nowhere.
 */
import { createContext, useContext, useEffect, useId } from "react";
import type { ConnectionFeedState } from "../components/flow-state/connection-banner";

/** Report a feed's state under a key of the caller's; `null` takes it back. */
export type ReportFeed = (key: string, state: ConnectionFeedState | null) => void;

export const FeedHealthContext = createContext<ReportFeed>(() => {});

/** Worst first: a state earlier here wins the page's connection. */
const SEVERITY: readonly ConnectionFeedState[] = ["stopped", "lapsed", "reconnecting", "connecting", "live"];

/** The worst of `states`, ordered `stopped` › `lapsed` › `reconnecting` › `connecting` › `live`. */
export function worstFeedState(states: Iterable<ConnectionFeedState>): ConnectionFeedState {
  let worst = SEVERITY.length - 1;
  for (const state of states) worst = Math.min(worst, SEVERITY.indexOf(state));
  return SEVERITY[worst]!;
}

/**
 * Report a session feed's state for as long as the caller is mounted.
 * `undefined` reports nothing.
 */
export function useReportFeedState(state: ConnectionFeedState | undefined): void {
  const report = useContext(FeedHealthContext);
  const key = useId();
  useEffect(() => {
    report(key, state ?? null);
  }, [report, key, state]);
  useEffect(() => () => report(key, null), [report, key]);
}
