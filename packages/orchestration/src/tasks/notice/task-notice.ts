/**
 * The child-finished signal: how a delegated task's ending becomes one notice
 * to the session that filed it (FIX-1794 P2, S6 and S7; FIX-2078).
 *
 * Pure functions over a board row and the notice it owes. Nothing here reads
 * a store, runs a block or knows a worker, a delegate or a conversation, and a
 * test fails if it ever imports from outside orchestration's task types.
 *
 * ## The row is the outbox
 *
 * Every write that records an ending on a board that hands rows out runs
 * {@link recordEnding} inside that same write, which puts a notice-owed marker
 * in the row's `metadata`, one per (attempt, ending), with the time it is due.
 * The ending and the debt to tell someone land together or not at all, so a
 * crash after the ending is stored and before the notice is sent leaves the
 * marker, and a wake in the filer's session pays it (`./delivery`). Only the
 * filer's delivery clears a marker ({@link clearNotice}), and a clear names one
 * marker, so it can't erase a later ending's.
 *
 * ## Which endings owe a notice (FIX-2078 D2)
 *
 * A completion, a final failure and a park that asks someone something each
 * owe one. A cancel owes one too, unless the filer already knows of it:
 *
 * - the filer made it in its own request, through a model's task tool inside
 *   its own turn: the call's result told it. A public `_tasks` action, a
 *   user's cancel from a screen and a cancel cascaded from above the filer
 *   each owe one;
 * - it is a dependent's cancel cascaded from a failed or cancelled row that
 *   shares its filer: that row's own notice names it ({@link TaskNotice.cancelled}).
 *
 * A retry owes none: it is the row's start, not its ending. A waited-on row
 * owes none either: the turn waiting on it is resumed instead
 * (`Task.resumeOwed`), and no notice runs for it.
 *
 * ## What an ending does
 *
 * {@link decideNotice} is the one choice: a waited-on row's ending resumes the
 * turn parked on it, and any other wakes the filer's judgment turn, or lands
 * as a line under a fixed routing policy. A retried notice, which only a row
 * stored before FIX-2078 can still owe, runs the board. {@link noticeKey} is
 * the dedupe key, task and attempt and ending, so a notice sent twice is acted
 * on once.
 */
import type { Task } from "../schema/task";
import type { TaskEnding } from "../collection/ending";

/**
 * The endings a filer hears about. `retried` is read only off a marker stored
 * before FIX-2078, which recorded one.
 */
export type NoticeEnding = "completed" | "errored" | "parked" | "retried" | "cancelled";

/**
 * One notice: plain data, the same whether the ending's writer sends it or the
 * filer's pass sends it again. `output` rides a completion, `error` a failure,
 * `question` a park.
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
  /** The row is waited on: a turn is parked on its ending (read off a marker stored before FIX-2078). */
  readonly asked?: true;
  /**
   * On a failure or a cancel: the dependents this ending cancelled that share
   * its filer, by id (FIX-2078 D2). They owe no notice of their own.
   */
  readonly cancelled?: readonly string[];
}

/** How long after its ending's write a notice falls due: the fast path pays it first. */
export const NOTICE_DUE_MS = 2_000;

/** The marker each owed notice is kept under, in the row's metadata. */
const OWED_PREFIX = "noticeOwed:";

/**
 * Where a pass records that it sent an owed notice again: when, and how many
 * times. Kept beside the marker, never in it, so a resend can't bring back a
 * marker its entry cleared meanwhile.
 */
const RESENT_PREFIX = "noticeResent:";

/** The longest a pass waits between two resends of one notice: 5 minutes. */
const NOTICE_RESEND_CAP_MS = 300_000;

/** What a marker holds: enough to rebuild the notice from the row it is on. */
interface OwedMarker {
  readonly attempt: number;
  readonly ending: NoticeEnding;
  readonly error?: string;
  readonly question?: string;
  /** When it falls due (epoch ms). Absent on a marker stored before FIX-2078: due at once. */
  readonly due?: number;
}

function markerKey(attempt: number, ending: NoticeEnding): string {
  return `${OWED_PREFIX}${attempt}:${ending}`;
}

/** What the ending's write knows that its row can't say (FIX-2078 D2). */
export interface NoticeRecording {
  /** The filer made this cancel itself, through its model's task tool in its own turn. */
  readonly ownCancel?: boolean;
  /** For a cascaded cancel: whether the row whose ending caused it shares this row's filer. */
  readonly causeSharesFiler?: boolean;
}

/** The marker an ending owes, or `undefined` when it owes none (see the module header). */
function markerFor(row: Task, ending: TaskEnding, recording: NoticeRecording = {}): OwedMarker | undefined {
  // A waited-on row's turn is resumed instead.
  if (row.wait != null) return undefined;
  const due = row.updatedAt + NOTICE_DUE_MS;
  switch (ending.kind) {
    case "completed":
      return { attempt: row.attempts, ending: "completed", due };
    case "errored":
      return { attempt: row.attempts, ending: "errored", error: ending.error, due };
    case "retried":
      return undefined;
    case "parked":
      if (ending.quiet) return undefined;
      return {
        attempt: row.attempts,
        ending: "parked",
        ...(ending.question !== undefined ? { question: ending.question } : {}),
        due
      };
    case "cancelled":
      if (recording.ownCancel === true) return undefined;
      if (row.causedBy !== undefined && recording.causeSharesFiler === true) return undefined;
      return { attempt: row.attempts, ending: "cancelled", due };
  }
}

/**
 * Record an ending: the row to write in the one write that records it, with
 * the notice it owes marked. An ending that owes none comes back unchanged.
 *
 * Orchestration's own recorder on a board that hands rows out: every write
 * that records an ending there runs it inside that write.
 *
 * @param row The row as the ending's write builds it.
 * @param ending What the ending was.
 * @param recording What the write knows about a cancel.
 */
export function recordEnding(row: Task, ending: TaskEnding, recording?: NoticeRecording): Task {
  const marker = markerFor(row, ending, recording);
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
 * @param rows The board's rows, to name a failure's or a cancel's cancelled
 *   dependents (FIX-2078 D2). Omitted, the notice names none.
 * @param filerOf The board's filer resolver (see {@link cancelledDependents}).
 */
export function owedNotices(
  row: Task,
  boardId: string,
  rows?: readonly Task[],
  filerOf?: (row: Task) => string | undefined
): TaskNotice[] {
  const notices: TaskNotice[] = [];
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (!isMarker(key, value)) continue;
    const cancelled =
      rows !== undefined && (value.ending === "errored" || value.ending === "cancelled")
        ? cancelledDependents(row, rows, filerOf)
        : [];
    notices.push({
      boardId,
      taskId: row.id,
      attempt: value.attempt,
      ending: value.ending,
      ...(value.ending === "completed" ? { output: row.output } : {}),
      ...(value.error !== undefined ? { error: value.error } : {}),
      ...(value.question !== undefined ? { question: value.question } : {}),
      ...(row.wait != null ? { asked: true as const } : {}),
      ...(cancelled.length > 0 ? { cancelled } : {})
    });
  }
  return notices.sort((a, b) => a.attempt - b.attempt);
}

/**
 * Whether `row` still owes any notice. The boolean form of
 * {@link owedNotices}, with an early exit and no notice built: what a check
 * run at every request's end asks of every row a task filed (FIX-2077).
 */
export function owesAnyNotice(row: Task): boolean {
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (isMarker(key, value)) return true;
  }
  return false;
}

/**
 * When the earliest notice `row` owes falls due, or `undefined` when it owes
 * none. A marker stored before FIX-2078 carries no due time: it is due at once.
 */
export function noticeDueAt(row: Task): number | undefined {
  let due: number | undefined;
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (!isMarker(key, value)) continue;
    const at = nextSendAt(row, value);
    due = due === undefined ? at : Math.min(due, at);
  }
  return due;
}

/** A notice's resend record, when a pass has sent it again. */
function resentOf(row: Task, attempt: number, ending: NoticeEnding): { at: number; n: number } | undefined {
  const value = (row.metadata ?? {})[`${RESENT_PREFIX}${attempt}:${ending}`] as { at?: unknown; n?: unknown } | null | undefined;
  return value != null && typeof value.at === "number" && typeof value.n === "number" ? { at: value.at, n: value.n } : undefined;
}

/**
 * When a marker's notice is next sent: its due time, or, once a pass has sent
 * it again `n` times, the last resend plus `NOTICE_DUE_MS · 2^n`, at most
 * {@link NOTICE_RESEND_CAP_MS}. A copy sent within that gap is taken to be on
 * its way.
 */
function nextSendAt(row: Task, marker: OwedMarker): number {
  const resent = resentOf(row, marker.attempt, marker.ending);
  if (resent === undefined) return marker.due ?? 0;
  return resent.at + Math.min(NOTICE_DUE_MS * 2 ** resent.n, NOTICE_RESEND_CAP_MS);
}

/**
 * When `notice` first fell due, and when it is next sent (see `nextSendAt`).
 * `undefined` when `row` no longer owes it. Its age counts from `due`.
 */
export function noticeTimes(row: Task, notice: Pick<TaskNotice, "attempt" | "ending">): { due: number; next: number } | undefined {
  const key = markerKey(notice.attempt, notice.ending);
  const value = (row.metadata ?? {})[key];
  if (!isMarker(key, value)) return undefined;
  return { due: value.due ?? 0, next: nextSendAt(row, value) };
}

/** The metadata patch that records one more resend of `notice` at `now`. */
export function resentRecord(row: Task, notice: Pick<TaskNotice, "attempt" | "ending">, now: number): Record<string, unknown> {
  const n = (resentOf(row, notice.attempt, notice.ending)?.n ?? 0) + 1;
  return { [`${RESENT_PREFIX}${notice.attempt}:${notice.ending}`]: { at: now, n } };
}

/**
 * The dependents `row`'s ending cancelled that share its filer, by id: the
 * rows whose cascaded cancel names it (`causedBy`), filed by the same session.
 *
 * @param filerOf Who filed a row, by the same rule the cascade decided "shares
 *   the filer" by, when it owed the dependent no notice of its own: the board's
 *   delivery resolver, which reads a row filed before `Task.filer` by its
 *   legacy filer (BP-030). Default: `Task.filer` alone.
 */
export function cancelledDependents(
  row: Task,
  rows: readonly Task[],
  filerOf: (row: Task) => string | undefined = (task) => task.filer?.sessionId
): string[] {
  const filer = filerOf(row);
  return rows
    .filter((other) => other.status === "cancelled" && other.causedBy === row.id && filerOf(other) === filer)
    .map((other) => other.id);
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
   * A waited-on row's ending, owed by a marker stored before FIX-2078: resume
   * the turn parked on it in the filer's pass, with no turn woken and no line:
   * the answer is the waiting call's result.
   */
  | { readonly act: "resume-wait" };

/** The one choice of what a notice does. */
export function decideNotice(notice: Pick<TaskNotice, "ending" | "asked">, policy: NoticePolicy): NoticeDecision {
  if (notice.ending === "retried") return { act: "run-board" };
  if (notice.asked === true) return { act: "resume-wait" };
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
  // The dependents its ending cancelled, which owe no notice of their own (D2).
  const cascade =
    notice.cancelled !== undefined && notice.cancelled.length > 0
      ? `; it cancelled the tasks that depended on it: ${notice.cancelled.join(", ")}`
      : "";
  switch (notice.ending) {
    case "completed":
      return `${named} completed by ${worker}: ${summary(notice.output ?? null)}`;
    case "errored":
      return `${named} failed for good with ${worker}: ${notice.error ?? "no error was recorded"}${cascade}`;
    case "parked":
      return `${named} is waiting on a question from ${worker}: ${notice.question ?? "no question was recorded"}`;
    case "retried":
      return `${named} failed with ${worker} and runs again: ${notice.error ?? "no error was recorded"}`;
    case "cancelled":
      return `${named} was cancelled${cascade}`;
  }
}

/** The metadata key a notice settled undeliverable is recorded under, on its row. */
export const UNDELIVERABLE_PREFIX = "noticeUndeliverable:";

/**
 * Metadata a caller hands in, without any notice marker or undeliverable
 * record: a filing or a patch can't forge a debt, clear one, or mark one
 * settled (BP-031). `undefined` stays `undefined`.
 */
export function withoutNoticeMarkers(
  metadata: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !key.startsWith(OWED_PREFIX) && !key.startsWith(UNDELIVERABLE_PREFIX) && !key.startsWith(RESENT_PREFIX)
    )
  );
}
