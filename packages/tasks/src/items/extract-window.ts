/**
 * Per-task item windowing — promoted from the kitchen-sink renderer's
 * `extractTaskItemWindows` (FIX-480 §3.1).
 *
 * The substrate emits one `task-change` component item per lifecycle
 * transition keyed by `${collectionId}/${taskId}`. Pattern aggregators
 * (synthesizer prompt builders, reviewer input builders) and the renderer
 * both want the same answer: "given a session item log, which items did
 * worker X emit while it held its claim?".
 *
 * Window boundaries:
 *   - start: the `task-change` with `kind: "claimed"` for that task
 *     (first claim wins — retries do not reset).
 *   - end: the next terminal `task-change` (`completed`, `errored`, or
 *     `cancelled`). `kind: "retried"` does NOT close the window —
 *     subsequent attempts append to the same task's items so consumers
 *     see the full attempt history (FIX-480 §5).
 *
 * Items emitted before the first claim (e.g. seed-time `added` events)
 * are not part of any task's window. The bookend `task-change` items
 * themselves are excluded — they're consumed by the lifecycle UI, not
 * by per-task expansion. `task-board-meta` items are also excluded so
 * a per-task expansion does not recursively re-render the board.
 *
 * Windows use `item.ts` (timestamp), not `item.itemIndex`. itemIndex is
 * not monotonic across emit batches — multiple items can share an
 * index, and AI-SDK-driven emissions sometimes land out of order in
 * itemIndex but inside the chronological window.
 */
import type { OutputItem, ComponentItem } from "@flow-state-dev/core/items";

/** Component-item type used by the substrate for task lifecycle events. */
const TASK_CHANGE_COMPONENT = "task-change";
/** Component-item type used by the substrate for board-level meta. */
const TASK_BOARD_META_COMPONENT = "task-board-meta";

export interface TaskItemWindow {
  /** First `claimed` event ts for this task. `undefined` → never claimed. */
  start: number | undefined;
  /** Terminal event ts (`completed | errored | cancelled`). `undefined` → still in flight or never terminal. */
  end: number | undefined;
}

type TaskChangeData = {
  collectionId?: string;
  taskId?: string;
  kind?: string;
};

function isComponentItem(item: OutputItem): item is ComponentItem {
  return item.type === "component";
}

/**
 * Compute item windows for every taskId observed in `items` under the
 * given `collectionId`. First-claim-wins for `start` (retries do NOT
 * reset). Last terminal kind wins for `end`. Windows for in-flight or
 * abandoned tasks have `end: undefined` (over-inclusive — caller decides
 * whether to filter further).
 */
export function computeTaskItemWindows(
  items: readonly OutputItem[],
  collectionId: string,
): Map<string, TaskItemWindow> {
  const startTs = new Map<string, number>();
  const endTs = new Map<string, number>();

  for (const item of items) {
    if (!isComponentItem(item)) continue;
    if (item.component !== TASK_CHANGE_COMPONENT) continue;
    const data = item.data as TaskChangeData;
    if (data.collectionId !== collectionId) continue;
    if (data.taskId === undefined) continue;

    if (data.kind === "claimed" && !startTs.has(data.taskId)) {
      startTs.set(data.taskId, item.ts);
    } else if (
      data.kind === "completed" ||
      data.kind === "errored" ||
      data.kind === "cancelled"
    ) {
      endTs.set(data.taskId, item.ts);
    }
  }

  const windows = new Map<string, TaskItemWindow>();
  for (const [taskId, start] of startTs) {
    windows.set(taskId, { start, end: endTs.get(taskId) });
  }
  return windows;
}

/**
 * Extract items in the window for one (collectionId, taskId).
 *
 * Exclusion rule: `task-change` and `task-board-meta` component items
 * are blanket-skipped regardless of their `data.collectionId`. They are
 * substrate scaffolding (claim/terminal events, meta panels) for any
 * collection — including nested worker boards — and never represent
 * worker emissions, so they are never returned by `task.items()`.
 *
 * Returns `[]` when the task has not been claimed yet.
 *
 * Items between `start` and `end` (or after `start` when `end` is
 * undefined) are returned. An item is NOT duplicated across overlapping
 * windows — when this function is called per-task, each item is
 * independently tested against the requested task's window only.
 */
export function extractTaskItems(
  items: readonly OutputItem[],
  collectionId: string,
  taskId: string,
): readonly OutputItem[] {
  let start: number | undefined;
  let end: number | undefined;

  for (const item of items) {
    if (!isComponentItem(item)) continue;
    if (item.component !== TASK_CHANGE_COMPONENT) continue;
    const data = item.data as TaskChangeData;
    if (data.collectionId !== collectionId) continue;
    if (data.taskId !== taskId) continue;

    if (data.kind === "claimed" && start === undefined) {
      start = item.ts;
    } else if (
      data.kind === "completed" ||
      data.kind === "errored" ||
      data.kind === "cancelled"
    ) {
      end = item.ts;
    }
  }

  if (start === undefined) return [];

  const result: OutputItem[] = [];
  for (const item of items) {
    if (isComponentItem(item)) {
      if (
        item.component === TASK_CHANGE_COMPONENT ||
        item.component === TASK_BOARD_META_COMPONENT
      ) {
        continue;
      }
    }
    if (item.ts < start) continue;
    if (end !== undefined && item.ts > end) continue;
    result.push(item);
  }
  return result;
}

/**
 * Multi-task variant that mirrors the renderer's `extractTaskItemWindows`
 * exactly: walks all `task-change` items for `collectionId` to build
 * (start, end) maps, then assigns each non-bookend item to the FIRST
 * task whose window contains its `ts`. An item lands in at most one
 * task's bucket — never duplicated across overlapping windows.
 *
 * Use this when bucketing every item in a stream at once (renderer use
 * case). For server-side single-task reads, `extractTaskItems` is the
 * cheaper path.
 */
export function extractTaskItemWindows(
  items: readonly OutputItem[],
  collectionId: string,
): Map<string, OutputItem[]> {
  const windows = new Map<string, OutputItem[]>();
  const startTs = new Map<string, number>();
  const endTs = new Map<string, number>();

  for (const item of items) {
    if (!isComponentItem(item)) continue;
    if (item.component !== TASK_CHANGE_COMPONENT) continue;
    const data = item.data as TaskChangeData;
    if (data.collectionId !== collectionId) continue;
    if (data.taskId === undefined) continue;

    if (data.kind === "claimed" && !startTs.has(data.taskId)) {
      startTs.set(data.taskId, item.ts);
    } else if (
      data.kind === "completed" ||
      data.kind === "errored" ||
      data.kind === "cancelled"
    ) {
      endTs.set(data.taskId, item.ts);
    }
  }

  if (startTs.size === 0) return windows;

  for (const item of items) {
    if (isComponentItem(item)) {
      if (
        item.component === TASK_CHANGE_COMPONENT ||
        item.component === TASK_BOARD_META_COMPONENT
      ) {
        continue;
      }
    }
    for (const [taskId, start] of startTs) {
      if (item.ts < start) continue;
      const end = endTs.get(taskId);
      if (end !== undefined && item.ts > end) continue;
      let bucket = windows.get(taskId);
      if (bucket === undefined) {
        bucket = [];
        windows.set(taskId, bucket);
      }
      bucket.push(item);
      break;
    }
  }

  return windows;
}
