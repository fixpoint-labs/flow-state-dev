/**
 * Style 1 triage — hop target only. No webhook, no subscribe.
 */
import { defineFlow } from "@flow-state-dev/core";
import { noteTriage } from "../../../shared/handlers";
import { SESSION_TRIAGE_KIND } from "../../../shared/scenario";

export const prTriageKind = defineFlow({
  kind: SESSION_TRIAGE_KIND,
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

export default prTriageKind();
