/**
 * `@flow-state-dev/scheduled` — scheduled-actions transport adapter.
 *
 * Mounts a single dispatch endpoint per flow:
 *
 *   POST /api/flows/:kind/schedules/:scheduleId/dispatch
 *
 * The engine's schedule tick POSTs to this endpoint when a schedule is
 * due: each minute from the local cron (`createFlowState`'s default), or
 * once per call of a scheduler adapter's route (`vercelScheduler()` from
 * `@flow-state-dev/vercel`). The framework owns the configuration model
 * (`schedules` on `defineFlow`), dispatch contract, two-phase auth
 * (gateway → schedule.principal), one firing per scheduled time, and provenance
 * stamping (`source: 'scheduled'`).
 *
 *   import { createFlowApiRouter } from "@flow-state-dev/engine";
 *   import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
 *
 *   const router = createFlowApiRouter({
 *     registry,
 *     stores,
 *     adapters: [createScheduledTransportAdapter()]
 *   });
 *
 * V1 ships singleton invocation per dispatch — one tick → one
 * `runAction` call. Fan-out (one tick → many invocations) is a follow-up.
 */
export {
  createScheduledTransportAdapter,
  SCHEDULED_TRANSPORT_SOURCE,
  type CreateScheduledTransportAdapterOptions
} from "./createScheduledTransportAdapter";

export { findScheduledRequest } from "./findScheduledRequest";

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
