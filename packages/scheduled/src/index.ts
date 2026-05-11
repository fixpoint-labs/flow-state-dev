/**
 * `@flow-state-dev/scheduled` — scheduled-actions transport adapter.
 *
 * Mounts a single dispatch endpoint per flow:
 *
 *   POST /api/flows/:kind/schedules/:scheduleId/dispatch
 *
 * Hosts run their own scheduler (Vercel Cron, Cloud Scheduler,
 * EventBridge, GitHub Actions, `node-cron`) and POST to this endpoint
 * when a schedule is due. The framework owns the configuration model
 * (`schedules` on `defineFlow`), dispatch contract, two-phase auth
 * (gateway → schedule.principal), idempotency dedupe, and provenance
 * stamping (`source: 'scheduled'`).
 *
 *   import { createFlowApiRouter } from "@flow-state-dev/server";
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
