/**
 * Per-task item attribution — the substrate's view of "which items did worker
 * X emit while it held task T?". Promoted from the kitchen-sink renderer
 * (FIX-480) and, since FIX-658, delegated to the single shared algorithm in
 * `@flow-state-dev/core/items` so the substrate (`task.items()`) and the UI
 * (`<TaskPlan />`) return identical answers.
 *
 * Attribution is by the `taskId` stamped on each item at emit time (the
 * worker body marks its scope via `ctx._markTaskScope`), not by timestamp
 * windows. Timestamps could not separate a sibling worker running concurrently
 * inside a still-open window; the emit-time stamp can. Items the SUBSTRATE
 * emitted about itself are excluded — `task-change`, `task-board-meta` and
 * `task-board-recorder-failure`. They carry a `taskId` and are not the
 * worker's output; the canonical list and the rule behind it live with the
 * algorithm, in `@flow-state-dev/core/items`.
 *
 * These wrappers keep their original names and signatures (consumed by
 * `collection/internal.ts`, the supervisor synthesizer, and the UI); only the
 * mechanism behind them changed.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { attributeItemsToTasks, itemsForTask } from "@flow-state-dev/core/items";

/**
 * Items emitted under `(collectionId, taskId)`, in stream order. Returns `[]`
 * when the task was never claimed. Unions all attempts of a re-claimed task.
 */
export function extractTaskItems(
  items: readonly OutputItem[],
  collectionId: string,
  taskId: string,
): readonly OutputItem[] {
  return itemsForTask(items, collectionId, taskId);
}

/**
 * Per-task buckets for `collectionId`. Each item that is not a substrate
 * component is attributed to exactly one task by its emit-time `taskId` —
 * never duplicated across tasks.
 */
export function extractTaskItemWindows(
  items: readonly OutputItem[],
  collectionId: string,
): Map<string, OutputItem[]> {
  return attributeItemsToTasks(items, collectionId);
}
