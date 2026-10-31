/**
 * Following a session's stream, and saying how far what it last said can be
 * trusted. Shared by {@link sessionFeed}, `useSession`'s `live` and the task
 * board panels, so all three keep one meaning for when the stream vouches for
 * a session and when it has stopped.
 */
import type { SessionItemEvent, SessionRunsChangedEvent } from "@flow-state-dev/core/items";
import type { SessionsApi } from "../client";

/**
 * How far a session follow can be trusted.
 *
 * - `connecting`: nothing is vouched for yet; no connection has named the runs.
 * - `live`: the current connection named the runs, so what it says is current.
 * - `reconnecting`: the connection closed and the first retry is coming, as
 *   after the server's own close every 15 minutes.
 * - `lapsed`: a retry has failed; what it last said may be out of date. It
 *   becomes `live` again when a connection names the runs.
 * - `stopped`: it will not come back: refused, the session gone, or closed.
 */
export type SessionConnectionState = "connecting" | "live" | "reconnecting" | "lapsed" | "stopped";

export type FollowSessionOptions = {
  readonly sessionId: string;
  /** The view's client: the stream goes through its transport, with the view's credential. */
  readonly client: { readonly sessions: Pick<SessionsApi, "stream"> };
  readonly since?: number;
  readonly sessionCreatedAt?: number;
  readonly itemTypes?: string[];
  /**
   * A finished item the session kept, including those the stream's opening
   * read reaches back to. A reconnect can deliver an item again; telling a
   * repeat apart is the caller's (`requestId` and `item.id`, ordered by
   * `compareItemOrder`, or {@link mayReplaceItem}).
   */
  readonly onItem: (event: SessionItemEvent) => void;
  /** The session's unfinished runs: named first on every connection, then on each change. */
  readonly onRuns?: (event: SessionRunsChangedEvent) => void;
  /**
   * The stream had named the runs and has stopped following the session: a
   * reconnect failed, or it was refused for good. A stream refused or dropped
   * before it named anything reports nothing, and the view carries on as it
   * would without the stream.
   */
  readonly onLapsed?: () => void;
  /** Each change of {@link SessionConnectionState}, after the first (`connecting`). */
  readonly onConnection?: (state: SessionConnectionState) => void;
};

/** Open the session's stream. Returns what closes it. */
export function followSession(options: FollowSessionOptions): () => void {
  let following = false;
  let state: SessionConnectionState = "connecting";
  const enter = (next: SessionConnectionState): void => {
    if (state === next || state === "stopped") return;
    state = next;
    options.onConnection?.(next);
  };

  const handle = options.client.sessions.stream(options.sessionId, {
    since: options.since,
    sessionCreatedAt: options.sessionCreatedAt,
    itemTypes: options.itemTypes,
    onItem: options.onItem,
    onRuns: (event) => {
      following = true;
      enter("live");
      options.onRuns?.(event);
    },
    // The first try after a drop takes about a second, the stream's own pace;
    // once one has failed, what it last said may no longer be current.
    onReconnecting: ({ attempt }) => {
      if (!following) return;
      if (attempt >= 2) {
        enter("lapsed");
        options.onLapsed?.();
      } else {
        enter("reconnecting");
      }
    },
    // Refused for good, or the session is gone.
    onStop: () => {
      enter("stopped");
      if (following) options.onLapsed?.();
    }
  });
  return () => {
    enter("stopped");
    handle.close();
  };
}
