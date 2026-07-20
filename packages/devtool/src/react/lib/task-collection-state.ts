/**
 * Local mirror of the unified Plan/Task substrate's component-item types
 * (FIX-444 / FIX-446) for the DevTool TaskCollections panel (FIX-445).
 *
 * Inlined rather than imported from `@flow-state-dev/orchestration` to keep the
 * DevTool app dep surface narrow — the panel only needs the wire shape, not
 * the runtime mutation API. Update in lockstep with
 * `packages/tasks/src/schema/task.ts` and the substrate emission sites in
 * `packages/tasks/src/collection/get-or-create.ts` and
 * `packages/patterns/src/task-board/blocks/board-meta.ts`.
 */

/** Component-item type emitted on every per-task lifecycle event. */
export const TASK_CHANGE_COMPONENT = "task-change";

/** Component-item type emitted at board start / end. */
export const TASK_BOARD_META_COMPONENT = "task-board-meta";

/**
 * Canonical task status set from the substrate. Open-ended at the consumer
 * boundary — pattern wrappers may extend the status vocabulary.
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "awaiting_review"
  | "completed"
  | "errored"
  | "cancelled"
  | (string & {});

/** Mirror of the lifecycle transition kinds the substrate publishes. */
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
  | "assignee_changed"
  | (string & {});

/** Mirror of `Task` from `@flow-state-dev/orchestration`. Wire-shape only. */
export type Task = {
  id: string;
  goal: string;
  status: TaskStatus;
  attempts?: number;
  maxAttempts?: number;
  assignee?: string;
  deps?: string[];
  priority?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  feedback?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  startedAt?: number;
  completedAt?: number;
};

/** Counts payload on `task-board-meta` completion. */
export type BoardCounts = {
  total: number;
  pending: number;
  in_progress: number;
  blocked: number;
  awaiting_review: number;
  completed: number;
  errored: number;
  cancelled: number;
};

export type BoardMeta = {
  status?: string;
  counts?: BoardCounts;
};
