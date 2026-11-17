/**
 * `@flow-state-dev/scheduled` — what a flow needs to keep and resolve dynamic
 * schedules: schedule collections, the resolver over them, the schedule-index
 * contract a store implements, and next-run math.
 *
 * The dispatch endpoint a schedule fires through is the engine's own, mounted
 * by the router on every app (`/api/flows/:kind/schedules/*id/dispatch`); a
 * flow declares `schedules` and nothing more is wired. This package imports no
 * engine. `./collection` is the same surface without `createBadCronWarner`,
 * and `./testing` holds the schedule-index conformance suite.
 */
export {
  createResourceCollectionScheduleResolver,
  defaultParseScheduleId,
  type CreateResourceCollectionScheduleResolverOptions,
  type ParsedScheduleId,
  type ScheduleResourceState
} from "./createResourceCollectionScheduleResolver";

export {
  type ScheduleIndex,
  type ScheduleIndexEntry
} from "./scheduleIndex";

export {
  defineScheduleCollection,
  type DefineScheduleCollectionOptions,
  type ScheduleCollectionState
} from "./defineScheduleCollection";

export { createBadCronWarner, type BadCronWarner } from "./createBadCronWarner";

export { parseNextFireAt } from "./parseNextFireAt";
