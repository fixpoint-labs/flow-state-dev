/**
 * B — hop target. No schedule. No webhook.
 */
import { defineFlow } from "@flow-state-dev/core";
import { noteTriage } from "../../../shared/handlers";
import { DESK_TRIAGE_KIND } from "../../../shared/scenario";

export const inboxTriageFlow = defineFlow({
  kind: DESK_TRIAGE_KIND,
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

export default inboxTriageFlow();
