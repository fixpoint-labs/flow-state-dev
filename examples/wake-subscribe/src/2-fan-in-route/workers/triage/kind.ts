/**
 * Style 2 triage — hop target only.
 */
import { defineFlow } from "@flow-state-dev/core";
import { noteTriage } from "../../../shared/handlers";
import { FANIN_TRIAGE_KIND } from "../../../shared/scenario";

export const githubTriageKind = defineFlow({
  kind: FANIN_TRIAGE_KIND,
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

export default githubTriageKind();
