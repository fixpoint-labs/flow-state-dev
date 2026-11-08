// FIX-480 §3.1.
/**
 * `task.items()` substrate utilities.
 *
 * Window extraction for per-task item slices on the session item log.
 * Used by the substrate `TaskHandle.items()` accessor and by any
 * consumer that wants the same algorithm without going through a
 * `TaskCollection`.
 */
export { extractTaskItems } from "./extract-window";
