/**
 * A worker's conversation as the screen draws it, worked out from what the
 * packages read: its lines (React's `conversationLines`), whether the worker
 * is answering, and where the turns the worker reads word for word begin (the
 * divider), from the session turns view's `historyStart` and the history
 * summary's mark. Reads nothing itself: `src/app/conversations.ts` reads.
 */
import type { ItemLine } from "@flow-state-dev/react";

/** What a conversation shows now. */
export interface ConversationView {
  /** Its lines, from React's conversation model over its items and turns. */
  lines: readonly ItemLine[];
  /** The worker is answering in this conversation now. */
  running: boolean;
  /** From an `interrupt` until every turn it aborted has ended. */
  stopping: boolean;
  /**
   * The conversation's background work still running: its unfinished runs as the session stream
   * names them, whichever turn started them. `null` until the stream has named them: unknown is not zero.
   */
  backgroundRunning: number | null;
  /** Present while the conversation holds turns older than its first entry: adds the page before them. */
  loadEarlier?: () => Promise<void>;
  /** When the conversation's first loaded item was written, in ms. A message sent before it is outside the window. */
  since?: number;
}

/**
 * Whether the worker is answering, from the conversation's items and the
 * requests the server lists as in progress. The list is read on a timer, so
 * it trails the items: an item of the newest request still being written is
 * an answer under way before the list says so, unless the requests already
 * show that request ended (`ended`): a failed or aborted turn leaves its
 * half-written item so for good. A finished answer does not end its request
 * here, since one request can answer more than once (a worker that drains its
 * own plan answers again); only the list does.
 */
export function answeringOf(items: readonly { requestId: string; status?: string }[], inProgress: readonly string[], ended: readonly string[] = []): boolean {
  // Only the newest request, or one the list names: an item a crashed turn left half-written stays so for good.
  const newest = items[items.length - 1]?.requestId;
  const live = (requestId: string) => inProgress.includes(requestId) || (requestId === newest && !ended.includes(requestId));
  return inProgress.length > 0 || items.some((i) => i.status === "in_progress" && live(i.requestId));
}

/** Where the turns the worker reads word for word begin. */
export interface WindowMark {
  /** The first line inside the history window. Lines before it are out of the worker's view. */
  firstVerbatimLineId: string;
  /** The turns before it were summarized for the worker, rather than dropped. */
  summarized: boolean;
}

/** What the divider is drawn from: the first turn the worker's last window held, and how far the summary reaches. */
type WindowRead = { historyStart?: string; summarizedThrough?: string; summaryComplete?: boolean };

/**
 * Where the worker's last turn began reading word for word, from the
 * session turns view's rows and the history summary's public face.
 */
export function windowReadOf(
  turns: readonly { startedAt: number; historyStart: { requestId: string } | null }[],
  summary: { throughRequestId?: string | null; complete?: boolean } | null | undefined,
): WindowRead {
  // The latest turn that read a window, by when it started: the one the worker read last.
  // A turn still starting has no mark yet; the window only moves forward, so the one before it still holds.
  const latest = turns.filter((t) => t.historyStart !== null).reduce<(typeof turns)[number] | undefined>((a, t) => (a === undefined || t.startedAt > a.startedAt ? t : a), undefined);
  const through = summary?.throughRequestId;
  return {
    ...(latest?.historyStart == null ? {} : { historyStart: latest.historyStart.requestId }),
    // The worker reads after the mark whether or not the summary has a hole; a hole only changes the label.
    ...(through == null ? {} : { summarizedThrough: through, summaryComplete: summary?.complete === true }),
  };
}

/**
 * The divider, from the items: before the first line the worker read word
 * for word. That is the window's first turn, or the first turn after the
 * summary's mark when the summary reaches past it: the capability starts the
 * reads there, so no turn is read twice. Turns go in the order they started,
 * as history reads them: overlapping turns interleave their items, so the
 * summarized turn's last item can sit after a newer turn's first.
 */
export function windowMarkOf(items: readonly { id: string; requestId: string }[], lines: readonly ItemLine[], read: WindowRead): WindowMark | undefined {
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
  const drawn = new Set(lines.map((line) => line.id));
  const first = items.slice(from).find((i) => drawn.has(i.id));
  return first === undefined ? undefined : { firstVerbatimLineId: first.id, summarized: read.summaryComplete !== false && folded >= 0 && folded >= start };
}
