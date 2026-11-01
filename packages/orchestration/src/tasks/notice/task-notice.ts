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
 * owes none either: the request parked on it is resumed instead
 * (`Task.resumeOwed`), and no notice runs for it. A row that ended before its
 * filer's wait on it was made owes one at its ending, and the wait that finds
 * it ended drops it ({@link deliveredByWait}): the wait's answer delivered it.
 *
 * ## A notice is taken before it runs (FIX-2123)
 *
 * The filer's `onTaskSettled` takes a notice before it runs the flow's block,
 * in one conditional write that records its request beside the marker
 * ({@link takenNoticePatch}). A wait's drop and that take are writes to the
 * same row, each conditional on the other not having happened, so exactly one
 * goes through: a wait leaves a taken marker alone ({@link deliveredByWait})
 * and answers that the ending arrives as a notice ({@link noticeTakenByAnother}),
 * until the request that took it has delivered it and ended. A
 * taken marker is still owed, and the filer's pass still sends it again: a
 * copy finds it taken and runs nothing while the request that took it runs,
 * and takes it over once that request has ended without clearing it (its
 * block failed, or its process died).
 *
 * ## An ending held for the request that waited (FIX-2082)
 *
 * A wait's deadline lapses the row's wait slot rather than clearing it. An
 * ending written onto a lapsed slot owes the filer's notice, **held**: no fast
 * path sends it and no pass resends it, while the request that waited runs.
 * That request's next read of the row is its delivery, and drops the held
 * marker ({@link droppedHeldNotices}). If it ends without reading the row, the
 * held marker is released, due then ({@link releasedHeldNotices}), and the
 * filer hears it once, as any other ending. A held marker still counts as owed
 * ({@link owesAnyNotice}): the task that filed the row is not done.
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
export type NoticeEnding = "completed" | "errored" | "retried" | "cancelled";

/**
 * One notice: plain data, the same whether the ending's writer sends it or the
 * filer's pass sends it again. `output` rides a completion, `error` a failure.
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
  /** The row is waited on: a turn is parked on its ending (read off a marker stored before FIX-2078). */
  readonly waitedOn?: true;
  /**
   * On a failure or a cancel: the dependents this ending cancelled that share
   * its filer, by id (FIX-2078 D2). They owe no notice of their own.
   */
  readonly cancelled?: readonly string[];
}

/** How long after its ending's write a notice falls due: the fast path pays it first. */
export const NOTICE_DUE_MS = 2_000;

/**
 * How often a filer's pass looks again at a wait slot that lapsed for a
 * request still running (FIX-2082): the slot is released by the pass after
 * that request parks (FIX-2170) or ends, so an ending held for it is never
 * stranded. The wake a park owes and the release at the request's end in its
 * own process come first; this is what pays it when that process is gone. Thirty seconds, the age at which a
 * request whose process died is marked interrupted. The first look; later
 * ones come less often ({@link LAPSED_SLOT_CHECK_CAP_MS}).
 */
export const LAPSED_SLOT_CHECK_MS = 30_000;

/**
 * The longest the filer's pass goes between looks at a lapsed wait slot whose
 * request still runs or is parked: one hour. The gap grows with the slot's
 * age, from {@link LAPSED_SLOT_CHECK_MS}, until it reaches this.
 */
export const LAPSED_SLOT_CHECK_CAP_MS = 3_600_000;

/** The marker each owed notice is kept under, in the row's metadata. */
const OWED_PREFIX = "noticeOwed:";

/**
 * Where a pass records that it sent an owed notice again: when, and how many
 * times. Kept beside the marker, never in it, so a resend can't bring back a
 * marker its entry cleared meanwhile.
 */
const RESENT_PREFIX = "noticeResent:";

/**
 * Where a busy session records that it turned an owed notice away (FIX-2113:
 * `taskSettledEntry`'s `defer`), and when. That is no failed delivery, so the
 * notice's age, which ends it at the maximum debt age, counts from then. Kept
 * beside the marker, never in it, as a resend record is, so the write can't
 * bring back a marker its entry cleared meanwhile.
 */
const DEFERRED_PREFIX = "noticeDeferred:";

/** The longest a pass waits between two resends of one notice or message: 5 minutes. */
export const NOTICE_RESEND_CAP_MS = 300_000;

/** What a marker holds: enough to rebuild the notice from the row it is on. */
interface OwedMarker {
  readonly attempt: number;
  readonly ending: NoticeEnding;
  readonly error?: string;
  readonly question?: string;
  /** When it falls due (epoch ms). Absent on a marker stored before FIX-2078: due at once. */
  readonly due?: number;
  /**
   * Held for the request whose wait on the row lapsed (FIX-2082): sent by no
   * fast path and no pass until it is released. Absent on every other marker.
   */
  readonly held?: true;
}

/**
 * Where the `onTaskSettled` request delivering an owed notice records that it
 * took it (FIX-2123), by its request id, server-written, and when. Kept beside
 * the marker, as a resend record is, and left when the marker clears: a wait
 * reads it to tell that the request delivering the ending still runs. Absent
 * for a notice no request has taken, and for every notice owed before FIX-2123.
 */
const TAKEN_PREFIX = "noticeTaken:";

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
  // A waited-on row's request is resumed instead; a lapsed wait's ending is
  // held for the request that waited (FIX-2082).
  if (row.wait != null && row.wait.lapsed !== true) return undefined;
  const marker = plainMarkerFor(row, ending, recording);
  return marker === undefined || row.wait == null ? marker : { ...marker, held: true };
}

function plainMarkerFor(row: Task, ending: TaskEnding, recording: NoticeRecording): OwedMarker | undefined {
  const due = row.updatedAt + NOTICE_DUE_MS;
  switch (ending.kind) {
    case "completed":
      return { attempt: row.attempts, ending: "completed", due };
    case "errored":
      return { attempt: row.attempts, ending: "errored", error: ending.error, due };
    case "retried":
      return undefined;
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

/** A marker a sender may send: owed, and not held for a request that waited (FIX-2082). */
function isSendable(key: string, value: unknown): value is OwedMarker {
  return isMarker(key, value) && value.held !== true;
}

/**
 * The request that took a notice (FIX-2123), off its take record, read
 * tolerantly: anything but a well-formed record reads as none.
 */
function takerOf(row: Task, attempt: number, ending: NoticeEnding): string | undefined {
  const taken = (row.metadata ?? {})[`${TAKEN_PREFIX}${attempt}:${ending}`] as { by?: unknown } | null | undefined;
  return taken != null && typeof taken.by === "string" ? taken.by : undefined;
}

/**
 * The request that took `notice` to deliver it (FIX-2123), or `undefined` when
 * `row` no longer owes it, or owes it and no request has taken it.
 */
export function noticeTakenBy(row: Task, notice: Pick<TaskNotice, "attempt" | "ending">): string | undefined {
  const key = markerKey(notice.attempt, notice.ending);
  return isSendable(key, (row.metadata ?? {})[key]) ? takerOf(row, notice.attempt, notice.ending) : undefined;
}

/**
 * The metadata patch that takes `notice` for the request `take.by` (FIX-2123):
 * its take record, naming that request. Empty when `row` doesn't owe it, or
 * another request holds it: one other than `take.replacing`, the taker its
 * caller found had ended. Run inside the write that commits it, on the row as
 * stored.
 */
export function takenNoticePatch(
  row: Task,
  notice: Pick<TaskNotice, "attempt" | "ending">,
  take: { readonly by: string; readonly at: number; readonly replacing?: string }
): Record<string, { by: string; at: number }> {
  const key = markerKey(notice.attempt, notice.ending);
  if (!isSendable(key, (row.metadata ?? {})[key])) return {};
  const taker = takerOf(row, notice.attempt, notice.ending);
  if (taker !== undefined && taker !== take.by && taker !== take.replacing) return {};
  return { [`${TAKEN_PREFIX}${notice.attempt}:${notice.ending}`]: { by: take.by, at: take.at } };
}

/**
 * The request other than `requestId` (the one asking) that took the notice
 * for the ending `row` holds (FIX-2123), and whether that notice is still
 * owed; `undefined` when no other request took it. A wait answers that the
 * ending arrives as a notice while that notice is being delivered: still owed
 * (under way, or its taker failed and it goes again), or cleared by a taker
 * that still runs (a host may acknowledge before the turn it wakes). A taker
 * that is parked (waiting on a person, say) still counts as handling it, so a
 * wait answers `arrivesAsNotice` until that taker ends. Once it
 * is cleared and its taker has ended, it has been heard and nothing more is
 * coming (FIX-2181): the wait answers with the row, as a read of it does.
 */
export function noticeTakenByAnother(row: Task, requestId: string): { readonly by: string; readonly owed: boolean } | undefined {
  if (row.status !== "completed" && row.status !== "errored" && row.status !== "cancelled") return undefined;
  const by = takerOf(row, row.attempts, row.status);
  if (by === undefined || by === requestId) return undefined;
  const key = markerKey(row.attempts, row.status);
  return { by, owed: isMarker(key, (row.metadata ?? {})[key]) };
}

/**
 * Whether `row` owes a notice no request has taken (FIX-2123): one that a
 * send now would deliver. What the request that filed `row` sends as it ends.
 */
export function owesUntakenNotice(row: Task): boolean {
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (isSendable(key, value) && takerOf(row, value.attempt, value.ending) === undefined) return true;
  }
  return false;
}

/**
 * The metadata patch that drops every held marker on `row` (FIX-2082): the
 * request it was held for read the row, which delivered the ending.
 */
export function droppedHeldNotices(row: Task): Record<string, null> {
  const patch: Record<string, null> = {};
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (isMarker(key, value) && value.held === true) patch[key] = null;
  }
  return patch;
}

/**
 * The metadata patch that drops the notice `row`'s ending owes, when a wait on
 * the row found it already ended (FIX-2112): the wait's answer is the
 * ending's delivery, as it is for a wait the ending resumes. Empty when the
 * row hasn't ended or owes nothing for it. A marker held for a request whose
 * wait lapsed is that request's to deliver ({@link droppedHeldNotices}). A
 * taken marker is left too: its notice is the delivery (FIX-2123).
 */
export function deliveredByWait(row: Task): Record<string, null> {
  if (row.status !== "completed" && row.status !== "errored" && row.status !== "cancelled") return {};
  const key = markerKey(row.attempts, row.status);
  return isSendable(key, (row.metadata ?? {})[key]) && takerOf(row, row.attempts, row.status) === undefined ? { [key]: null } : {};
}

/**
 * The metadata patch that releases every held marker on `row`, due at `dueAt`
 * (FIX-2082): the request it was held for ended without reading the row, so
 * the filer is told now, as of any other ending.
 */
export function releasedHeldNotices(row: Task, dueAt: number): Record<string, OwedMarker> {
  const patch: Record<string, OwedMarker> = {};
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (!isMarker(key, value) || value.held !== true) continue;
    const { held: _held, ...marker } = value;
    patch[key] = { ...marker, due: dueAt };
  }
  return patch;
}

/**
 * The metadata patch that drops the resend records of every notice `row`
 * still owes, so the filer's next pass sends each at once, past its backoff.
 * For a session that turned its notices away while one of its turns was busy
 * (`taskSettledEntry`'s `defer`) and is free now. An owed marker is left as
 * it is.
 */
export function resendNowPatch(row: Task): Record<string, null> {
  const patch: Record<string, null> = {};
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (!isSendable(key, value)) continue;
    const resent = `${RESENT_PREFIX}${value.attempt}:${value.ending}`;
    if ((row.metadata ?? {})[resent] != null) patch[resent] = null;
  }
  return patch;
}

/** Whether `row` holds an ending for the request whose wait on it lapsed (FIX-2082). */
export function holdsAnEnding(row: Task): boolean {
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (isMarker(key, value) && value.held === true) return true;
  }
  return false;
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
    if (!isSendable(key, value)) continue;
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
      ...(row.wait != null ? { waitedOn: true as const } : {}),
      ...(cancelled.length > 0 ? { cancelled } : {})
    });
  }
  return notices.sort((a, b) => a.attempt - b.attempt);
}

/**
 * Whether `row` still owes any notice, one held for a request that waited
 * included (FIX-2082). The boolean form of {@link owedNotices}, with an early
 * exit and no notice built: what a check run at every request's end asks of
 * every row a task filed (FIX-2077).
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
    if (!isSendable(key, value)) continue;
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
  return nextResendAt(resentOf(row, marker.attempt, marker.ending), marker.due ?? 0);
}

/**
 * The resend backoff, pure (FIX-2240): `due` until a pass has sent it again,
 * then the last resend plus `NOTICE_DUE_MS · 2^n`, at most
 * {@link NOTICE_RESEND_CAP_MS}. A task notice and a worker message are resent
 * by it.
 *
 * @param resent - When it was last resent, and how many times, if ever.
 * @param due - When it first fell due.
 */
export function nextResendAt(resent: { readonly at: number; readonly n: number } | undefined, due: number): number {
  if (resent === undefined) return due;
  return resent.at + Math.min(NOTICE_DUE_MS * 2 ** resent.n, NOTICE_RESEND_CAP_MS);
}

/**
 * When `notice` first fell due, when it is next sent (see `nextSendAt`), and
 * when its age counts from: its due time, or the last time a busy session
 * turned it away, whichever is later. `undefined` when `row` no longer owes it.
 */
export function noticeTimes(
  row: Task,
  notice: Pick<TaskNotice, "attempt" | "ending">
): { due: number; next: number; since: number } | undefined {
  const key = markerKey(notice.attempt, notice.ending);
  const value = (row.metadata ?? {})[key];
  if (!isSendable(key, value)) return undefined;
  const due = value.due ?? 0;
  const deferred = (row.metadata ?? {})[`${DEFERRED_PREFIX}${notice.attempt}:${notice.ending}`] as { at?: unknown } | null | undefined;
  const deferredAt = deferred != null && typeof deferred.at === "number" ? deferred.at : 0;
  return { due, next: nextSendAt(row, value), since: Math.max(due, deferredAt) };
}

/**
 * The metadata patch that records a busy session turning `notice` away at
 * `now` (FIX-2113): a record beside its marker, which it leaves as it is.
 * `{}` when `row` no longer owes it. With `whileRunning`, the request that
 * filed the task, which was running (FIX-2149): once that request stops
 * running, the filer's pass sends the notice past its backoff
 * ({@link heldWhileRunning}).
 */
export function deferredNoticePatch(
  row: Task,
  notice: Pick<TaskNotice, "attempt" | "ending">,
  now: number,
  whileRunning?: string
): Record<string, { at: number; whileRunning?: string }> {
  if (!isSendable(markerKey(notice.attempt, notice.ending), (row.metadata ?? {})[markerKey(notice.attempt, notice.ending)])) return {};
  return { [`${DEFERRED_PREFIX}${notice.attempt}:${notice.ending}`]: { at: now, ...(whileRunning !== undefined ? { whileRunning } : {}) } };
}

/**
 * The request `notice` was last turned away for (FIX-2149): the filing
 * request, which was running then, when no copy has been sent again since.
 * Once that request parks or ends, the notice is due at once, past its
 * backoff: its backoff grew only while that request held it. `undefined` for
 * a notice `row` no longer owes, one a busy session turned away
 * (`taskSettledEntry`'s `defer`), one sent again since, and a record written
 * before FIX-2149 (BP-030).
 */
export function heldWhileRunning(row: Task, notice: Pick<TaskNotice, "attempt" | "ending">): string | undefined {
  const key = markerKey(notice.attempt, notice.ending);
  if (!isSendable(key, (row.metadata ?? {})[key])) return undefined;
  const deferred = (row.metadata ?? {})[`${DEFERRED_PREFIX}${notice.attempt}:${notice.ending}`] as
    | { at?: unknown; whileRunning?: unknown }
    | null
    | undefined;
  if (deferred == null || typeof deferred.at !== "number" || typeof deferred.whileRunning !== "string") return undefined;
  const resent = resentOf(row, notice.attempt, notice.ending);
  return resent === undefined || deferred.at >= resent.at ? deferred.whileRunning : undefined;
}

/** The metadata patch that records one more resend of `notice` at `now`. */
export function resentRecord(row: Task, notice: Pick<TaskNotice, "attempt" | "ending">, now: number): Record<string, unknown> {
  const n = (resentOf(row, notice.attempt, notice.ending)?.n ?? 0) + 1;
  return { [`${RESENT_PREFIX}${notice.attempt}:${notice.ending}`]: { at: now, n } };
}

/**
 * The dependents `row`'s ending cancelled that share its filer, by id, all
 * the way down: the rows whose cascaded cancel names it (`causedBy`), filed by
 * the same session, and theirs in turn. Each owes no notice of its own (its
 * cause shares its filer), so this notice is the only one that names it.
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
  const found: string[] = [];
  const seen = new Set([row.id]);
  for (let level = [row.id]; level.length > 0; ) {
    const causes = new Set(level);
    level = [];
    for (const other of rows) {
      if (seen.has(other.id) || other.status !== "cancelled" || other.causedBy === undefined || !causes.has(other.causedBy)) continue;
      if (filerOf(other) !== filer) continue;
      seen.add(other.id);
      found.push(other.id);
      level.push(other.id);
    }
  }
  return found;
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
export function decideNotice(notice: Pick<TaskNotice, "ending" | "waitedOn">, policy: NoticePolicy): NoticeDecision {
  if (notice.ending === "retried") return { act: "run-board" };
  if (notice.waitedOn === true) return { act: "resume-wait" };
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
    case "retried":
      return `${named} failed with ${worker} and runs again: ${notice.error ?? "no error was recorded"}`;
    case "cancelled":
      return `${named} was cancelled${cascade}`;
  }
}

/**
 * The key a notice's line carries its structured form under, in its message
 * item's `metadata` ({@link noticeMetadata}). Read it with {@link parseNotice}.
 */
export const NOTICE_ITEM_KEY = "taskNotice";

/**
 * A notice as its line's item carries it: which task, how it ended, and what
 * came back, for a client to read instead of the line's words.
 */
export interface NoticeLine {
  /** The ledger the task is on, by id. Absent on a line read off its text alone. */
  readonly boardId?: string;
  readonly taskId: string;
  /** The attempt that ended. Absent on a line read off its text alone. */
  readonly attempt?: number;
  readonly ending: NoticeEnding;
  /** The row's title, or its goal when it has none. */
  readonly title: string;
  /** What came back: a completion's output summary, a failure's error. Absent on a cancel. */
  readonly detail?: string;
  /** On a failure or a cancel: the dependents it cancelled that share its filer, by id. */
  readonly cancelled?: readonly string[];
}

/**
 * The `metadata` a notice's line is emitted with, so its item says which task
 * ended and how without its words being parsed:
 * `ctx.emit.message(noticeText(notice, task), { metadata: noticeMetadata(notice, task) })`.
 *
 * @param task The row's goal (or title), as {@link noticeText} takes it.
 */
export function noticeMetadata(
  notice: TaskNotice,
  task: { readonly goal: string; readonly title?: string }
): { [NOTICE_ITEM_KEY]: NoticeLine } {
  const detail =
    notice.ending === "completed"
      ? summary(notice.output ?? null)
      : notice.ending === "cancelled"
        ? undefined
        : notice.error ?? "no error was recorded";
  return {
    [NOTICE_ITEM_KEY]: {
      boardId: notice.boardId,
      taskId: notice.taskId,
      attempt: notice.attempt,
      ending: notice.ending,
      title: task.title ?? task.goal,
      ...(detail !== undefined ? { detail } : {}),
      ...(notice.cancelled !== undefined && notice.cancelled.length > 0 ? { cancelled: [...notice.cancelled] } : {})
    }
  };
}

/**
 * {@link noticeText}'s words, read back: what a line stored before its item
 * carried {@link noticeMetadata} says (BP-030). Kept beside the function that
 * writes them, and tested against it, so the two change together.
 */
const NOTICE_LINE =
  /^Task "([\s\S]+?)" \(([^)\s]+)\) (completed by [^:]+|failed for good with [^:]+|failed with [^:]+ and runs again|was cancelled)(?:[:;] ([\s\S]*))?$/;

/** How {@link noticeText} names a failure's or a cancel's cancelled dependents. */
const CASCADE = "it cancelled the tasks that depended on it: ";

const ENDINGS: readonly NoticeEnding[] = ["completed", "errored", "retried", "cancelled"];

function lineOf(value: unknown): NoticeLine | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const line = value as Record<string, unknown>;
  if (typeof line.taskId !== "string" || typeof line.title !== "string" || !ENDINGS.includes(line.ending as NoticeEnding)) return undefined;
  const cancelled = Array.isArray(line.cancelled) ? line.cancelled.filter((id): id is string => typeof id === "string") : [];
  return {
    ...(typeof line.boardId === "string" ? { boardId: line.boardId } : {}),
    taskId: line.taskId,
    ...(typeof line.attempt === "number" ? { attempt: line.attempt } : {}),
    ending: line.ending as NoticeEnding,
    title: line.title,
    ...(typeof line.detail === "string" ? { detail: line.detail } : {}),
    ...(cancelled.length > 0 ? { cancelled } : {})
  };
}

/** A line stored before {@link noticeMetadata}: its words, as {@link noticeText} wrote them. */
function lineFromText(text: string): NoticeLine | undefined {
  const match = NOTICE_LINE.exec(text);
  if (match === null) return undefined;
  const [, title, taskId, how, rest] = match;
  const ending: NoticeEnding = how!.startsWith("completed")
    ? "completed"
    : how!.startsWith("failed for good")
      ? "errored"
      : how!.startsWith("failed")
        ? "retried"
        : "cancelled";
  // A failure's or a cancel's cascade comes last: "; it cancelled the tasks that depended on it: a, b".
  const cascadeAt = rest === undefined || ending === "completed" ? -1 : rest.lastIndexOf(CASCADE);
  const said = cascadeAt === -1 ? rest : rest!.slice(0, cascadeAt).replace(/; $/, "");
  const cancelled = cascadeAt === -1 ? [] : rest!.slice(cascadeAt + CASCADE.length).split(", ").filter((id) => id !== "");
  const detail = ending === "cancelled" || said === undefined || said === "" ? undefined : said;
  return {
    taskId: taskId!,
    ending,
    title: title!,
    ...(detail !== undefined ? { detail } : {}),
    ...(cancelled.length > 0 ? { cancelled } : {})
  };
}

/**
 * The notice a message item is the line of, or `undefined` for any other
 * item: read off the `metadata` {@link noticeMetadata} put on it, or, for a
 * line stored before that, off its words. A client reads which task ended and
 * how from this, never by matching {@link noticeText}'s wording itself.
 *
 * @param item A stored or streamed item: a message's `metadata` and `content`.
 */
export function parseNotice(item: {
  readonly type?: string;
  readonly role?: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly content?: readonly { readonly type: string; readonly text?: string }[] | undefined;
}): NoticeLine | undefined {
  if (item.type !== undefined && item.type !== "message") return undefined;
  if (item.role === "user") return undefined;
  // A line that carries any data says what it is; only an unmarked line
  // (stored before markers existed) is read off its words.
  if (item.metadata !== undefined) return lineOf(item.metadata[NOTICE_ITEM_KEY]);
  const text = (item.content ?? []).map((part) => part.text ?? "").join("");
  return lineFromText(text);
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
      ([key]) =>
        !key.startsWith(OWED_PREFIX) &&
        !key.startsWith(UNDELIVERABLE_PREFIX) &&
        !key.startsWith(RESENT_PREFIX) &&
        !key.startsWith(DEFERRED_PREFIX) &&
        !key.startsWith(TAKEN_PREFIX)
    )
  );
}
