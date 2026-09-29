/**
 * Style 2 reviewer seat — no webhook. Desk hops here.
 */
import { defineFlow } from "@flow-state-dev/core";
import { recordInbound } from "../../../shared/handlers";
import { FANIN_REVIEWER_KIND } from "../../../shared/scenario";

export const githubReviewerKind = defineFlow({
  kind: FANIN_REVIEWER_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    record: { block: recordInbound },
  },
  internal: {
    actions: {
      record: { block: recordInbound },
    },
  },
});

export default githubReviewerKind();
