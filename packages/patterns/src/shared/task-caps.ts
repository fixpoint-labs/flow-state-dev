import type { TaskCapOptions } from "@flow-state-dev/orchestration";

/**
 * Forward only the task-cap fields a pattern caller actually set.
 *
 * `taskBoard` applies defaults for omitted axes. These conditional spreads
 * keep omission as omission (`undefined` is not forwarded) and `null` as
 * the explicit unbounded opt-out. One helper so a fourth cap is a one-file
 * change instead of an edit in every pattern factory.
 */
export function pickTaskCapOverrides(config: TaskCapOptions): TaskCapOptions {
  return {
    ...(config.maxTotalRetries !== undefined
      ? { maxTotalRetries: config.maxTotalRetries }
      : {}),
    ...(config.maxTotalTasks !== undefined ? { maxTotalTasks: config.maxTotalTasks } : {}),
    ...(config.maxEnqueuedTasks !== undefined
      ? { maxEnqueuedTasks: config.maxEnqueuedTasks }
      : {}),
  };
}
