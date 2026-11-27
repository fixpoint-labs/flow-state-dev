// FIX-2085; FIX-2614.
/**
 * Clock routines: a schedule in the user's schedule collection that files an
 * ordinary task on a worker's board each time it is due. The roster flow keeps
 * and fires them; the routine verbs (`../routines`) list and write them.
 */
export { SCHEDULES_PATTERN, SCHEDULES_RESOURCE, TASK_SCHEDULE_HANDLER } from "./keys";
export { scheduledTaskInputSchema, type ScheduledTaskInput } from "./scheduled-work";
