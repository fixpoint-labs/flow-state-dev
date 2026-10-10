/**
 * The child-finished signal: how a task's ending becomes one notice to the
 * conversation that filed it (FIX-1794 P2, S6 and S7), and, for an asked row,
 * the resume of the turn that waits on it (FIX-1816 S9).
 *
 * Pure functions over a board row and the notice it owes. Nothing here reads
 * a store, runs a block or knows a worker, a delegate or a conversation. It
 * was built in Workforce and lifted here as it stood, and a test fails if it
 * ever imports from outside orchestration's task types.
 *
 * ## The row is the outbox
 *
 * Every write that records an ending runs {@link recordEnding} inside that
 * same write (the ledger's ending recorder), which puts a notice-owed marker
 * in the row's `metadata`, one per (attempt, ending). The ending and the debt
 * to tell someone land together or not at all, so a crash after the ending is
 * stored and before the notice is sent leaves the marker, and the next touch
 * of the board sends it ({@link owedNotices}). Only the notice's delivery
 * clears its marker ({@link clearNotice}), and a clear names one marker, so it
 * can't erase a later ending's.
 *
 * Every producer of an ending reaches it the same way, because they all write
 * through the ledger: the task session's gate settling the attempt it ran, the
 * board refusing a hand-off, and the board settling a row whose worker died
 * too often. A cancel owes no notice, and neither does a park that asks nobody
 * anything (a park the board makes for its own reasons, or one for a person's
 * turn): {@link recordEnding} returns those rows unchanged. An asked row is
 * the exception for a cancel: its turn waits on every ending, so a cancel owes
 * the notice that resumes it.
 *
 * ## What an ending does
 *
 * {@link decideNotice} is the one choice: a retried attempt runs the board
 * again with no turn; an asked row's ending resumes the turn parked on it
 * (`waitForResponse`) and wakes none; any other ending wakes the coordinator's
 * judgment turn, or lands as a line under a fixed routing policy. The
 * receiving entry only acts on the value. {@link noticeKey} is the dedupe key,
 * task and attempt and ending, so a notice sent twice (a replay racing the
 * first send) is acted on once.
 */
import type { Task } from "../schema/task";
import type { TaskEnding } from "../collection/ending";

/**
 * The endings a conversation hears about. A cancel is one only for an asked
 * row, whose waiting turn must hear every ending (BR-29 otherwise).
 */
export type NoticeEnding = "completed" | "errored" | "parked" | "retried" | "cancelled";

/**
 * One notice: plain data, the same whether the task session sends it or a
 * replay does. `output` rides a completion, `error` a failure, `question` a
 * park.
 */
export interface TaskNotice {
  /** The ledger the task is on, by id. */
  readonly boardId: string;
  readonly taskId: string;
  /** The attempt that ended. */
  readonly attempt: number;
  readonly ending: NoticeEnding;
  readonly output?: unknown;
  readonly error?: string;
  readonly question?: string;
  /** The row is asked (`waitForResponse`): a turn is parked on its ending. */
  readonly asked?: true;
}

/** The marker each owed notice is kept under, in the row's metadata. */
const OWED_PREFIX = "noticeOwed:";

/** What a marker holds: enough to rebuild the notice from the row it is on. */
interface OwedMarker {
  readonly attempt: number;
  readonly ending: NoticeEnding;
  readonly error?: string;
  readonly question?: string;
}

function markerKey(attempt: number, ending: NoticeEnding): string {
  return `${OWED_PREFIX}${attempt}:${ending}`;
}

/** The marker an ending owes, or `undefined` when it owes none. */
function markerFor(row: Task, ending: TaskEnding): OwedMarker | undefined {
  switch (ending.kind) {
    case "completed":
      return { attempt: row.attempts, ending: "completed" };
    case "errored":
      return { attempt: row.attempts, ending: "errored", error: ending.error };
    case "retried":
      return { attempt: row.attempts, ending: "retried", error: ending.error };
    case "parked":
      if (ending.quiet) return undefined;
      return {
        attempt: row.attempts,
        ending: "parked",
        ...(ending.question !== undefined ? { question: ending.question } : {})
      };
    case "cancelled":
      // Only an asked row's turn hears a cancel: it waits on every ending.
      return row.ask != null ? { attempt: row.attempts, ending: "cancelled" } : undefined;
  }
}

/**
 * Record an ending: the row to write in the one write that records it, with
 * the notice it owes marked. A cancel of a row nobody waits on, and a park
 * that asks nobody anything, owe none and come back unchanged.
 *
 * The ledger's ending recorder: every write that records an ending runs it
 * inside that write. Callable on its own too, for a write that parks a row for
 * its own reasons (`{ kind: "parked", quiet: true }`), which owes nothing.
 *
 * @param row The row as the ending's write builds it.
 * @param ending What the ending was.
 */
export function recordEnding(row: Task, ending: TaskEnding): Task {
  const marker = markerFor(row, ending);
  if (marker === undefined) return row;
  return { ...row, metadata: { ...(row.metadata ?? {}), [markerKey(marker.attempt, marker.ending)]: marker } };
}

function isMarker(key: string, value: unknown): value is OwedMarker {
  return key.startsWith(OWED_PREFIX) && value !== null && typeof value === "object";
}

/**
 * The notices a row still owes, oldest attempt first, each rebuilt from its
 * marker and the row: a completion's output is the row's own, which is final
 * once completed.
 *
 * @param row The row, as the board holds it now.
 * @param boardId The ledger it is on.
 */
export function owedNotices(row: Task, boardId: string): TaskNotice[] {
  const notices: TaskNotice[] = [];
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (!isMarker(key, value)) continue;
    notices.push({
      boardId,
      taskId: row.id,
      attempt: value.attempt,
      ending: value.ending,
      ...(value.ending === "completed" ? { output: row.output } : {}),
      ...(value.error !== undefined ? { error: value.error } : {}),
      ...(value.question !== undefined ? { question: value.question } : {}),
      ...(row.ask != null ? { asked: true as const } : {})
    });
  }
  return notices.sort((a, b) => a.attempt - b.attempt);
}

/** Whether `row` still owes `notice`: its marker is there and not cleared. */
export function isNoticeOwed(row: Task, notice: Pick<TaskNotice, "attempt" | "ending">): boolean {
  const value = (row.metadata ?? {})[markerKey(notice.attempt, notice.ending)];
  return value !== null && value !== undefined;
}

/**
 * The metadata patch that clears one notice's marker, and only that one: a
 * later ending's marker, written between the read and this write, survives.
 */
export function clearNotice(notice: Pick<TaskNotice, "attempt" | "ending">): Record<string, null> {
  return { [markerKey(notice.attempt, notice.ending)]: null };
}

/**
 * The dedupe key a notice is acted on once by: its task, its attempt and its
 * ending. A replay of a notice already acted on has the same key.
 */
export function noticeKey(notice: Pick<TaskNotice, "taskId" | "attempt" | "ending">): string {
  return `${notice.taskId}:${notice.attempt}:${notice.ending}`;
}

/** How the conversation routes: by its coordinator's judgment, or by a fixed policy. */
export type NoticePolicy = "judgment" | "fixed";

/** What an ending does in the conversation that filed the task. */
export type NoticeDecision =
  /** A retried attempt: run the board again, so the next attempt starts. No turn. */
  | { readonly act: "run-board" }
  /** An ending: the coordinator's judgment turn reads it and decides. */
  | { readonly act: "wake-turn" }
  /** An ending, under a fixed policy: a line in the conversation. */
  | { readonly act: "line" }
  /**
   * An asked row's ending: resume the turn parked on it through the request
   * host's ask resume (`resumeOwedAsks`), with no turn woken and no line: the
   * answer is the waiting call's result.
   */
  | { readonly act: "resume-ask" };

/** The one choice of what a notice does. */
export function decideNotice(notice: Pick<TaskNotice, "ending" | "asked">, policy: NoticePolicy): NoticeDecision {
  if (notice.ending === "retried") return { act: "run-board" };
  if (notice.asked === true) return { act: "resume-ask" };
  return policy === "judgment" ? { act: "wake-turn" } : { act: "line" };
}

/** The longest output summary a notice's text carries. */
const SUMMARY_LIMIT = 500;

function summary(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT)}…` : text;
}

/**
 * A notice in words, for the turn it wakes or the line it lands as: the task,
 * how it ended, and what came back.
 *
 * @param task The row's goal (or title) and its assignee.
 */
export function noticeText(
  notice: TaskNotice,
  task: { readonly goal: string; readonly title?: string; readonly assignee?: string }
): string {
  const named = `Task "${task.title ?? task.goal}" (${notice.taskId})`;
  const worker = task.assignee ?? "its worker";
  switch (notice.ending) {
    case "completed":
      return `${named} completed by ${worker}: ${summary(notice.output ?? null)}`;
    case "errored":
      return `${named} failed for good with ${worker}: ${notice.error ?? "no error was recorded"}`;
    case "parked":
      return `${named} is waiting on a question from ${worker}: ${notice.question ?? "no question was recorded"}`;
    case "retried":
      return `${named} failed with ${worker} and runs again: ${notice.error ?? "no error was recorded"}`;
    case "cancelled":
      return `${named} was cancelled`;
  }
}

/**
 * Metadata a caller hands in, without any notice marker: a filing or a patch
 * can't forge a debt or clear one. `undefined` stays `undefined`.
 */
export function withoutNoticeMarkers(
  metadata: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !key.startsWith(OWED_PREFIX)));
}
