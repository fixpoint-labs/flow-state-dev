/**
 * One session, followed live without React: its items, its unfinished runs,
 * and how far the connection can be trusted. For an app that is not a
 * `useSession` chat view, such as a board of workers or a task's transcript.
 *
 * The feed reads the session's newest items first ({@link readSessionTail}),
 * then follows the session stream from where that read began ({@link
 * followSession}), so nothing kept in between is missed. Copies of one item
 * are joined by {@link mayReplaceItem}: a partial copy never replaces a
 * finished one. The session stream sends an item once it is finished, so an
 * answer being written comes from the send's own response, through
 * {@link SessionFeed.followResponse}. A session longer than that first read
 * says so ({@link SessionFeedSnapshot.hasEarlier}), and
 * {@link SessionFeed.loadEarlier} reaches back a page at a time
 * ({@link readSessionEarlier}).
 */
import { collapseToCanonicalLog, compareItemOrder } from "@flow-state-dev/contracts/items";
import type { OutputItem, SessionRun } from "@flow-state-dev/core/items";
import type { SessionsApi } from "../client";
import { bindStoreToCallbacks } from "../stream-client/bind-store-to-callbacks";
import { createRequestStreamStore } from "../stream-client/request-stream-store";
import { createSSEClientFromResponse } from "../stream-client/streams";
import { followSession, type SessionConnectionState } from "./follow-session";
import { mayReplaceItem } from "./session-history";
import { readSessionEarlier, readSessionTail, type SessionItemsWindow } from "./session-window";

/** How long the first retry of a failed history read waits, by default; each later one waits twice as long. */
const DEFAULT_RETRY_MS = 2_000;
/** How many times a failed history read is tried again before the feed stops. */
const HISTORY_RETRIES = 4;
/** The item types `collapseToCanonicalLog` reads to drop a resumed gate's earlier copies. */
const RESUME_MARKERS = ["suspension", "suspension_resume"];

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
  /**
   * The newest history items (`readSessionTail`'s window), the earlier pages
   * {@link SessionFeed.loadEarlier} added, and every item kept since, in
   * display order (`compareItemOrder`).
   */
  readonly items: readonly OutputItem[];
  /**
   * The session holds items older than `items[0]`: show *Load earlier*.
   * `false` until the history read lands.
   */
  readonly hasEarlier: boolean;
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
  /**
   * Add the page of history before `items[0]` (up to 200 items), and say
   * whether there is more (`hasEarlier`). Live items keep arriving meanwhile.
   * Resolves at once when there is nothing earlier, before the history read
   * lands, or once the feed is closed; a call while one is reading shares it.
   * Rejects when the read fails, and leaves the feed as it was.
   */
  loadEarlier(): Promise<void>;
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
  const shown = options.itemTypes !== undefined && options.itemTypes.length > 0 ? options.itemTypes : undefined;
  // The resume markers are read too, though not shown: without them a filtered
  // feed can't tell a resumed gate's earlier copies from its current ones.
  const types = shown === undefined ? undefined : [...new Set([...shown, ...RESUME_MARKERS])];
  const passes = (item: OutputItem): boolean =>
    (options.includeTransient === true || item.transient !== true) && (types === undefined || types.includes(item.type));

  const byKey = new Map<string, OutputItem>();
  const listeners = new Set<(snapshot: SessionFeedSnapshot) => void>();
  const responses = new Set<() => void>();
  let snapshot: SessionFeedSnapshot = Object.freeze({ items: [], hasEarlier: false, runs: null, state: "connecting", error: null });
  let closed = false;
  let stopStream: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  /** The history read so far: where it starts in the session, for {@link readSessionEarlier}. */
  let historyWindow: SessionItemsWindow | undefined;
  let loadingEarlier: Promise<void> | undefined;

  const keep = (item: OutputItem): boolean => {
    if (!passes(item)) return false;
    const key = `${item.requestId}\u0000${item.id}`;
    if (!mayReplaceItem(byKey.get(key), item)) return false;
    byKey.set(key, item);
    return true;
  };
  // An earlier page is read through to the session's end, so its copy of an
  // unfinished item can be older than the one already held (a send's own
  // stream runs ahead of what is stored): it only fills in items not held.
  const keepEarlier = (item: OutputItem): boolean =>
    item.status === "in_progress" && byKey.has(`${item.requestId}\u0000${item.id}`) ? false : keep(item);
  const publish = (next: Partial<SessionFeedSnapshot>): void => {
    snapshot = Object.freeze({ ...snapshot, ...next });
    for (const listener of [...listeners]) listener(snapshot);
  };
  // A resumed block's copies from before the resume drop out, as they do from
  // a fresh history read and from `useSession`.
  const sortedItems = (): OutputItem[] => {
    const canonical = collapseToCanonicalLog([...byKey.values()].sort(compareItemOrder));
    return shown === undefined ? canonical : canonical.filter((item) => shown.includes(item.type));
  };

  const start = async (): Promise<void> => {
    let history;
    try {
      history = await readSessionTail(client.sessions, sessionId, { itemTypes: types });
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
    historyWindow = history;
    for (const item of history.items ?? []) keep(item);
    publish({ items: sortedItems(), hasEarlier: history.hasEarlier, error: null });
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
  /** Start over on the session now under the id: drop what the feed holds, read its newest items, follow it. */
  const restart = (): void => {
    stopStream?.();
    stopStream = undefined;
    for (const end of [...responses]) end();
    byKey.clear();
    historyWindow = undefined;
    failures = 0;
    publish({ items: [], hasEarlier: false, runs: null, state: "connecting", error: null });
    void start();
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
        onError: () => end(),
        // A response can end without saying how the request ended; the session stream has the rest.
        onClose: () => end()
      });
      responses.add(end);
    },
    loadEarlier() {
      if (loadingEarlier !== undefined) return loadingEarlier;
      const from = historyWindow;
      if (closed || from === undefined || !from.hasEarlier) return Promise.resolve();
      loadingEarlier = (async () => {
        try {
          // Read from the earlier start to the session's end, so nothing stored meanwhile falls between pages.
          const read = await readSessionEarlier(client.sessions, from);
          if (closed || historyWindow !== from) return;
          // Another session took the id since: what the feed holds and follows is the old one's.
          if (from.sessionCreatedAt !== undefined && read.sessionCreatedAt !== from.sessionCreatedAt) {
            restart();
            return;
          }
          historyWindow = read;
          for (const item of read.items) keepEarlier(item);
          publish({ items: sortedItems(), hasEarlier: read.hasEarlier });
        } finally {
          loadingEarlier = undefined;
        }
      })();
      return loadingEarlier;
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
