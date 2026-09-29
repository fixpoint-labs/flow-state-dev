/**
 * Intake seat kind — record the issue, then hop to triage.
 *
 * No schedules. No webhooks. The GitHub binding lives on the ingress.
 */
import { defineFlow, dispatcher, sequencer } from "@flow-state-dev/core";
import {
  inboundInputSchema,
  inboundOutputSchema,
  recordInboundIssue,
} from "../../../shared/handlers";
import { CENTRAL_INTAKE_KIND, CENTRAL_TRIAGE_KIND } from "../../../shared/scenario";

const hopToTriage = dispatcher({
  name: "hop-to-triage",
  type: "internal",
  flowKind: CENTRAL_TRIAGE_KIND,
  action: "note",
  inputSchema: inboundOutputSchema,
  session: { key: (input) => `${input.repo}#${input.issueNumber}` },
  payload: (input) => ({
    kind: "issue-opened",
    repo: input.repo,
    issueNumber: input.issueNumber,
    title: input.title,
  }),
});

const recordThenHop = sequencer({
  name: "record-then-hop",
  inputSchema: inboundInputSchema,
})
  .step(recordInboundIssue)
  .step(hopToTriage);

export const nightIntakeKind = defineFlow({
  kind: CENTRAL_INTAKE_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    record: { block: recordThenHop },
  },
  internal: {
    actions: {
      record: { block: recordThenHop },
    },
  },
});

export default nightIntakeKind();
