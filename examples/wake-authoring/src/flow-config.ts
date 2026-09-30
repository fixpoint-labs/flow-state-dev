/**
 * Variant 1 — today's flow-config surface.
 *
 * A flow author writes `schedules.static` and `webhooks[provider].on[event]`
 * with `defineScheduleBinding` / `defineWebhookBinding`. Fire conditions and
 * handler outcomes sit next to the bindings.
 *
 * Host requirements (see `host.ts`):
 *   - `createScheduledTransportAdapter()` plus a clock that POSTs dispatch
 *   - `createWebhookTransportAdapter({ providers: { github: … } })`
 *
 * Not shown here: delivering into an existing session from a BullMQ
 * `dispatcher({ session: { id } })`. That fence is FIX-1634, not this example.
 */
import {
  defineFlow,
  defineScheduleBinding,
  defineWebhookBinding,
  type ScheduleInputContext,
} from "@flow-state-dev/core";
import {
  inspectWakes,
  recordInboundIssue,
  sweepOpenTickets,
} from "./handlers";
import {
  inboundFromGitHubIssue,
  isIssueOpened,
  issueSessionId,
  type GitHubIssuesEvent,
} from "./github-issues";
import {
  GITHUB_ISSUES_EVENT,
  GITHUB_PROVIDER,
  SWEEP_CRON,
  SWEEP_SCHEDULE_ID,
  SWEEP_TIMEZONE,
} from "./scenario";

const inspect = inspectWakes("flow-config");

export const inboxWatchFlowConfig = defineFlow({
  kind: "inbox-watch-flow",
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    // Same blocks as the inbound bindings, so `fsdev run` can fire them by name.
    inspect: { block: inspect },
    sweep: { block: sweepOpenTickets },
    record: { block: recordInboundIssue },
  },
  schedules: {
    static: {
      // FIRES when the host POSTs
      //   POST /api/flows/inbox-watch-flow/schedules/sweep-open/dispatch
      // The cron string is validated at registration. The framework does not
      // tick. `onOverlap: "skip"` drops a tick if the previous sweep is still
      // in flight. Each tick is a new session (`sessionId` is always undefined
      // on the scheduled transport).
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
  webhooks: {
    [GITHUB_PROVIDER]: {
      on: {
        // FIRES after the host verifies the signature and extracts
        // `X-GitHub-Event === "issues"`. `when` then requires action=opened.
        // RUNS recordInboundIssue. sessionId keeps one conversation per issue.
        [GITHUB_ISSUES_EVENT]: defineWebhookBinding<GitHubIssuesEvent>({
          block: recordInboundIssue,
          when: isIssueOpened,
          input: inboundFromGitHubIssue,
          sessionId: issueSessionId,
        }),
      },
    },
  },
});

export default inboxWatchFlowConfig();
