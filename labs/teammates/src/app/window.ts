/**
 * Where the turns the worker reads word for word begin: the last answering
 * request's `historyStart` and the session's history summary, as the divider
 * the conversation draws.
 */
import { topic, type SessionRequestSummary } from "@flow-state-dev/client";
import { toEntries, type ConversationEntry } from "./conversations";
import type { Item } from "./items";
import { isRequest, logFailedRead, POLL_MS, QUIET_ACTIONS, type Unsubscribe } from "./reads";
import type { AppState } from "./state";

/** Where the turns the worker reads word for word begin. */
export interface WindowMark {
  /** The first entry inside the history window. Entries before it are out of the worker's view. */
  firstVerbatimEntryId: string;
  /** The turns before it were summarized for the worker, rather than dropped. */
  summarized: boolean;
}

/** The session resource the lab's history summary keeps; its public face carries the mark. */
const HISTORY_SUMMARY = "historySummary";

/** What the screen reads of where the worker's last turn began reading word for word. */
export interface WindowRead {
  /** The first turn the window held, when earlier turns had left it. */
  historyStart?: string;
  /** The newest turn folded into the summary, once one was. */
  summarizedThrough?: string;
  /** Whether the summary covers every turn before its mark; one with a hole can't be called that. */
  summaryComplete?: boolean;
}

/** The public face of the session's history summary resource. */
export interface HistorySummaryFace {
  clientData?: { throughRequestId?: string | null; complete?: boolean };
}

/**
 * Where the worker's last turn began reading word for word, from the
 * session's requests and its history summary.
 *
 * @param requests The session's recent requests, any order.
 * @param summary The session's history summary resource, when it has one.
 */
export function windowReadOf(requests: readonly SessionRequestSummary[], summary: HistorySummaryFace | undefined): WindowRead {
  // The latest turn of the worker's own that read a window, by when it started: the one the worker read last.
  // A turn still starting has no mark yet; the window only moves forward, so the one before it still holds.
  const answering = requests.filter((r) => !QUIET_ACTIONS.has(r.actionName) && r.historyStart != null);
  const latest = answering.reduce<SessionRequestSummary | undefined>((a, r) => (a === undefined || (r.startedAtMs ?? 0) > (a.startedAtMs ?? 0) ? r : a), undefined);
  const through = summary?.clientData?.throughRequestId;
  return {
    ...(latest?.historyStart == null ? {} : { historyStart: latest.historyStart.requestId }),
    // The worker reads after the mark whether or not the summary has a hole; a hole only changes the label.
    ...(through == null ? {} : { summarizedThrough: through, summaryComplete: summary?.clientData?.complete === true }),
  };
}

/**
 * The divider, from the items: before the first entry the worker read word
 * for word. That is the window's first turn, or the first turn after the
 * summary's mark when the summary reaches past it: the capability starts the
 * reads there, so no turn is read twice. Turns go in the order they started,
 * as history reads them: overlapping turns interleave their items, so the
 * summarized turn's last item can sit after a newer turn's first.
 */
export function windowMarkOf(items: readonly Item[], entries: readonly ConversationEntry[], read: WindowRead): WindowMark | undefined {
  const firstOf = (requestId: string) => items.findIndex((i) => i.requestId === requestId);
  const turns = [...new Set(items.map((i) => i.requestId))];
  /** The first item of the turn that started after `requestId`; past the end when none did. */
  const turnAfter = (requestId: string) => {
    const at = turns.indexOf(requestId);
    if (at < 0) return -1;
    const next = turns[at + 1];
    return next === undefined ? items.length : firstOf(next);
  };
  const start = read.historyStart === undefined ? -1 : firstOf(read.historyStart);
  const folded = read.summarizedThrough === undefined ? -1 : turnAfter(read.summarizedThrough);
  const from = Math.max(start, folded);
  if (from < 0) return undefined;
  const drawn = new Set(entries.map((e) => e.id));
  const first = items.slice(from).find((i) => drawn.has(i.id));
  return first === undefined ? undefined : { firstVerbatimEntryId: first.id, summarized: read.summaryComplete !== false && folded >= 0 && folded >= start };
}

/** The window's divider, watched. */
export interface WindowCalls {
  /** `undefined` while the whole conversation is inside the window. */
  watchWindow(sessionId: string, onChange: (mark: WindowMark | undefined) => void): Unsubscribe;
}

/** {@link WindowCalls} over the app's shared state. */
export function windowCalls(state: AppState): WindowCalls {
  const { client, watchFeed } = state;
  return {
    watchWindow(sessionId, onChange) {
      let items: Item[] = [];
      let read: WindowRead = {};
      let last = "";
      const emit = () => {
        const mark = windowMarkOf(items, toEntries(items, state.workerIds), read);
        const seen = JSON.stringify(mark ?? null);
        if (seen === last) return;
        last = seen;
        onChange(mark);
      };
      const stopFeed = watchFeed(sessionId, (next) => next, (next) => {
        items = next;
        emit();
      });
      // The window moves with a turn (a request notice), and the summary's mark with its resource.
      const stopPoll = client.live([topic.session(sessionId)], {
        read: async (): Promise<WindowRead> => {
          const requests = await client.sessions.requests(sessionId, { limit: 20 });
          const summary = (await client.sessions.state(sessionId, { includeItems: false })).resources?.session?.[HISTORY_SUMMARY] as
            | HistorySummaryFace
            | undefined;
          return windowReadOf(requests, summary);
        },
        onValue: (next) => {
          read = next;
          emit();
        },
        hear: (notice) => isRequest(notice) || (notice.kind === "resource" && notice.topic.resource === HISTORY_SUMMARY),
        pollIntervalMs: POLL_MS,
        onError: logFailedRead,
      }).close;
      return () => {
        stopFeed();
        stopPoll();
      };
    },
  };
}
