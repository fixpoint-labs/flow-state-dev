/**
 * `useSessionList(options)` (FIX-2411): a flow's sessions, read again when
 * one of them changes.
 *
 * The list `FlowNavigator` draws under an open leaf, and the one any other
 * rail draws from. Each row can carry its latest request's state
 * (`SessionSummary.requestStatus`), read by the server in the same listing,
 * so a rail shows which session needs its person without a read per row.
 *
 * Live through the client's `subscribe`, on the caller's user topic, where
 * the server publishes a `run` notice for every write to one of the user's
 * sessions: a session created, titled or deleted, and a request started or
 * ended, from any tab, script or process the bus reaches. A burst of notices
 * is one read in flight and one waiting. It also reads when the page becomes
 * visible, for a change the bus could not carry (another process on a bus
 * that doesn't cross). A client without `subscribe` reads once, as the
 * navigator always has.
 */
import { useMemo } from "react";
import { topic, type Client, type SessionsApi, type SessionSummary } from "@flow-state-dev/client";
import { coalescedReads } from "../internal/coalescedReads";
import { LIVE_POLL_MS } from "../internal/scopeNotices";
import { useClient } from "../internal/useClient";
import { useFencedRead, type ReadDriver } from "../internal/useFencedRead";

/**
 * The client a session list reads through: the listing, and `subscribe` to
 * stay live. Pass a stable reference; the read is fenced on it.
 */
export type SessionListClient = { readonly sessions: Pick<SessionsApi, "list"> } & Partial<Pick<Client, "subscribe">>;

/** Options for {@link useSessionList}. */
export type UseSessionListOptions = {
  /** List this flow kind's sessions. */
  readonly flowKind?: string;
  /** List one flow instance's sessions: narrower than `flowKind` for a collection flow. */
  readonly flowId?: string;
  /** Also list the sessions a dispatcher ran work in. Off by default. */
  readonly includeDispatchRuns?: boolean;
  /** Ask the server for each row's `requestStatus`. Default `true`. */
  readonly includeStatus?: boolean;
  /** `false` reads nothing and holds nothing. Default `true`. */
  readonly enabled?: boolean;
  /** The client to read and subscribe through. Default: the provider's. */
  readonly client?: SessionListClient;
};

/** What {@link useSessionList} returns. */
export type SessionList = {
  /** The sessions, newest first as the server lists them. */
  readonly sessions: readonly SessionSummary[];
  readonly isLoading: boolean;
  /** Why the last read failed, or `null`. */
  readonly error: string | null;
  /** Read again now. */
  readonly refresh: () => void;
};

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

/**
 * The read itself, for {@link useSessionList} and the navigator's leaf, which
 * adds its own visit to the identity so a closed leaf holds nothing.
 *
 * @internal
 */
export function useLiveSessionRead(
  source: SessionListClient,
  query: { flowKind?: string; flowId?: string },
  includeDispatchRuns: boolean,
  includeStatus: boolean,
  enabled: boolean,
  extraIdentity: readonly unknown[] = []
): SessionList {
  const subscribe = source.subscribe;
  const driver = useMemo(
    () => (subscribe === undefined ? undefined : liveListDriver(source as Pick<Client, "subscribe">)),
    // `source` is the stable reference; `subscribe` only says whether it can.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, subscribe === undefined]
  );
  const include = [
    ...(includeDispatchRuns ? (["dispatch-runs"] as const) : []),
    ...(includeStatus ? (["status"] as const) : [])
  ];
  const { data, isLoading, error, refresh } = useFencedRead<readonly SessionSummary[]>(
    [source, query.flowKind, query.flowId, includeDispatchRuns, includeStatus, ...extraIdentity],
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

/**
 * A flow's sessions, live. Name the flow by `flowKind`, or by `flowId` for
 * one instance of a collection flow.
 */
export function useSessionList(options: UseSessionListOptions): SessionList {
  const providerClient = useClient();
  const source: SessionListClient = options.client ?? providerClient;
  const query = {
    ...(options.flowKind !== undefined ? { flowKind: options.flowKind } : {}),
    ...(options.flowId !== undefined ? { flowId: options.flowId } : {})
  };
  return useLiveSessionRead(
    source,
    query,
    options.includeDispatchRuns ?? false,
    options.includeStatus ?? true,
    options.enabled ?? true
  );
}
