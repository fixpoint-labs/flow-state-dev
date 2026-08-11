/**
 * Local mirror of the unified Plan/Task substrate's component-item types
 * (FIX-444 / FIX-446) for the DevTool TaskCollections panel (FIX-445), plus
 * the derivation that folds a session's item stream back into boards.
 *
 * Inlined rather than imported from `@flow-state-dev/orchestration` to keep the
 * DevTool app dep surface narrow — the panel only needs the wire shape, not
 * the runtime mutation API. Update in lockstep with
 * `packages/tasks/src/schema/task.ts` and the substrate emission sites in
 * `packages/tasks/src/collection/get-or-create.ts` and
 * `packages/patterns/src/task-board/blocks/board-meta.ts`.
 *
 * {@link groupCollections} lived in `components/workspace/task-collections-view`
 * until the Workstreams panel needed the same boards (FIX-1071). It is a pure
 * fold over items with no rendering in it, so it belongs beside the wire shapes
 * it produces rather than inside one of its two consumers.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { DevtoolItem } from "./item-types";

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

// ---------------------------------------------------------------------------
// Item-stream → CollectionView
// ---------------------------------------------------------------------------

/** One board, as reconstructed from the items a session emitted. */
export type CollectionView = {
  id: string;
  boardMeta: BoardMeta;
  /** Latest task entry per id, sorted by createdAt asc. */
  tasks: ResolvedTask[];
};

/** A task at its latest observed state, with how it got there. */
export type ResolvedTask = {
  task: Task;
  kind?: TaskChangeKind;
  prevStatus?: TaskStatus;
  /** Number of `task-change` items observed for this task. */
  changeCount: number;
};

/** The item shapes both DevTool panels iterate over. */
export type TaskStreamItem = OutputItem | DevtoolItem;

type TaskChangeData = {
  collectionId?: string;
  taskId?: string;
  kind?: TaskChangeKind;
  task?: Task;
  prevStatus?: TaskStatus;
};

type TaskBoardMetaData = {
  collectionId?: string;
  status?: string;
  counts?: BoardMeta["counts"];
};

/**
 * Fold a session's items into the boards they describe.
 *
 * Auto-discovery is by `data.collectionId` on `task-change` and
 * `task-board-meta` component items — pattern-agnostic, so any consumer of the
 * unified Plan/Task substrate shows up.
 */
export function groupCollections(
  items: ReadonlyArray<TaskStreamItem>
): CollectionView[] {
  const byId = new Map<
    string,
    {
      id: string;
      boardMeta: BoardMeta;
      tasksById: Map<string, ResolvedTask>;
    }
  >();

  // Forward iteration so `tasksById` ends with the latest entry per task and
  // `boardMeta` reflects the latest meta. Forward also lets us track the
  // total number of changes per task (for the `×N` ribbon).
  for (const item of items) {
    if (item.type !== "component") continue;
    const component = (item as { component?: string }).component;
    const data = (item as { data?: unknown }).data;

    if (component === TASK_CHANGE_COMPONENT) {
      const change = data as TaskChangeData;
      if (
        typeof change.collectionId !== "string" ||
        typeof change.taskId !== "string" ||
        change.task === undefined
      ) {
        continue;
      }
      const bucket = ensureBucket(byId, change.collectionId);
      const prior = bucket.tasksById.get(change.taskId);
      bucket.tasksById.set(change.taskId, {
        task: change.task,
        kind: change.kind,
        prevStatus: change.prevStatus,
        changeCount: (prior?.changeCount ?? 0) + 1,
      });
      continue;
    }

    if (component === TASK_BOARD_META_COMPONENT) {
      const meta = data as TaskBoardMetaData;
      if (typeof meta.collectionId !== "string") continue;
      const bucket = ensureBucket(byId, meta.collectionId);
      bucket.boardMeta = {
        status: meta.status,
        counts: meta.counts,
      };
    }
  }

  const result: CollectionView[] = [];
  for (const { id, boardMeta, tasksById } of byId.values()) {
    const tasks = [...tasksById.values()].sort((a, b) => {
      const at = a.task.createdAt ?? 0;
      const bt = b.task.createdAt ?? 0;
      if (at !== bt) return at - bt;
      return a.task.id.localeCompare(b.task.id);
    });
    result.push({ id, boardMeta, tasks });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

function ensureBucket(
  map: Map<
    string,
    {
      id: string;
      boardMeta: BoardMeta;
      tasksById: Map<string, ResolvedTask>;
    }
  >,
  id: string
) {
  let bucket = map.get(id);
  if (bucket === undefined) {
    bucket = {
      id,
      boardMeta: {},
      tasksById: new Map(),
    };
    map.set(id, bucket);
  }
  return bucket;
}
