/**
 * `useSessionList(options)` (FIX-2411): a flow's sessions, read again when
 * one of them changes.
 *
 * The list `FlowNavigator` draws under an open leaf, and the one any other
 * rail draws from. Each row can carry its latest request's state
 * (`SessionSummary.requestStatus`), read by the server in the same listing,
 * so a rail shows which session needs its user without a read per row.
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
import type { Client, SessionsApi, SessionSummary } from "@flow-state-dev/client";
import { useLiveSessionRead } from "../internal/useLiveSessionRead";
import { useClient } from "../internal/useClient";

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
  return useLiveSessionRead({
    source,
    query,
    includeDispatchRuns: options.includeDispatchRuns ?? false,
    includeStatus: options.includeStatus ?? true,
    enabled: options.enabled ?? true
  });
}
