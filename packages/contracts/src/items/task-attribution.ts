/**
 * Per-task item attribution (FIX-658) — the single shared algorithm consumed
 * by both the substrate (`task.items()` via `@flow-state-dev/tasks`) and the
 * UI (`<TaskPlan />` / `<RequestGroupRenderer>` via `@flow-state-dev/ui`), so
 * the two always return the same answer.
 *
 * Attribution is by the `taskId` stamped on each item at emit time (set by a
 * worker scope via `ctx._markTaskScope`), not by timestamp windows. Timestamp
 * windowing could not separate concurrent producers: while a worker is still
 * in its loop its window is open `[claimed, now)`, so a sibling worker's whole
 * lifecycle fell inside it. The emit-time stamp captures the worker's active
 * task directly, so concurrent siblings and sequential turns of one worker are
 * always disjoint.
 *
 * Collection scoping: items carry only `taskId`, not a collection id. A pass
 * scoped to `collectionId` learns which task ids belong to that collection
 * from the `task-change` events already in the log (keyed by
 * `${collectionId}/${taskId}`), then keeps only items whose `taskId` is in
 * that set. Task ids are unique per collection; the rare nested-board case
 * where an inner and outer collection reuse the same task id is the one place
 * this can over-include, which the previous timestamp model also could not
 * resolve.
 *
 * Bookend `task-change` and `task-board-meta` items are always excluded — they
 * are substrate scaffolding (status grouping / mounting `<TaskPlan />`), not
 * worker emissions, even though a terminal `task-change` emitted by the worker
 * body itself carries a `taskId`.
 */
import type { OutputItem, ComponentItem } from "./types";

const TASK_CHANGE_COMPONENT = "task-change";
const TASK_BOARD_META_COMPONENT = "task-board-meta";

type TaskChangeData = {
  collectionId?: string;
  taskId?: string;
  kind?: string;
};

function isComponentItem(item: OutputItem): item is ComponentItem {
  return item.type === "component";
}

/**
 * True for substrate scaffolding items that drive `<TaskPlan />` status
 * grouping / mount the board component. Never part of a task's item bucket.
 */
function isBookendComponent(item: OutputItem): boolean {
  return (
    isComponentItem(item) &&
    (item.component === TASK_CHANGE_COMPONENT ||
      item.component === TASK_BOARD_META_COMPONENT)
  );
}

/**
 * The set of task ids that belong to `collectionId`, learned from its
 * `task-change` events. Used to scope attribution to one collection when items
 * only carry a bare `taskId`.
 */
function collectionTaskIds(
  items: readonly OutputItem[],
  collectionId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (!isComponentItem(item)) continue;
    if (item.component !== TASK_CHANGE_COMPONENT) continue;
    const data = item.data as TaskChangeData;
    if (data.collectionId !== collectionId) continue;
    if (data.taskId === undefined) continue;
    ids.add(data.taskId);
  }
  return ids;
}

/**
 * Group the items emitted under each task of `collectionId`, in stream order.
 * Every returned item belongs to exactly one task; concurrent siblings and
 * sequential turns are disjoint by construction. Items with no `taskId`
 * (emitted outside any task scope) and bookend components are excluded.
 */
export function attributeItemsToTasks(
  items: readonly OutputItem[],
  collectionId: string,
): Map<string, OutputItem[]> {
  const ids = collectionTaskIds(items, collectionId);
  const buckets = new Map<string, OutputItem[]>();
  if (ids.size === 0) return buckets;

  for (const item of items) {
    if (isBookendComponent(item)) continue;
    const taskId = item.taskId;
    if (taskId === undefined || !ids.has(taskId)) continue;
    let bucket = buckets.get(taskId);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(taskId, bucket);
    }
    bucket.push(item);
  }

  return buckets;
}

/**
 * Items emitted under `(collectionId, taskId)`, in stream order. Returns `[]`
 * when the task has no `task-change` events in the log (never claimed).
 * Unions all attempts of a re-claimed task — the second claim emits items
 * stamped with the same `taskId`.
 */
export function itemsForTask(
  items: readonly OutputItem[],
  collectionId: string,
  taskId: string,
): readonly OutputItem[] {
  const ids = collectionTaskIds(items, collectionId);
  if (!ids.has(taskId)) return [];

  const result: OutputItem[] = [];
  for (const item of items) {
    if (isBookendComponent(item)) continue;
    if (item.taskId !== taskId) continue;
    result.push(item);
  }
  return result;
}

/**
 * The set of `item.id` for every item owned by some task, across all
 * collections. The chat-level `<RequestGroupRenderer>` uses this to skip items
 * that belong to a task so they render inside the task's `<TaskPlan />`
 * expansion only, not also inline in the thread. Bookend components are
 * excluded — they mount/group the board rather than belonging to a task.
 *
 * Unlike the other two helpers, this does NOT gate on a collection's
 * `task-change` task ids: it is collection-agnostic by design (the chat thread
 * dedups across every board at once), and any item carrying a `taskId` was
 * stamped under a real worker scope — which always emits `task-change` events
 * for the task — so there is no orphaned-`taskId` case to guard against.
 */
export function collectAttributedItemIds(
  items: readonly OutputItem[],
): Set<string> {
  const owned = new Set<string>();
  for (const item of items) {
    if (item.taskId === undefined) continue;
    if (isBookendComponent(item)) continue;
    owned.add(item.id);
  }
  return owned;
}
