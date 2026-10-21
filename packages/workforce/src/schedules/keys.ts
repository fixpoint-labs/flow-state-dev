/**
 * The names recurring work pins (FIX-2085): where a user's schedules are
 * stored, the accessor the roster flow declares them under, the one schedule
 * handler Workforce keeps (a row's `kind: "task"`), and the internal entry a
 * fire files its task through. A leaf module with no imports, so the session
 * board and the roster flow share one spelling of each.
 */

/**
 * Where a user's schedules are stored, one row per schedule, at user scope
 * (per organization). **Pinned**: persisted, and part of each schedule's
 * dispatch id (`<orgId>/<userId>/<key>`, the key relative to this pattern).
 */
export const SCHEDULES_PATTERN = "workforce/schedules/*";

/** The accessor the roster flow declares the user's schedule collection under. */
export const SCHEDULES_RESOURCE = "workforceSchedules";

/**
 * The schedule handler Workforce keeps, a row's `kind: "task"`: a fire files an
 * ordinary task on the board of the worker its `input.filer` names. **Pinned**:
 * persisted on each row.
 */
export const TASK_SCHEDULE_HANDLER = "task";

/**
 * The internal entry on a worker flow that files a scheduled task in the
 * user's conversation with the flow's worker, through the board's own filing.
 * Reached only by a fire's dispatch, never by a caller.
 */
export const FILE_SCHEDULED_TASK_ENTRY = "fileScheduledTask";

/** The roster flow action a screen lists the user's schedules through, each with its next run. */
export const LIST_SCHEDULES_ACTION = "listSchedules";
