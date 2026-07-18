/**
 * `task.items()` substrate utilities (FIX-480 §3.1).
 *
 * Window extraction for per-task item slices on the session item log.
 * Used by the substrate `TaskHandle.items()` accessor and by any
 * consumer that wants the same algorithm without going through a
 * `TaskCollection`.
 */
export {
  extractTaskItems,
  extractTaskItemWindows,
} from "./extract-window";
