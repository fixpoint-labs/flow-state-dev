/**
 * What a filing may say, decided once for both backings (FIX-2080): the
 * filing settings a board honours, and the dependencies it takes.
 *
 * The convergence point for both rules (tenet 5). Every add path, on both
 * backings (`addTask`, `addTasks`, a seeded board, a replan, the Workforce
 * add), and the one patch that edits dependencies (`patchSettings`), check a
 * filing here. A refusal throws {@link TaskFilingRefusedError}, naming the
 * rule, and files nothing.
 */
import type { Task } from "../schema/task";
import type { TaskInit, TaskResultSetting, TaskSessionSetting } from "../schema/task-init";
import { isTerminalStatus } from "../schema/task-status";
import { askProblem } from "./questions";

/** Why a filing (or an edit of one) was refused. The code leads the error's message. */
export type TaskFilingRule =
  /** The questions a task is filed on can't be kept: none, empty, too long, or too many (FIX-2133). */
  | "questions_not_kept"
  /** A dependency names no task on this board (another board's id, or a typo). */
  | "dependency_not_on_board"
  /** A dependency already failed or was cancelled, so the task could never start. */
  | "dependency_ended"
  /** The dependencies close a loop, within a batch or through an edit. */
  | "dependency_loop"
  /** The board can't honour a setting's value. */
  | "setting_not_supported"
  /** A follow-up runs in its root's session, so it takes no `session`. */
  | "follow_up_takes_no_session"
  /** A follow-up runs where its root ran, so it takes no workstream `target`. */
  | "follow_up_takes_no_target"
  /** A follow-up's result goes where its root's went, so it takes no `resultTo`. */
  | "follow_up_takes_no_result_to"
  /** A conversation-result task has one attempt. */
  | "conversation_result_one_attempt"
  /** A setting only a conversation may choose, filed from a task's session. */
  | "setting_not_from_task_session"
  /** A batch names one task id twice. */
  | "duplicate_task_id"
  /** A follow-up names a task that never ran with a worker: there is no session to follow up in. */
  | "follow_up_of_unrun"
  /** The task filing it was cancelled: work it files now would outlive it (FIX-2129). */
  | "parent_cancelled";

/**
 * A filing, or an edit of one, refused at the board (FIX-2080). Nothing was
 * written. Thrown, not declined: a filing that can never run as asked is a
 * caller's mistake to correct, and the task tools turn it into a recoverable
 * `{ ok: false, error }` naming the rule.
 */
export class TaskFilingRefusedError extends Error {
  /** The rule the filing broke. */
  readonly rule: TaskFilingRule;
  /** The task the refused filing names, when it names one. */
  readonly taskId: string | undefined;

  constructor(options: { rule: TaskFilingRule; detail: string; taskId?: string }) {
    super(`${options.rule}: ${options.detail}`);
    this.name = "TaskFilingRefusedError";
    this.rule = options.rule;
    this.taskId = options.taskId;
  }
}

/**
 * The setting values a board honours. A plain board honours only the
 * defaults; a board declares more (`defineTaskCollection({ settings })`)
 * when its hand-over can run them.
 */
export interface TaskSettingsSupport {
  /** The `session` values the board honours. Default: `["new"]`. */
  readonly session?: readonly TaskSessionSetting[];
  /** The `resultTo` values the board honours. Default: `["filer"]`. */
  readonly resultTo?: readonly TaskResultSetting[];
}

/** Where a filing comes from, as the board that takes it knows it. */
export interface TaskFilingCallerContext {
  /** The filing comes from a task's own session, which files pieces of that task. */
  readonly fromTaskSession: boolean;
}

/**
 * Refuse a setting the filing's caller may not ask for (FIX-2080): a task's
 * session files pieces of its task, heard by that task, so it asks neither
 * for the delegate's ongoing session nor for a result sent to the
 * conversation. Only a conversation chooses those.
 *
 * @throws {TaskFilingRefusedError} with rule `setting_not_from_task_session`.
 */
export function assertFilingCallerContext(init: TaskInit, context: TaskFilingCallerContext): void {
  if (!context.fromTaskSession || (init.session !== "ongoing" && init.resultTo !== "conversation")) return;
  const setting = init.session === "ongoing" ? `session "ongoing"` : `resultTo "conversation"`;
  throw new TaskFilingRefusedError({
    rule: "setting_not_from_task_session",
    ...(init.id !== undefined ? { taskId: init.id } : {}),
    detail:
      `a task's session can't file with ${setting}: only a conversation chooses the delegate's ongoing ` +
      `session or sends a result to the conversation. Nothing was written.`,
  });
}

const DEFAULT_SESSIONS: readonly TaskSessionSetting[] = ["new"];
const DEFAULT_RESULTS: readonly TaskResultSetting[] = ["filer"];

/**
 * Refuse a filing whose settings this board can't honour, naming the
 * setting.
 *
 * @throws {TaskFilingRefusedError}
 */
export function assertFilingSettings(init: TaskInit, support: TaskSettingsSupport | undefined, collectionId: string): void {
  const taskId = init.id;
  const asked = init.questions === undefined ? undefined : askProblem(init.questions);
  if (asked !== undefined) {
    throw new TaskFilingRefusedError({
      rule: "questions_not_kept",
      taskId,
      detail: `${asked}, so the task can't wait on them. Ask fewer or shorter questions, or file it without.`,
    });
  }
  if (init.followUpOf !== undefined && init.session !== undefined) {
    throw new TaskFilingRefusedError({
      rule: "follow_up_takes_no_session",
      taskId,
      detail: `a follow-up runs in the session of the task it follows, so it takes no session setting. Leave session unset.`,
    });
  }
  if (init.followUpOf !== undefined && init.target !== undefined) {
    throw new TaskFilingRefusedError({
      rule: "follow_up_takes_no_target",
      taskId,
      detail: `a follow-up runs where the task it follows ran, its workstream included, so it takes no target. Leave target unset.`,
    });
  }
  if (init.followUpOf !== undefined && init.resultTo !== undefined) {
    throw new TaskFilingRefusedError({
      rule: "follow_up_takes_no_result_to",
      taskId,
      detail: `a follow-up's result goes where the result of the task it follows went, so it takes no resultTo. Leave resultTo unset.`,
    });
  }
  if (init.session !== undefined && !(support?.session ?? DEFAULT_SESSIONS).includes(init.session)) {
    throw new TaskFilingRefusedError({
      rule: "setting_not_supported",
      taskId,
      detail: `board "${collectionId}" can't run a task in session "${init.session}". It takes ${quoteAll(support?.session ?? DEFAULT_SESSIONS)}.`,
    });
  }
  if (init.resultTo !== undefined && !(support?.resultTo ?? DEFAULT_RESULTS).includes(init.resultTo)) {
    throw new TaskFilingRefusedError({
      rule: "setting_not_supported",
      taskId,
      detail: `board "${collectionId}" can't send a task's result to "${init.resultTo}". It takes ${quoteAll(support?.resultTo ?? DEFAULT_RESULTS)}.`,
    });
  }
  if (init.resultTo === "conversation" && init.maxAttempts !== undefined && init.maxAttempts !== 1) {
    throw new TaskFilingRefusedError({
      rule: "conversation_result_one_attempt",
      taskId,
      detail: `a task whose result goes to the conversation has one attempt, so maxAttempts must be 1 or unset (got ${init.maxAttempts}).`,
    });
  }
}

function quoteAll(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(" or ");
}

/** A task's dependencies, as the graph check reads them. */
type DepsOf = (id: string) => readonly string[] | undefined;

/**
 * Whether following dependencies from `from` reaches `target`. The rows
 * already on a board close no loop (every filing and edit was checked), so a
 * loop always runs through the rows being filed or edited.
 */
function reaches(from: readonly string[], target: string, depsOf: DepsOf): boolean {
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of depsOf(id) ?? []) stack.push(next);
  }
  return false;
}

/**
 * Refuse a follow-up whose root task never ran with a worker (FIX-2080). A
 * follow-up runs in the session its root ran in, with that worker; a root
 * that is held, or still waiting to start, has no session yet, and a
 * follow-up that took it would run first, in the root's place.
 *
 * @param lookup The board's committed row by id. A batch passes its own
 *   rows too: a root filed beside its follow-up has never run.
 * @throws {TaskFilingRefusedError} with rule `follow_up_of_unrun`; a
 *   follow-up naming no task here is left to the caller's own lookup.
 */
export function assertFollowUpHasRun(
  init: TaskInit,
  lookup: (id: string) => Pick<Task, "id" | "assignee" | "run" | "followUpOf"> | undefined
): void {
  if (init.followUpOf === undefined) return;
  const named = lookup(init.followUpOf);
  if (named === undefined) return;
  const root = lookup(named.followUpOf ?? named.id);
  if (root !== undefined && root.assignee !== undefined && root.run !== undefined) return;
  throw new TaskFilingRefusedError({
    rule: "follow_up_of_unrun",
    ...(init.id !== undefined ? { taskId: init.id } : {}),
    detail: `task "${init.followUpOf}" never ran with a worker, so there is no session to follow up in. File a new task instead. Nothing was filed.`,
  });
}

/**
 * A follow-up as it is written: in the session its root task ran in
 * (FIX-2111), with its result going where the root's went (FIX-2122). A
 * follow-up takes no placement or result setting of its own
 * (`follow_up_takes_no_session`, `follow_up_takes_no_target`,
 * `follow_up_takes_no_result_to`), so the root's `session`, `target`,
 * `targetSessionId` and `resultTo` are copied onto it, server-side. Every
 * reader of the row (the start test, the dispatch, the hold on a workstream's
 * session, the ending's delivery) then treats it as its root. A follow-up whose
 * result goes to the conversation has one attempt, as every such task does: a
 * `maxAttempts` given with it becomes 1.
 * A root filed with none leaves the follow-up with none.
 *
 * @param lookup The board's committed row by id.
 */
export function withFollowUpPlacement<T extends TaskInit>(
  init: T,
  lookup: (id: string) => Pick<Task, "id" | "followUpOf" | "session" | "target" | "targetSessionId" | "resultTo"> | undefined
): T {
  if (init.followUpOf === undefined) return init;
  const named = lookup(init.followUpOf);
  const root = named === undefined ? undefined : lookup(named.followUpOf ?? named.id);
  if (root === undefined) return init;
  const { session: _session, target: _target, targetSessionId: _targetSessionId, resultTo: _resultTo, ...rest } = init;
  return {
    ...rest,
    ...(root.resultTo !== undefined ? { resultTo: root.resultTo } : {}),
    ...(root.resultTo === "conversation" ? { maxAttempts: 1 } : {}),
    ...(root.session !== undefined ? { session: root.session } : {}),
    ...(root.target !== undefined ? { target: root.target } : {}),
    ...(root.targetSessionId !== undefined ? { targetSessionId: root.targetSessionId } : {}),
  } as T;
}

/**
 * Refuse a batch that names one task id twice: one of the two would be lost.
 *
 * @throws {TaskFilingRefusedError} with rule `duplicate_task_id`.
 */
export function assertUniqueIds(batch: readonly { readonly id?: string }[]): void {
  const seen = new Set<string>();
  for (const { id } of batch) {
    if (id === undefined) continue;
    if (seen.has(id)) {
      throw new TaskFilingRefusedError({
        rule: "duplicate_task_id",
        taskId: id,
        detail: `the batch names task "${id}" twice. Give each task its own id. Nothing was written.`,
      });
    }
    seen.add(id);
  }
}

/**
 * Refuse a batch that names a task id already filed. A board adds a batch's
 * rows one at a time, so the collision would surface at that row's add, after
 * the rows before it were filed.
 *
 * @param filed The row already filed under an id, on any ledger the batch writes to.
 * @throws {TaskFilingRefusedError} with rule `duplicate_task_id`.
 */
export function assertIdsFree(batch: readonly { readonly id?: string }[], filed: (id: string) => unknown): void {
  for (const { id } of batch) {
    if (id === undefined || filed(id) === undefined) continue;
    throw new TaskFilingRefusedError({
      rule: "duplicate_task_id",
      taskId: id,
      detail: `task "${id}" is already filed. Give each task its own id. Nothing was written.`,
    });
  }
}

/**
 * Refuse a batch of filings whose dependencies this board can't run: an id
 * that names no task on this board or in the batch, a dependency already
 * failed or cancelled, or a loop. Ids filed in the same batch count.
 *
 * @param batch The rows being filed, as they will be written.
 * @param lookup The board's committed row by id.
 * @throws {TaskFilingRefusedError}
 */
export function assertDepsFileable(
  batch: readonly (Pick<Task, "id" | "deps"> & { readonly status?: Task["status"] })[],
  lookup: (id: string) => Pick<Task, "id" | "deps" | "status"> | undefined
): void {
  const filed = new Map(batch.map((row) => [row.id, row]));
  for (const row of batch) {
    // A row filed already ended waits on nothing, so its dependencies don't
    // have to be live.
    if (row.status !== undefined && isTerminalStatus(row.status)) continue;
    for (const depId of row.deps ?? []) {
      // A row of the batch filed already ended counts as a stored one does.
      const inBatch = filed.get(depId);
      if (inBatch !== undefined) {
        if (inBatch.status !== undefined && endedForGood({ status: inBatch.status })) throw ended(row.id, depId, inBatch.status);
        continue;
      }
      const dep = lookup(depId);
      if (dep === undefined) throw notOnBoard(row.id, depId);
      if (endedForGood(dep)) throw ended(row.id, depId, dep.status);
    }
  }
  const depsOf: DepsOf = (id) => filed.get(id)?.deps ?? lookup(id)?.deps;
  for (const row of batch) {
    if (reaches(row.deps ?? [], row.id, depsOf)) throw loop(row.id);
  }
}

/**
 * Refuse a filing made by a task that is already cancelled (FIX-2129): the
 * filed-work cascade cancels only what the task filed up to its cancel, so a
 * row filed after it would run on with nothing to end it. Read against the
 * committed parent row, inside the write where the backing has one. A parent
 * that is not on this board is the caller's to check (a piece filed on a
 * task session's own board: `parentCancelledRefusal`).
 *
 * @param lookup The board's committed row by id.
 * @throws {TaskFilingRefusedError}
 */
export function assertParentsOpen(
  batch: readonly Pick<Task, "id" | "filedByTask">[],
  lookup: (id: string) => Pick<Task, "id" | "status"> | undefined
): void {
  for (const row of batch) {
    if (row.filedByTask === undefined) continue;
    const parent = lookup(row.filedByTask);
    if (parent?.status === "cancelled") throw parentCancelledRefusal(row.filedByTask);
  }
}

/** The refusal of a filing by `parentId`, a task already cancelled. */
export function parentCancelledRefusal(parentId: string): TaskFilingRefusedError {
  return new TaskFilingRefusedError({
    rule: "parent_cancelled",
    taskId: parentId,
    detail: `task "${parentId}", which files this, was cancelled, so it files nothing more. Nothing was written.`,
  });
}

/**
 * Refuse an edit of `taskId`'s dependencies to `deps` that this board can't
 * run, by the rules {@link assertDepsFileable} applies to a filing.
 *
 * @throws {TaskFilingRefusedError}
 */
export function assertDepsEditable(
  taskId: string,
  deps: readonly string[],
  lookup: (id: string) => Pick<Task, "id" | "deps" | "status"> | undefined
): void {
  for (const depId of deps) {
    if (depId === taskId) throw loop(taskId);
    const dep = lookup(depId);
    if (dep === undefined) throw notOnBoard(taskId, depId);
    if (endedForGood(dep)) throw ended(taskId, depId, dep.status);
  }
  const depsOf: DepsOf = (id) => (id === taskId ? deps : lookup(id)?.deps);
  if (reaches(deps, taskId, depsOf)) throw loop(taskId);
}

/** A dependency that can never complete: it failed for good, or was cancelled. */
function endedForGood(dep: Pick<Task, "status">): boolean {
  return isTerminalStatus(dep.status) && dep.status !== "completed";
}

function notOnBoard(taskId: string, depId: string): TaskFilingRefusedError {
  return new TaskFilingRefusedError({
    rule: "dependency_not_on_board",
    taskId,
    detail:
      `task "${taskId}" depends on "${depId}", which is not a task on this board. A dependency must be a task ` +
      `on the same board; to wait on work on another board, cross boards with a wait or a held task. Nothing was written.`,
  });
}

function ended(taskId: string, depId: string, status: string): TaskFilingRefusedError {
  return new TaskFilingRefusedError({
    rule: "dependency_ended",
    taskId,
    detail: `task "${taskId}" depends on "${depId}", which is ${status}, so it could never start. Nothing was written.`,
  });
}

function loop(taskId: string): TaskFilingRefusedError {
  return new TaskFilingRefusedError({
    rule: "dependency_loop",
    taskId,
    detail: `task "${taskId}"'s dependencies lead back to it, so none of them could ever start. Nothing was written.`,
  });
}
