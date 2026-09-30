/**
 * Style 2 intake — no webhook. Desk hops here, then we hop to triage.
 */
import { defineFlow, dispatcher, sequencer } from "@flow-state-dev/core";
import {
  inboundInputSchema,
  inboundOutputSchema,
  recordInbound,
} from "../../../shared/handlers";
import { FANIN_INTAKE_KIND, FANIN_TRIAGE_KIND } from "../../../shared/scenario";

const hopToTriage = dispatcher({
  name: "intake-to-triage",
  type: "internal",
  flowKind: FANIN_TRIAGE_KIND,
  action: "note",
  inputSchema: inboundOutputSchema,
  session: { key: (input) => `${input.repo}#${input.number}` },
  payload: (input) => ({
    kind: "issue-opened",
    repo: input.repo,
    number: input.number,
    title: input.title,
  }),
});

const recordThenHop = sequencer({
  name: "record-then-hop",
  inputSchema: inboundInputSchema,
})
  .step(recordInbound)
  .step(hopToTriage);

export const githubIntakeKind = defineFlow({
  kind: FANIN_INTAKE_KIND,
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

export default githubIntakeKind();
