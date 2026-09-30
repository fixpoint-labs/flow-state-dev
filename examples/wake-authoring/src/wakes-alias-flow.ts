/**
 * Variant 3 — the same inbox-watch flow, authored with `expandWakes`.
 *
 * Compare this file to `flow-config.ts`. The bindings are identical; only the
 * grouping word changed. Assign the result onto `defineFlow` — there is no
 * `wakes` field on `FlowDefinition`.
 */
import { defineFlow, type ScheduleInputContext } from "@flow-state-dev/core";
import { expandWakes } from "./expand-wakes";
import {
  inspectWakes,
  recordInboundIssue,
  sweepOpenTickets,
} from "./handlers";
import {
  inboundFromGitHubIssue,
  isIssueOpened,
  issueSessionId,
} from "./github-issues";
import {
  GITHUB_ISSUES_EVENT,
  GITHUB_PROVIDER,
  SWEEP_CRON,
  SWEEP_SCHEDULE_ID,
  SWEEP_TIMEZONE,
} from "./scenario";

const inspect = inspectWakes("wakes-alias");

const inbound = expandWakes([
  {
    type: "cron",
    id: SWEEP_SCHEDULE_ID,
    cron: SWEEP_CRON,
    timezone: SWEEP_TIMEZONE,
    onOverlap: "skip",
    description: "Sweep open tickets every 15 minutes",
    block: sweepOpenTickets,
    input: (ctx: ScheduleInputContext) => ({
      reason: "interval",
      nominalFireTime: ctx.nominalFireTime,
    }),
  },
  {
    type: "webhook",
    provider: GITHUB_PROVIDER,
    event: GITHUB_ISSUES_EVENT,
    block: recordInboundIssue,
    when: isIssueOpened,
    input: inboundFromGitHubIssue,
    sessionId: issueSessionId,
  },
]);

export const inboxWatchWakesAlias = defineFlow({
  kind: "inbox-watch-alias",
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    inspect: { block: inspect },
    sweep: { block: sweepOpenTickets },
    record: { block: recordInboundIssue },
  },
  schedules: inbound.schedules,
  webhooks: inbound.webhooks,
});

export default inboxWatchWakesAlias();
