/**
 * The live read of a flow's sessions: listed now, again on each `run` notice
 * on the user's topic, and again when the page becomes visible. Shared by
 * `useSessionList` and `FlowNavigator`'s leaf, so the two never read their
 * sessions through two different paths. Not exported from the package.
 */
import { useMemo } from "react";
import { topic, type Client, type SessionSummary } from "@flow-state-dev/client";
import type { SessionList, SessionListClient } from "../hooks/useSessionList";
import { coalescedReads } from "./coalescedReads";
import { LIVE_POLL_MS } from "./scopeNotices";
import { useFencedRead, type ReadDriver } from "./useFencedRead";

const EMPTY_SESSIONS: SessionSummary[] = [];

/**
 * Read now, again on each `run` notice on the user's topic (and on a
 * connect, reconnect, tick or `resync`), and again when the page becomes
 * visible.
 */
function liveListDriver(client: Pick<Client, "subscribe">): ReadDriver {
  return (read) => {
    const reads = coalescedReads(read);
    const subscription = client.subscribe([topic.user()], {
      onChange: (notice) => {
        if (notice === null || notice.kind === "resync" || notice.kind === "run") reads.request();
      },
      pollIntervalMs: LIVE_POLL_MS
    });
    const doc = typeof document === "undefined" ? undefined : document;
    const onVisible = (): void => {
      if (doc?.visibilityState === "visible") reads.request();
    };
    doc?.addEventListener("visibilitychange", onVisible);
    reads.request();
    return () => {
      reads.close();
      subscription.close();
      doc?.removeEventListener("visibilitychange", onVisible);
    };
  };
}

/** What {@link useLiveSessionRead} reads, and when. */
export type LiveSessionReadOptions = {
  /** The client to list and subscribe through: a stable reference. */
  readonly source: SessionListClient;
  readonly query: { flowKind?: string; flowId?: string };
  readonly includeDispatchRuns: boolean;
  readonly includeStatus: boolean;
  /** `false` reads nothing and holds nothing. */
  readonly enabled: boolean;
  /**
   * More of the read's identity: a change starts a fresh read. The
   * navigator's leaf adds its visit, so a closed leaf holds nothing.
   */
  readonly extraIdentity?: readonly unknown[];
};

/** The read behind {@link useSessionList} and the navigator's leaf. */
export function useLiveSessionRead({
  source,
  query,
  includeDispatchRuns,
  includeStatus,
  enabled,
  extraIdentity = []
}: LiveSessionReadOptions): SessionList {
  // A disabled list subscribes to nothing: no user topic, timer or
  // visibility listener, so closing the last open leaf lets the push
  // connection go.
  const live = enabled && source.subscribe !== undefined;
  const driver = useMemo(
    () => (live ? liveListDriver(source as Pick<Client, "subscribe">) : undefined),
    [source, live]
  );
  const include = [
    ...(includeDispatchRuns ? (["dispatch-runs"] as const) : []),
    ...(includeStatus ? (["status"] as const) : [])
  ];
  const { data, isLoading, error, refresh } = useFencedRead<readonly SessionSummary[]>(
    // `enabled` is in the identity, as `useFencedRead` asks of a caller that
    // toggles it: turning it off drops the held rows and any read in flight.
    [source, query.flowKind, query.flowId, includeDispatchRuns, includeStatus, enabled, ...extraIdentity],
    EMPTY_SESSIONS,
    "Failed to load sessions",
    () =>
      source.sessions.list({
        ...query,
        // Omitted unless asked for, so a list that asks for nothing sends the
        // request it always has. No user: the client lists its own user's.
        ...(include.length > 0 ? { include } : {})
      }),
    { driver, enabled }
  );
  return { sessions: data, isLoading, error, refresh };
}
