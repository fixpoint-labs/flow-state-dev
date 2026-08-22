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
  | "blocked"
  | "unblocked"
  | "review_requested"
  | "resumed"
  | "cancelled"
  | "label_changed"
  | "metadata_changed"
  | "priority_changed"
  | "assignee_changed";

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
 * Build the `emit` a collection backing calls after every successful mutation.
 *
 * Both backings publish the identical envelope; only how they resolve the task
 * differs. A no-op when the caller supplied no `onChange`, so call sites stay
 * unconditional.
 */
export function createTaskChangeEmitter<TInput, TOutput>(
  collectionId: string,
  onChange: ((event: TaskChangeEvent) => void) | undefined
): (kind: TaskChangeKind, task: Task<TInput, TOutput>, prevStatus?: TaskStatus) => void {
  return (kind, task, prevStatus) => {
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

/**
 * Task fields the substrate keeps server-side and never publishes to a client
 * (FIX-1005).
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
export const SERVER_ONLY_TASK_FIELDS = ["claimedBy"] as const satisfies ReadonlyArray<
  keyof Task
>;

/**
 * Project a task for client emission — the whole row minus
 * {@link SERVER_ONLY_TASK_FIELDS} (FIX-1005).
 *
 * Applied where the component-item payload is built, because **schema
 * membership is itself a publication**: the collection factory spreads the
 * post-mutation row into a `task-change` component item and the delegation
 * board marks that stream client-visible, so a field on `Task` reaches a
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
