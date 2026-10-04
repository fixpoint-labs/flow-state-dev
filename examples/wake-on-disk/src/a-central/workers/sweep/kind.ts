/**
 * Sweep seat kind — work only. No schedules. No webhooks.
 *
 * The clock lives on `a-central/ingress/night-watch.ts`. This file is the
 * kind `WORKER.md` names with `flow: night-sweep`.
 */
import { defineFlow } from "@flow-state-dev/core";
import { sweepOpenTickets } from "../../../shared/handlers";
import { CENTRAL_SWEEP_KIND } from "../../../shared/scenario";

export const nightSweepKind = defineFlow({
  kind: CENTRAL_SWEEP_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    sweep: { block: sweepOpenTickets },
  },
  internal: {
    actions: {
      sweep: { block: sweepOpenTickets },
    },
  },
});

export default nightSweepKind();
