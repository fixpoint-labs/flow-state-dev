/**
 * `task.items()` substrate utilities (FIX-480 §3.1).
 *
 * Window extraction for per-task item slices on the session item log.
 * Used by both the substrate `TaskHandle.items()` accessor and the
 * kitchen-sink renderer's `<TaskPlan />`.
 */
export {
  computeTaskItemWindows,
  extractTaskItems,
  extractTaskItemWindows,
  type TaskItemWindow,
} from "./extract-window";
