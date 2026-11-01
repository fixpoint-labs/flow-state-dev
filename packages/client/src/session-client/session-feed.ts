/**
 * One session, followed live without React: its items, its unfinished runs,
 * and how far the connection can be trusted. For an app that is not a
 * `useSession` chat view, such as a board of workers or a task's transcript.
 *
 * The feed reads the whole history first ({@link readSessionHistory}), then
 * follows the session stream from where that read began ({@link
 * followSession}), so nothing kept in between is missed. Copies of one item
 * are joined by {@link mayReplaceItem}: a partial copy never replaces a
 * finished one. The session stream sends an item once it is finished, so an
 * answer being written comes from the send's own response, through
 * {@link SessionFeed.followResponse}.
 */
import { compareItemOrder } from "@flow-state-dev/contracts/items";
import type { OutputItem, SessionRun } from "@flow-state-dev/core/items";
import type { SessionsApi } from "../client";
import { bindStoreToCallbacks } from "../stream-client/bind-store-to-callbacks";
import { createRequestStreamStore } from "../stream-client/request-stream-store";
import { createSSEClientFromResponse } from "../stream-client/streams";
import { followSession, type SessionConnectionState } from "./follow-session";
import { mayReplaceItem, readSessionHistory } from "./session-history";

/** How long the first retry of a failed history read waits, by default; each later one waits twice as long. */
const DEFAULT_RETRY_MS = 2_000;
/** How many times a failed history read is tried again before the feed stops. */
const HISTORY_RETRIES = 4;

export type SessionFeedOptions = {
  /** Keep only these item types. Default: every type. */
  readonly itemTypes?: string[];
  /** Keep transient items too. Default false, as `useSession`. */
  readonly includeTransient?: boolean;
  /**
   * How long the first retry of a failed history read waits, in ms; each later
   * one waits twice as long, and after four the feed stops. Default 2000.
   */
  readonly retryMs?: number;
};

/** What a feed shows at one moment. A new, frozen object on every change. */
export type SessionFeedSnapshot = {
  /** Every item kept so far, in display order (`compareItemOrder`). */
  readonly items: readonly OutputItem[];
  /** The session's unfinished runs as the stream last named them; `null` until it has. */
  readonly runs: readonly SessionRun[] | null;
  /** How far `items` and `runs` can be trusted. See {@link SessionConnectionState}. */
  readonly state: SessionConnectionState;
  /**
   * The last history read's failure: while it is read again, and after the
   * feed gave up (`stopped`). `null` once a read lands.
   */
  readonly error: Error | null;
};

export interface SessionFeed {
  /** What the feed shows now. The same object until something changes. */
  getSnapshot(): SessionFeedSnapshot;
  /** Called on every change. Returns what stops it. */
  subscribe(listener: (snapshot: SessionFeedSnapshot) => void): () => void;
  /**
   * Keep a send's streamed response (`send(..., { stream: true })`'s
   * `Response`): its items as they are written, until the request ends. The
   * session stream carries the finished copies from there.
   */
  followResponse(response: Response): void;
  /** Stop following: closes the stream and every followed response. The state becomes `stopped`. */
  close(): void;
}

/**
 * Follow one session. The feed starts at once and runs until {@link
 * SessionFeed.close}; one feed holds one connection, so views that show the
 * same session share the feed.
 */
export function sessionFeed(
  client: { readonly sessions: Pick<SessionsApi, "state" | "stream"> },
  sessionId: string,
  options: SessionFeedOptions = {}
): SessionFeed {
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const types = options.itemTypes !== undefined && options.itemTypes.length > 0 ? options.itemTypes : undefined;
  const passes = (item: OutputItem): boolean =>
    (options.includeTransient === true || item.transient !== true) && (types === undefined || types.includes(item.type));

  const byKey = new Map<string, OutputItem>();
  const listeners = new Set<(snapshot: SessionFeedSnapshot) => void>();
  const responses = new Set<() => void>();
  let snapshot: SessionFeedSnapshot = Object.freeze({ items: [], runs: null, state: "connecting", error: null });
  let closed = false;
  let stopStream: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const keep = (item: OutputItem): boolean => {
    if (!passes(item)) return false;
    const key = `${item.requestId}\u0000${item.id}`;
    if (!mayReplaceItem(byKey.get(key), item)) return false;
    byKey.set(key, item);
    return true;
  };
  const publish = (next: Partial<SessionFeedSnapshot>): void => {
    snapshot = Object.freeze({ ...snapshot, ...next });
    for (const listener of [...listeners]) listener(snapshot);
  };
  const sortedItems = (): OutputItem[] => [...byKey.values()].sort(compareItemOrder);

  const start = async (): Promise<void> => {
    let history;
    try {
      history = await readSessionHistory(client.sessions, sessionId, { itemTypes: types });
    } catch (cause) {
      if (closed) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      // Backed off, and given up: a fixed retry against a host that is down is a steady poll.
      if (failures >= HISTORY_RETRIES) {
        publish({ error, state: "stopped" });
        return;
      }
      publish({ error });
      retry = setTimeout(() => void start(), retryMs * 2 ** failures);
      failures += 1;
      return;
    }
    if (closed) return;
    for (const item of history.items ?? []) keep(item);
    publish({ items: sortedItems(), error: null });
    // A listener may close the feed on the history it just heard.
    if (closed) return;

    stopStream = followSession({
      sessionId,
      client,
      after: history,
      itemTypes: types,
      onItem: ({ item }) => {
        if (keep(item)) publish({ items: sortedItems() });
      },
      onRuns: ({ runs }) => publish({ runs }),
      onConnection: (state) => publish({ state })
    });
  };
  void start();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    followResponse(response) {
      if (closed) return;
      const store = createRequestStreamStore();
      let done = false;
      const end = (): void => {
        if (done) return;
        done = true;
        responses.delete(end);
        handle.close();
      };
      const handle = createSSEClientFromResponse({
        response,
        ...bindStoreToCallbacks(store, {
          itemFilter: passes,
          onChange: () => {
            if (done) return;
            store.flushDeltas();
            let changed = false;
            for (const item of store.getSorted()) changed = keep(item) || changed;
            if (changed) publish({ items: sortedItems() });
            if (store.status !== "in_progress") end();
          }
        }),
        onError: () => end()
      });
      responses.add(end);
    },
    close() {
      if (closed) return;
      closed = true;
      if (retry !== undefined) clearTimeout(retry);
      stopStream?.();
      for (const end of [...responses]) end();
      // Closing the stream already said so, once it had opened.
      if (snapshot.state !== "stopped") publish({ state: "stopped" });
      listeners.clear();
    }
  };
}
