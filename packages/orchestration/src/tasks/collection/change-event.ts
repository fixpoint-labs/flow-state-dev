/**
 * `TaskChangeEvent` — the typed value the collection backings hand to their
 * `onChange` callback after every successful mutation.
 *
 * The substrate is transport-agnostic: it emits `TaskChangeEvent`s, and the
 * factory in `get-or-create.ts` adapts them to the framework's component-item
 * stream via `ctx.emit.component("task-change", …)`. Earlier revisions emitted
 * a custom `task_change` `OutputItem` directly; that bypassed `items.md`'s
 * documented type-registration process and required the substrate to build
 * provenance frames itself. Component items keep the substrate clean and
 * reuse the framework's existing emission infrastructure.
 */
import type { Task, TaskStatus } from "../schema/task";

/** Lifecycle transitions a TaskCollection can publish to a UI. */
export type TaskChangeKind =
  | "added"
  | "claimed"
  | "completed"
  | "errored"
  | "retried"
  // FIX-2383.
  /**
   * A failed or cancelled task was put back to waiting by a person or an app:
   * not an ending, unlike `retried`. It starts again as any
   * waiting task does.
   */
  | "retry_requested"
  // FIX-2080.
  /** A task that hadn't started was held: it won't start until released. */
  | "held"
  // FIX-2080.
  /** A held task was released: it starts once its dependencies have finished. */
  | "released"
  // FIX-2080.
  /** A task's start or attempts settings changed before it started. */
  | "settings_changed"
  | "resumed"
  | "cancelled"
  | "label_changed"
  | "metadata_changed"
  | "priority_changed"
  | "assignee_changed"
  // FIX-1668.
  /**
   * A dispatched run wrote itself onto its task — the row's `run`
   * now names that run. Published on the run's own session, like every write
   * the run makes; a view following another session sees the link on its next
   * read of the row.
   */
  | "run_linked"
  // FIX-2081.
  /** A running task's worker reported its progress: a status note, a checkpoint of its output, or both. */
  | "progress_reported"
  // FIX-1816.
  /** A waited-on row's resume-owed marker was cleared: its waiting turn has its answer. */
  | "resume_settled"
  // FIX-2086.
  /** Words were sent into an open task: a steer, kept on the row for every later attempt. */
  | "steered"
  // FIX-1844.
  /** A waited-on row's wait is over and its cancel failed: the row owes that cancel. */
  | "cancel_owed"
  // FIX-2082.
  /** A request took the row's wait slot, the slot lapsed at its deadline, or it was released. */
  | "wait_changed"
  // FIX-2133.
  /** A running task's turn asked questions: the row is held on them, with no lease. */
  | "asked"
  // FIX-2133.
  /** A question or a confirm was answered, or its deadline closed it: the last one lets the work go on. */
  | "answered";

/**
 * Substrate-internal event published on every task mutation. Carries the
 * post-mutation task plus the previous status so consumers can render diffs
 * without keeping a parallel state.
 */
export interface TaskChangeEvent<TInput = unknown, TOutput = unknown> {
  collectionId: string;
  taskId: string;
  kind: TaskChangeKind;
  task: Task<TInput, TOutput>;
  /** Previous status when the mutation transitioned the task; omitted on pure metadata edits. */
  prevStatus?: TaskStatus;
}

/**
 * Build the `emit` a collection backing calls after every committed write of a
 * row, whatever it changed.
 *
 * A write with a `kind` is a lifecycle change and goes to `onChange` (the
 * `task-change` item); kind `null` (a run's spend, a cleared marker) goes only
 * to `onWrite`, so a view of the board still reads again. Absent callbacks are
 * no-ops, so call sites stay unconditional.
 */
export function createTaskChangeEmitter<TInput, TOutput>(
  collectionId: string,
  onChange: ((event: TaskChangeEvent) => void) | undefined,
  onWrite?: (task: Task) => void
): (kind: TaskChangeKind | null, task: Task<TInput, TOutput>, prevStatus?: TaskStatus) => void {
  return (kind, task, prevStatus) => {
    if (kind === null) {
      onWrite?.(task as Task);
      return;
    }
    if (onChange === undefined) return;
    onChange({
      collectionId,
      taskId: task.id,
      kind,
      task: task as Task,
      prevStatus,
    });
  };
}

// FIX-1005.
/**
 * Task fields the substrate keeps server-side and never publishes to a client.
 *
 * ## Why this is a deny-list and must stay one
 *
 * The emitted `task-change` item carries the **whole** post-mutation row, and
 * that is load-bearing: clients read task lifecycle off the complete envelope.
 * Narrowing this to an allow-list would close the leak by breaking that, and
 * would silently drop every field added afterwards. The useful property and the
 * leak are the same property — so the exception is stated as an exception.
 *
 * **Do not "tidy" this into an allow-list.** Adding a server-only field is one
 * entry here rather than a rule the next author has to remember.
 *
 * The `as const satisfies` is load-bearing beyond documentation: it keeps the
 * tuple's literal member types, which is what lets {@link toEmittedTask}'s
 * `delete` typecheck — and `delete` is only legal on an *optional* key. So a
 * required field cannot be added to this list without the compiler objecting,
 * which is the right answer: a required field cannot be omitted from the
 * payload without breaking the shape consumers parse.
 */
export const SERVER_ONLY_TASK_FIELDS = ["claimedBy", "createdBy", "filer", "filedUnder"] as const satisfies ReadonlyArray<
  keyof Task
>;

// FIX-1005.
/**
 * Project a task for client emission — the whole row minus
 * {@link SERVER_ONLY_TASK_FIELDS}.
 *
 * Applied where the component-item payload is built, because **schema
 * membership is itself a publication**: the collection factory spreads the
 * post-mutation row into a `task-change` component item and a board can mark
 * that stream client-visible, so a field on `Task` reaches a
 * browser with no consumer required.
 *
 * Unconditional by design — redaction must not depend on a caller's
 * visibility flag, since the board that matters already sets `client: true`.
 */
export function toEmittedTask<TInput, TOutput>(
  task: Task<TInput, TOutput>
): Task<TInput, TOutput> {
  const emitted = { ...task };
  for (const field of SERVER_ONLY_TASK_FIELDS) {
    delete emitted[field];
  }
  return emitted;
}
