/**
 * `@flow-state-dev/scheduled/collection` — what a flow definition needs to keep
 * and resolve dynamic schedules, without loading the engine: the schedule
 * collection, its resolver, the dispatch id's format, and next-run math.
 *
 * The package's root entry also mounts the dispatch endpoint, which runs on
 * the engine. A package that defines flows but must not load the engine
 * (Workforce) imports from here instead. Keep this graph engine-free: the
 * resolver takes the engine's user-key derivation from its context
 * (`ScheduleResolutionContext.userStorageKey`), which the endpoint supplies.
 */
export {
  createResourceCollectionScheduleResolver,
  defaultParseScheduleId,
  formatScheduleId,
  type CreateResourceCollectionScheduleResolverOptions,
  type ParsedScheduleId,
  type ScheduleResourceState
} from "./createResourceCollectionScheduleResolver";

export {
  defineScheduleCollection,
  type DefineScheduleCollectionOptions,
  type ScheduleCollectionState
} from "./defineScheduleCollection";

export { type ScheduleIndex, type ScheduleIndexRow } from "./scheduleIndex";

export { parseNextFireAt } from "./parseNextFireAt";

export { FIRED_RECORDS_PATTERN, firedRecordCollectionKey } from "./firedRecords";
