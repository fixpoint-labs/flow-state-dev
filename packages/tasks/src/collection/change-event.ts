/**
 * `TaskChangeEvent` — the typed value the collection backings hand to their
 * `onChange` callback after every successful mutation.
 *
 * The substrate is transport-agnostic: it emits `TaskChangeEvent`s, and the
 * factory in `get-or-create.ts` adapts them to the framework's component-item
 * stream via `ctx.emitComponent("task-change", …)`. Earlier revisions emitted
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
