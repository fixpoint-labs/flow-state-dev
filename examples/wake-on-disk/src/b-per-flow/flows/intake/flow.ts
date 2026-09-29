/**
 * B — this flow owns its GitHub hook, its action, and its session id.
 *
 *   POST /api/flows/inbox-intake/webhooks/github
 *
 * After record, one hop to inbox-triage via dispatcher({ flowKind, action, session }).
 */
import { defineFlow, defineWebhookBinding, dispatcher, sequencer } from "@flow-state-dev/core";
import {
  inboundFromGitHubIssue,
  isIssueOpened,
  issueSessionId,
  type GitHubIssuesEvent,
} from "../../../shared/github-issues";
import {
  inboundInputSchema,
  inboundOutputSchema,
  recordInboundIssue,
} from "../../../shared/handlers";
import {
  DESK_INTAKE_KIND,
  DESK_TRIAGE_KIND,
  GITHUB_ISSUES_EVENT,
  GITHUB_PROVIDER,
} from "../../../shared/scenario";

const hopToTriage = dispatcher({
  name: "hop-to-triage",
  type: "internal",
  flowKind: DESK_TRIAGE_KIND,
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

export const inboxIntakeFlow = defineFlow({
  kind: DESK_INTAKE_KIND,
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
  webhooks: {
    [GITHUB_PROVIDER]: {
      on: {
        [GITHUB_ISSUES_EVENT]: defineWebhookBinding<GitHubIssuesEvent>({
          block: recordThenHop,
          when: isIssueOpened,
          input: inboundFromGitHubIssue,
          sessionId: issueSessionId,
        }),
      },
    },
  },
});

export default inboxIntakeFlow();
