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

/** Why a filing (or an edit of one) was refused. The code leads the error's message. */
export type TaskFilingRule =
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
  /** A conversation-result task has one attempt. */
  | "conversation_result_one_attempt"
  /** A setting only a conversation may choose, filed from a task's session. */
  | "setting_not_from_task_session";

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
  if (init.followUpOf !== undefined && init.session !== undefined) {
    throw new TaskFilingRefusedError({
      rule: "follow_up_takes_no_session",
      taskId,
      detail: `a follow-up runs in the session of the task it follows, so it takes no session setting. Leave session unset.`,
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
 * Refuse a batch of filings whose dependencies this board can't run: an id
 * that names no task on this board or in the batch, a dependency already
 * failed or cancelled, or a loop. Ids filed in the same batch count.
 *
 * @param batch The rows being filed, as they will be written.
 * @param lookup The board's committed row by id.
 * @throws {TaskFilingRefusedError}
 */
export function assertDepsFileable(
  batch: readonly Pick<Task, "id" | "deps">[],
  lookup: (id: string) => Pick<Task, "id" | "deps" | "status"> | undefined
): void {
  const filed = new Map(batch.map((row) => [row.id, row]));
  for (const row of batch) {
    for (const depId of row.deps ?? []) {
      if (filed.has(depId)) continue;
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
