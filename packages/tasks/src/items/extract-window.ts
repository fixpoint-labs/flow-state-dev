/**
 * Per-task item windowing — promoted from the kitchen-sink renderer's
 * `extractTaskItemWindows` (FIX-480 §3.1).
 *
 * Pattern aggregators (synthesizer prompt builders, reviewer input
 * builders) and the renderer both want the same answer: "given a session
 * item log, which items did worker X emit while it held its claim?".
 *
 * Window boundaries:
 *   - start: first `task-change { kind: "claimed" }` for the task (first
 *     wins — retries do not reset).
 *   - end: terminal `task-change` (`completed | errored | cancelled`).
 *     `kind: "retried"` does NOT close the window — subsequent attempts
 *     append to the same window so consumers see the full attempt
 *     history (FIX-480 §5).
 *
 * Items emitted before the first claim are not part of any task's
 * window. Bookend `task-change` and `task-board-meta` items are excluded
 * — they're substrate scaffolding, not worker emissions.
 *
 * Windows use `item.ts` (timestamp), not `item.itemIndex`. itemIndex is
 * not monotonic across emit batches; AI-SDK-driven emissions sometimes
 * land out of order in itemIndex but inside the chronological window.
 */
import type { OutputItem, ComponentItem } from "@flow-state-dev/core/items";

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

function isBookendComponent(item: OutputItem): boolean {
  return (
    isComponentItem(item) &&
    (item.component === TASK_CHANGE_COMPONENT ||
      item.component === TASK_BOARD_META_COMPONENT)
  );
}

/**
 * Single-pass scan over `task-change` items in `collectionId`. Builds
 * first-claim-wins start ts and last-terminal-wins end ts maps per
 * taskId. Used by both the single-task and multi-task extractors.
 */
function scanTaskWindows(
  items: readonly OutputItem[],
  collectionId: string,
): { startTs: Map<string, number>; endTs: Map<string, number> } {
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

  return { startTs, endTs };
}

/**
 * Items emitted in `(collectionId, taskId)`'s claim window. Returns `[]`
 * when the task has never been claimed.
 */
export function extractTaskItems(
  items: readonly OutputItem[],
  collectionId: string,
  taskId: string,
): readonly OutputItem[] {
  const { startTs, endTs } = scanTaskWindows(items, collectionId);
  const start = startTs.get(taskId);
  if (start === undefined) return [];
  const end = endTs.get(taskId);

  const result: OutputItem[] = [];
  for (const item of items) {
    if (isBookendComponent(item)) continue;
    if (item.ts < start) continue;
    if (end !== undefined && item.ts > end) continue;
    result.push(item);
  }
  return result;
}

/**
 * Multi-task variant. Each non-bookend item is assigned to the FIRST
 * task whose window contains its `ts` — never duplicated across
 * overlapping windows. This mirrors the renderer's
 * `collectTaskOwnedItemIds` (assign-once), not its
 * `extractTaskItemWindows` (assign-to-all-overlapping). The spec calls
 * for "no duplication" so synthesizers iterating completed tasks don't
 * see the same item twice.
 */
export function extractTaskItemWindows(
  items: readonly OutputItem[],
  collectionId: string,
): Map<string, OutputItem[]> {
  const { startTs, endTs } = scanTaskWindows(items, collectionId);
  const windows = new Map<string, OutputItem[]>();
  if (startTs.size === 0) return windows;

  for (const item of items) {
    if (isBookendComponent(item)) continue;
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
