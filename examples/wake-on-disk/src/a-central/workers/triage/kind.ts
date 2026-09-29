/**
 * Triage seat — receives the tiny cross-flow hop. No clock, no webhook.
 */
import { defineFlow } from "@flow-state-dev/core";
import { noteTriage } from "../../../shared/handlers";
import { CENTRAL_TRIAGE_KIND } from "../../../shared/scenario";

export const nightTriageKind = defineFlow({
  kind: CENTRAL_TRIAGE_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    note: { block: noteTriage },
  },
  internal: {
    actions: {
      note: { block: noteTriage },
    },
  },
});

export default nightTriageKind();
