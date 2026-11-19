/**
 * A worker's conversation as the screen draws it, worked out from what the
 * packages read: its stored items as entries, whether the worker is
 * answering, and where the turns the worker reads word for word begin (the
 * divider), from the session turns view's `historyStart` and the history
 * summary's mark. Reads nothing itself: `src/app/conversations.ts` reads.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { answerTextOf, delegateAnswerOf, RECEIVED_MESSAGE_DATA_TYPE, SEND_MESSAGE_TOOL } from "@flow-state-dev/workforce/browser";
import { parseNotice } from "@flow-state-dev/orchestration/tasks";
import { filesOf, parseArgs, sentTo, textOf, type Item } from "./items";
import { stepRun, toolStep, type SessionStep, type StepRun } from "./steps";

export type ConversationEntry =
  /** `files`: what the line carries, as references, in the order attached. */
  | { kind: "user"; id: string; text: string; files?: FileContent[] }
  /** `streaming` while the answer is still being written; `incomplete` when its turn failed before it was finished. */
  | { kind: "assistant"; id: string; text: string; streaming?: boolean; incomplete?: boolean }
  /**
   * A turn that failed, from the engine's `error` item: its reason, its request, and `retryable`
   * when Retry is offered on it: it is the conversation's newest turn, and one the engine will run
   * again for you (a worker's message it was answering is not).
   */
  | { kind: "failed"; id: string; requestId: string; reason: string; code?: string; details?: Record<string, unknown>; retryable: boolean }
  /** The worker messaged another worker (`sendMessage`). */
  | { kind: "sent"; id: string; messageId: string; to: string; text: string }
  /** A message another worker sent, as the `receive` turn that read it. */
  | { kind: "received"; id: string; messageId: string; from: string; text: string; inReplyTo?: string; noAnswer?: boolean }
  /** The worker filed a task; the card reads the board's row by its id, and draws `title` until the row arrives. */
  | { kind: "task"; id: string; taskId: string; title: string; to: string }
  /** A task it filed ended, as a line under the name of the worker that ran it; `title` is the task's, once its row is read. */
  | { kind: "result"; id: string; taskId: string; from: string; text: string; title?: string; failed?: boolean; cancelled?: boolean }
  /** The worker waits for your yes (`suspendForUser` with an approval); `resolution` once answered. */
  | { kind: "approval"; id: string; requestId: string; suspensionId: string; text: string; resolution?: string }
  /** A run of tool calls one turn made in a row, drawn inline as one line ({@link StepRun}) that opens to each. */
  | ({ kind: "steps"; id: string; steps: SessionStep[] } & StepRun)
  /** A turn you stopped: its request ended `aborted`. It follows that turn's last entry. */
  | { kind: "stopped"; id: string; requestId: string };

/** What a conversation shows now. */
export interface ConversationView {
  entries: ConversationEntry[];
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
 * The request sources the engine retries for a caller (`PUBLIC_REENTRY_SOURCES`): a turn that came
 * in another way, such as a worker's message (`internal`) or a task's run (`task`), it refuses.
 * A copy, since the page can't import the engine; a test pins it to the engine's.
 */
export const RETRYABLE_SOURCES: ReadonlySet<string> = new Set(["http", "mcp", "scheduled"]);

/** The tool a worker files a task with. */
const CREATE_TASK = "createTask";

/**
 * A conversation's items as the entries the screen draws. `ended` names the
 * requests the server lists as over: a step their turn left running (a turn
 * that crashed mid-call) reads failed, not running for good. A failed turn's
 * `error` item is a failed entry, `retryable` when it is the newest turn that drew one and one of
 * `retryableTurns`, the requests the engine will retry.
 */
export function toEntries(
  items: readonly Item[],
  workers: ReadonlySet<string>,
  ended: readonly string[] = [],
  retryableTurns: ReadonlySet<string> = new Set(),
  stopped: readonly string[] = [],
): ConversationEntry[] {
  // The latest copy of each board row the items carry (`task-change`): what a task's ending line says.
  const copies = new Map(items.flatMap((item) => (item.type === "data" && item.dataType === "task-change" && item.value?.task?.id ? [[item.value.task.id as string, item.value.task as Record<string, any>] as const] : [])));
  const entries: ConversationEntry[] = [];
  /** The turn the last run of steps belongs to: a run never spans two. */
  let runTurn: unknown;
  // A turn that failed; its reply, if it never finished, is marked incomplete.
  const failedTurns = new Set(items.filter((item) => item.type === "error").map((item) => item.requestId));
  /** The newest turn that drew an entry: a board pass that drew none is not a turn you saw. Retry is offered on it only. */
  let newestTurn: unknown;
  const drawEntry = (item: Item): void => {
    if (item.type === "error") {
      entries.push({
        kind: "failed",
        id: item.id,
        requestId: item.requestId,
        reason: typeof item.message === "string" ? item.message : "",
        ...(typeof item.code === "string" ? { code: item.code } : {}),
        ...(item.details === undefined ? {} : { details: item.details }),
        retryable: false,
      });
    } else if (item.type === "message" && item.role === "user") {
      const files = filesOf(item);
      entries.push({ kind: "user", id: item.id, text: textOf(item), ...(files.length > 0 ? { files } : {}) });
    } else if (item.type === "message" && item.role === "assistant" && workers.has(item.agentName)) {
      // A task it filed ended: the board's line under the worker that ran it, which names its task
      // in its data. A completed task's answer said as is (`resultTo: "conversation"`) names the
      // task it answered; one stored before answers were marked names none.
      const notice = parseNotice(item);
      const taskId = notice?.taskId ?? delegateAnswerOf(item)?.taskId ?? "";
      const copy = copies.get(taskId);
      // An answer is a finished task, never one drawn as failed.
      const cancelled = copy?.status === "cancelled";
      const failed = notice !== undefined && copy?.status !== "completed" && !cancelled;
      entries.push({
        kind: "result",
        id: item.id,
        taskId,
        from: item.agentName,
        text: answerTextOf(copy?.output) ?? (typeof copy?.error === "string" ? copy.error : undefined) ?? textOf(item),
        ...(copy === undefined ? {} : { title: copy.title ?? copy.goal ?? copy.id }),
        ...(failed ? { failed: true } : {}),
        ...(cancelled ? { cancelled: true } : {}),
      });
    } else if (item.type === "message" && item.role === "assistant") {
      const text = textOf(item);
      const incomplete = failedTurns.has(item.requestId) && item.status !== "completed";
      if (text.trim() !== "")
        entries.push({ kind: "assistant", id: item.id, text, ...(incomplete ? { incomplete: true } : item.status === "in_progress" ? { streaming: true } : {}) });
    } else if (item.type === "tool_output" && item.toolCall?.name === SEND_MESSAGE_TOOL && sentTo(item) !== undefined) {
      const args = parseArgs(item);
      entries.push({ kind: "sent", id: item.id, messageId: item.output.sent, to: String(args.to), text: String(args.text ?? "") });
    } else if (item.type === "tool_output" && item.toolCall?.name === CREATE_TASK && item.output?.ok === true) {
      const args = parseArgs(item);
      entries.push({ kind: "task", id: item.id, taskId: item.output.taskId, title: String(args.title ?? args.goal ?? ""), to: String(args.assignee ?? "") });
    } else if (item.type === "tool_output" && typeof item.toolCall?.name === "string") {
      // Any other call is a step of the turn, inline: a call in a row with the last one, in the same turn, joins its run.
      const step = toolStep(item, ended);
      const last = entries[entries.length - 1];
      if (last?.kind === "steps" && runTurn === item.requestId) {
        const steps = [...last.steps, step];
        entries[entries.length - 1] = { kind: "steps", id: last.id, steps, ...stepRun(steps) };
      } else {
        entries.push({ kind: "steps", id: item.id, steps: [step], ...stepRun([step]) });
        runTurn = item.requestId;
      }
    } else if (item.type === "suspension" && item.reason === "user_approval") {
      entries.push({ kind: "approval", id: item.id, requestId: item.requestId, suspensionId: item.suspensionId, text: item.message });
    } else if (item.type === "suspension_resume") {
      const asked = entries.find((e) => e.kind === "approval" && e.suspensionId === item.suspensionId);
      if (asked?.kind === "approval") asked.resolution = item.resolution;
    } else if (item.type === "data" && item.dataType === RECEIVED_MESSAGE_DATA_TYPE) {
      const { id, from, text, inReplyTo, noAnswer } = item.value ?? {};
      entries.push({ kind: "received", id: item.id, messageId: id, from, text, ...(inReplyTo === undefined ? {} : { inReplyTo }), ...(noAnswer === true ? { noAnswer: true } : {}) });
    }
  };
  /** How many entries there were once each stopped turn's last item was read: its line goes there. */
  const endOf = new Map<string, number>();
  for (const item of items) {
    const drawn = entries.length;
    const lastBefore = entries[drawn - 1];
    drawEntry(item);
    if (entries.length !== drawn) newestTurn = item.requestId;
    const grew = entries.length > drawn || entries[entries.length - 1] !== lastBefore;
    if (grew && stopped.includes(item.requestId)) endOf.set(item.requestId, entries.length);
  }
  const marked = entries.map((entry) =>
    entry.kind === "failed" && entry.requestId === newestTurn && retryableTurns.has(entry.requestId) ? { ...entry, retryable: true } : entry,
  );
  // From the end, so each place is still where it was counted.
  for (const [requestId, at] of [...endOf].sort((a, b) => b[1] - a[1])) {
    marked.splice(at, 0, { kind: "stopped", id: `stopped:${requestId}`, requestId });
  }
  return marked;
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
export function answeringOf(items: readonly Item[], inProgress: readonly string[], ended: readonly string[] = []): boolean {
  // Only the newest request, or one the list names: an item a crashed turn left half-written stays so for good.
  const newest = items[items.length - 1]?.requestId;
  const live = (requestId: string) => inProgress.includes(requestId) || (requestId === newest && !ended.includes(requestId));
  return inProgress.length > 0 || items.some((i) => i.status === "in_progress" && live(i.requestId));
}

/** Where the turns the worker reads word for word begin. */
export interface WindowMark {
  /** The first entry inside the history window. Entries before it are out of the worker's view. */
  firstVerbatimEntryId: string;
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
