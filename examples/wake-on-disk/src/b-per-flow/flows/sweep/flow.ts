/**
 * B — this flow owns its clock.
 *
 *   POST /api/flows/inbox-sweep/schedules/sweep-open/dispatch
 *
 * Session: scheduled transport always starts a **new** session.
 * This file does not resume last night's sweep conversation.
 */
import {
  defineFlow,
  defineScheduleBinding,
  type ScheduleInputContext,
} from "@flow-state-dev/core";
import { sweepOpenTickets } from "../../../shared/handlers";
import { inspectLayout } from "../../../shared/inspect";
import {
  DESK_SWEEP_KIND,
  SWEEP_CRON,
  SWEEP_SCHEDULE_ID,
  SWEEP_TIMEZONE,
} from "../../../shared/scenario";

const inspect = inspectLayout("per-flow", [
  {
    path: "b-per-flow/flows/sweep/flow.ts",
    fires: "Host POSTs this flow's sweep-open dispatch every 15 min.",
    runs: "sweep-open-tickets",
    sessionOwner: "This flow. New session each tick.",
  },
]);

export const inboxSweepFlow = defineFlow({
  kind: DESK_SWEEP_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    inspect: { block: inspect },
    sweep: { block: sweepOpenTickets },
  },
  schedules: {
    static: {
      [SWEEP_SCHEDULE_ID]: defineScheduleBinding({
        cron: SWEEP_CRON,
        timezone: SWEEP_TIMEZONE,
        onOverlap: "skip",
        description: "Sweep open tickets every 15 minutes",
        block: sweepOpenTickets,
        input: (ctx: ScheduleInputContext) => ({
          reason: "interval",
          nominalFireTime: ctx.nominalFireTime,
        }),
      }),
    },
  },
});

export default inboxSweepFlow();
