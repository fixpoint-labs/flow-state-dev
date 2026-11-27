/**
 * `@flow-state-dev/scheduled/collection` — what a flow definition needs to keep
 * and resolve dynamic schedules: the schedule collection, its resolver, the
 * dispatch id's parser and next-run math. The tick that claims due entries and
 * the endpoint it dispatches to are the engine's (`createFlowState({ scheduler })`,
 * the router's built-in scheduled endpoint); the id format and the fired-record
 * key are core's (`formatScheduleId`, `firedRecordCollectionKey`).
 *
 * Keep this graph engine-free: the resolver takes the engine's user-key
 * derivation from its context (`ScheduleResolutionContext.userStorageKey`),
 * which the endpoint supplies.
 */
export {
  createResourceCollectionScheduleResolver,
  defaultParseScheduleId,
  type CreateResourceCollectionScheduleResolverOptions,
  type ParsedScheduleId,
  type ScheduleResourceState
} from "./createResourceCollectionScheduleResolver";

export {
  defineScheduleCollection,
  type DefineScheduleCollectionOptions,
  type ScheduleCollectionState
} from "./defineScheduleCollection";

export { type ScheduleIndex, type ScheduleIndexEntry } from "./scheduleIndex";

export { parseNextFireAt } from "./parseNextFireAt";

