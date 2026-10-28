/**
 * Task creation and filter helpers.
 *
 * `TaskInit` is the input shape accepted by `addTask`. Every field except
 * `goal` is optional — sensible defaults are stamped in by the
 * collection (`status: 'pending'`, `attempts: 0`, timestamps, etc).
 *
 * `TaskFilter` is the predicate shape accepted by `list` / `count`.
 * Filters are AND'd; an unset field is unconstrained.
 */
import type { Task, TaskStatus } from "./task";
import type { QuestionInit } from "./hold";

/** Where a task runs: a session of its own, or the delegate's ongoing one for the conversation (`Task.session`). */
export type TaskSessionSetting = "new" | "ongoing";

/** Who hears a task's result: whoever filed it, or the conversation it was filed from (`Task.resultTo`). */
export type TaskResultSetting = "filer" | "conversation";

/** Caller-supplied fields when creating a task. `id` is auto-generated when omitted. */
export type TaskInit<TInput = unknown> = {
  id?: string;
  goal: string;
  /** Concise label, distinct from `goal`. Surfaced as the plan-UI row label. */
  title?: string;
  /** Readable per-task support text handed to the worker. See `Task.context`. */
  context?: string;
  status?: TaskStatus;
  assignee?: string;
  deps?: string[];
  priority?: number;
  /**
   * Optional retry budget. When set and `attempts < maxAttempts`,
   * `collection.fail(id, ...)` re-pends the task (with the error
   * captured as `feedback`) instead of transitioning to terminal
   * `errored`. Unset is single-attempt — `fail` goes terminal.
   */
  maxAttempts?: number;
  input?: TInput;
  labels?: string[];
  metadata?: Record<string, unknown>;
  /**
   * The finished task this one follows up, already resolved to its root (see
   * `Task.followUpOf`). Set by the `createTask` tool after it checked the named
   * task; a caller filing directly through a ref is trusted with it.
   */
  followUpOf?: string;
  /**
   * The task whose request filed this one (see `Task.filedByTask`). Set by the
   * filing path from the filer's claim or session, never from model input.
   */
  filedByTask?: string;
  /**
   * File the row held (FIX-2080, the start setting): status `held`, so it
   * doesn't start until something releases it (`release`, or `dispatch` on a
   * board that dispatches). Omitted, it starts once its `deps` have finished.
   */
  held?: boolean;
  /**
   * Questions the task waits on before it starts (FIX-2133): each a row hold
   * (`Task.questions`) the user answers, a plain question or a `confirm` (a yes or
   * a no). The task stays `pending` and starts no attempt until every one is
   * answered, or a deadline the host set passes; every answer joins its
   * brief. Composes with `held`: both must clear. Refused by name past
   * `MAX_STEERS` questions or `MAX_QUESTION_PROMPT` characters.
   */
  questions?: QuestionInit[];
  /**
   * Where the task runs (see `Task.session`). Omitted is `"new"`. A board that
   * can't honour a value refuses the filing, naming the setting
   * (`TaskFilingRefusedError`): a plain board takes only the default.
   */
  session?: TaskSessionSetting;
  /**
   * Who hears the result (see `Task.resultTo`). Omitted is `"filer"`. A
   * `"conversation"` task has one attempt: `maxAttempts` unset reads as 1, and
   * any other value is refused at filing.
   */
  resultTo?: TaskResultSetting;
  /**
   * The workstream record the task goes to, by its target (see `Task.target`):
   * a filing setting, for an assignee that is a workstream's lead. A board
   * whose filer has no such record refuses it.
   */
  target?: string;
  /**
   * The session `target` resolved to when the task was filed (see
   * `Task.targetSessionId`). Written by the board's filing path, never from
   * model input: the task tools build a row's init field by field and leave
   * it out.
   */
  targetSessionId?: string;
  /**
   * The row's server-written payload (see `Task.sealed`). Never from model
   * input: the task tools build a row's init field by field and leave it out.
   */
  sealed?: Record<string, unknown>;
  /**
   * For a row filed already cancelled because a dependency ended: why, and
   * that dependency (see `Task.error`, `Task.causedBy`), as a cascade's cancel
   * writes them, kept only when the row is stored `"cancelled"` (`held: true`
   * stores it held, so it keeps neither). Set by a replan
   * filing a task skipped. Never from model input: the task tools build a
   * row's init field by field and leave both out.
   */
  error?: string;
  causedBy?: string;
};

/**
 * Filter predicate used by `list` / `count`. All conditions are AND'd.
 * Pass `{ status: ['pending', 'in_progress'] }` to match either status.
 */
export type TaskFilter = {
  status?: TaskStatus | TaskStatus[];
  assignee?: string;
  hasLabel?: string;
  /** Match tasks that carry every label in this list. */
  hasAllLabels?: string[];
  /** Match only tasks whose waiting turn is owed its answer (`Task.resumeOwed`). */
  resumeOwed?: true;
  /** Match only tasks whose wait is over and still owes its cancel (`Task.cancelOwed`). */
  cancelOwed?: true;
  /** Match only tasks whose ending still owes its cascade (`Task.cascadeOwed`). */
  cascadeOwed?: true;
  /** Match only tasks a given task's request filed (`Task.filedByTask`, FIX-2081). */
  filedByTask?: string;
  /**
   * Match only tasks whose `sealed` payload holds each of these keys at this
   * plain value (compared with `===`).
   */
  sealed?: Record<string, string | number | boolean>;
};

/** Returns true when `task` matches every set field on `filter`. */
export function matchesFilter(task: Task, filter?: TaskFilter): boolean {
  if (filter === undefined) return true;

  if (filter.status !== undefined) {
    const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!allowed.includes(task.status)) return false;
  }

  if (filter.assignee !== undefined && task.assignee !== filter.assignee) {
    return false;
  }

  const labels = task.labels ?? [];

  if (filter.hasLabel !== undefined && !labels.includes(filter.hasLabel)) {
    return false;
  }

  if (filter.hasAllLabels !== undefined) {
    for (const label of filter.hasAllLabels) {
      if (!labels.includes(label)) return false;
    }
  }

  if (filter.resumeOwed === true && task.resumeOwed !== true) return false;

  if (filter.cancelOwed === true && task.cancelOwed !== true) return false;

  if (filter.cascadeOwed === true && task.cascadeOwed == null) return false;

  if (filter.filedByTask !== undefined && task.filedByTask !== filter.filedByTask) return false;

  if (filter.sealed !== undefined) {
    for (const [key, value] of Object.entries(filter.sealed)) {
      if (task.sealed?.[key] !== value) return false;
    }
  }

  return true;
}
