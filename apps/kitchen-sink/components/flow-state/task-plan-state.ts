/**
 * Pure data-extraction helpers for the `<TaskPlan />` component (FIX-445).
 *
 * The substrate emits two component item types per task collection:
 *
 *   - `task-change` (FIX-444 / FIX-446): per-task lifecycle events keyed by
 *     `${collectionId}/${taskId}`. `data` carries `{ collectionId, taskId,
 *     kind, task, prevStatus? }`.
 *   - `task-board-meta` (FIX-446): board-level aggregate state keyed by
 *     `${collectionId}`. `data` carries `{ collectionId, status, counts? }`
 *     where `status` is open-ended (substrate emits `"active" | "completed"`;
 *     pattern wrappers extend with strings like `"planning"`, `"replanning"`,
 *     `"reviewing"`).
 *
 * The renderer subscribes to all items, filters by component type and
 * `data.collectionId`, and resolves to the latest emission per `key`.
 *
 * Latest-wins is consumer-side only — the server stores every emission as a
 * distinct item id, so we reverse-scan and keep the first hit per key.
 *
 * Lives as a `.ts` file (not `.tsx`) so it's typechecked and testable
 * independent of the JSX wrapper. No React imports here.
 */
import type { OutputItem, ComponentItem } from "@flow-state-dev/core/items";

// ---------------------------------------------------------------------------
// Substrate-mirrored types
//
// Inlined to keep `@flow-state-dev/ui` registry-distributable without forcing
// `@flow-state-dev/tasks` as a runtime dependency on every consumer. The
// substrate's canonical types live in `@flow-state-dev/tasks/schema/task`;
// keep these in sync with that schema.
// ---------------------------------------------------------------------------

/**
 * Canonical task status set from the substrate. Open-ended at the consumer
 * boundary — pattern wrappers can emit additional `task-change.task.status`
 * values that should still render with the fallback config.
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

/** Mirror of `Task` from `@flow-state-dev/tasks`. Inlined to avoid the runtime dep. */
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

/** Lifecycle transition kinds from the substrate. Open-ended at the boundary. */
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

/** Latest board-level meta for a collection. */
export type BoardMeta = {
  /**
   * Open-ended status string. Substrate emits `"active" | "completed"`;
   * pattern wrappers may extend (`"planning"`, `"replanning"`, etc.).
   * `undefined` until the first `task-board-meta` item arrives.
   */
  status?: string;
  counts?: BoardCounts;
};

/** Resolved per-task entry. `kind` is the latest change kind seen for this task. */
export type TaskEntry = {
  task: Task;
  kind?: TaskChangeKind;
  prevStatus?: TaskStatus;
};

export type TaskPlanState = {
  collectionId: string;
  tasks: TaskEntry[];
  boardMeta: BoardMeta;
};

// ---------------------------------------------------------------------------
// Component item type strings — duplicated from substrate to keep the registry
// component free of `@flow-state-dev/tasks` / `@flow-state-dev/patterns`
// imports at runtime.
// ---------------------------------------------------------------------------

export const TASK_CHANGE_COMPONENT = "task-change";
export const TASK_BOARD_META_COMPONENT = "task-board-meta";

// ---------------------------------------------------------------------------
// Section ordering
// ---------------------------------------------------------------------------

/**
 * Canonical section order for `<TaskPlan />`. Sections render in this order;
 * empty sections hide. `cancelled` sits at the end and is hidden by default
 * via the `hiddenStatuses` prop — most consumers don't need to surface it.
 */
export const STATUS_SECTIONS: ReadonlyArray<{
  status: TaskStatus;
  label: string;
}> = [
  { status: "pending", label: "Todo" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "awaiting_review", label: "Awaiting review" },
  { status: "completed", label: "Done" },
  { status: "errored", label: "Failed" },
  { status: "cancelled", label: "Cancelled" },
];

/** Statuses hidden by default. `cancelled` is rarely useful in the chat UI surface. */
export const DEFAULT_HIDDEN_STATUSES: ReadonlyArray<TaskStatus> = ["cancelled"];

// ---------------------------------------------------------------------------
// Item-stream extraction
// ---------------------------------------------------------------------------

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
  counts?: BoardCounts;
};

function isComponentItem(item: OutputItem): item is ComponentItem {
  return item.type === "component";
}

/**
 * Walks a session-item array in reverse, taking the first match per
 * `${collectionId}/${taskId}` (latest-wins) plus the latest
 * `task-board-meta` for the collection. Mirrors the dedup pattern in
 * `useContainerItems` (`packages/react/src/hooks/useContainerItems.ts`).
 *
 * Reverse-scan is intentional: the server does not collapse by `key`, so
 * forward iteration with `Map.set` overwrites would do O(N) writes per task.
 * Reverse + first-match-wins is O(N) total with early-exit semantics per key.
 */
export function extractTaskPlanState(
  items: ReadonlyArray<OutputItem>,
  collectionId: string
): TaskPlanState {
  const tasks = new Map<string, TaskEntry>();
  let boardMeta: BoardMeta = {};
  let boardMetaResolved = false;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (!isComponentItem(item)) continue;

    if (item.component === TASK_CHANGE_COMPONENT) {
      const data = item.data as TaskChangeData;
      if (data.collectionId !== collectionId) continue;
      if (data.taskId === undefined || data.task === undefined) continue;
      if (tasks.has(data.taskId)) continue; // first match in reverse = latest
      tasks.set(data.taskId, {
        task: data.task,
        kind: data.kind,
        prevStatus: data.prevStatus,
      });
      continue;
    }

    if (item.component === TASK_BOARD_META_COMPONENT && !boardMetaResolved) {
      const data = item.data as TaskBoardMetaData;
      if (data.collectionId !== collectionId) continue;
      boardMeta = {
        status: data.status,
        counts: data.counts,
      };
      boardMetaResolved = true;
    }
  }

  return {
    collectionId,
    tasks: sortTasks([...tasks.values()]),
    boardMeta,
  };
}

/**
 * Default intra-section ordering: by `Task.createdAt` ascending, with
 * `Task.id` as the tiebreaker for deterministic rendering when timestamps
 * collide (sub-millisecond emissions in tests, etc).
 */
function sortTasks(entries: TaskEntry[]): TaskEntry[] {
  return entries.sort((a, b) => {
    const at = a.task.createdAt ?? 0;
    const bt = b.task.createdAt ?? 0;
    if (at !== bt) return at - bt;
    return a.task.id.localeCompare(b.task.id);
  });
}

// ---------------------------------------------------------------------------
// Section + assignee grouping
// ---------------------------------------------------------------------------

export type StatusGroup = {
  status: TaskStatus;
  label: string;
  entries: TaskEntry[];
};

/**
 * Buckets tasks into sections following `STATUS_SECTIONS` order. Empty
 * sections are dropped. Statuses outside the canonical set surface as their
 * own sections at the end (label = title-cased status), so pattern wrappers
 * extending the vocabulary still render.
 */
export function groupTasksByStatus(
  entries: ReadonlyArray<TaskEntry>,
  options?: { hiddenStatuses?: ReadonlyArray<TaskStatus> }
): StatusGroup[] {
  const hidden = new Set<TaskStatus>(
    options?.hiddenStatuses ?? DEFAULT_HIDDEN_STATUSES
  );

  const buckets = new Map<TaskStatus, TaskEntry[]>();
  for (const entry of entries) {
    if (hidden.has(entry.task.status)) continue;
    const list = buckets.get(entry.task.status);
    if (list === undefined) buckets.set(entry.task.status, [entry]);
    else list.push(entry);
  }

  const groups: StatusGroup[] = [];

  // Canonical sections first, in the documented order.
  for (const { status, label } of STATUS_SECTIONS) {
    if (hidden.has(status)) continue;
    const list = buckets.get(status);
    if (list === undefined || list.length === 0) continue;
    groups.push({ status, label, entries: list });
    buckets.delete(status);
  }

  // Any unknown statuses (pattern-extended) trail at the end.
  for (const [status, list] of buckets) {
    if (list.length === 0) continue;
    groups.push({ status, label: humanizeStatus(status), entries: list });
  }

  return groups;
}

/** "in_progress" → "In progress"; "needs-revision" → "Needs revision". */
export function humanizeStatus(status: string): string {
  if (status.length === 0) return status;
  const normalized = status.replace(/[-_]+/g, " ").trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export type AssigneeGroup = {
  assignee: string | null;
  label: string;
  entries: TaskEntry[];
};

/**
 * Sub-groups a status section's entries by `task.assignee`. Missing
 * assignees bucket as `null` with label "Unassigned". When all entries
 * share a single assignee the result is a single group — callers can choose
 * to skip rendering the sub-grouping in that case.
 */
export function groupTasksByAssignee(
  entries: ReadonlyArray<TaskEntry>
): AssigneeGroup[] {
  const buckets = new Map<string | null, TaskEntry[]>();
  for (const entry of entries) {
    const key = entry.task.assignee ?? null;
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [entry]);
    else list.push(entry);
  }

  const groups: AssigneeGroup[] = [];
  // Named assignees first (alphabetical), unassigned last so it doesn't
  // visually displace real assignees.
  const named = [...buckets.keys()].filter((k): k is string => k !== null).sort();
  for (const assignee of named) {
    groups.push({
      assignee,
      label: assignee,
      entries: buckets.get(assignee)!,
    });
  }
  if (buckets.has(null)) {
    groups.push({
      assignee: null,
      label: "Unassigned",
      entries: buckets.get(null)!,
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Collection discovery (DevTool)
// ---------------------------------------------------------------------------

/**
 * Scans an item array for every distinct `collectionId` referenced by a
 * `task-change` or `task-board-meta` component item. Used by the DevTool
 * task-collections panel to enumerate boards in the active session without
 * any pattern-specific knowledge.
 */
export function discoverCollections(
  items: ReadonlyArray<OutputItem>
): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (!isComponentItem(item)) continue;
    if (
      item.component !== TASK_CHANGE_COMPONENT &&
      item.component !== TASK_BOARD_META_COMPONENT
    ) {
      continue;
    }
    const data = item.data as { collectionId?: string };
    if (typeof data.collectionId === "string" && data.collectionId.length > 0) {
      ids.add(data.collectionId);
    }
  }
  return [...ids].sort();
}
