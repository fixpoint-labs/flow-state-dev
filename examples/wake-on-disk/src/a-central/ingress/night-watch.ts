/**
 * A — central locus.
 *
 * One file declares the night-watch clock and the GitHub hook. Those
 * bindings decide which seats get called. Seat folders under
 * `../workers/` do not declare schedules or webhooks.
 *
 * Host POSTs (see `../host.ts`):
 *   POST /api/flows/night-watch/schedules/sweep-open/dispatch
 *   POST /api/flows/night-watch/webhooks/github
 */
import {
  defineFlow,
  defineScheduleBinding,
  defineWebhookBinding,
  dispatcher,
  type ScheduleInputContext,
} from "@flow-state-dev/core";
import {
  inboundFromGitHubIssue,
  isIssueOpened,
  issueSessionId,
  type GitHubIssuesEvent,
} from "../../shared/github-issues";
import { inboundInputSchema, sweepInputSchema } from "../../shared/handlers";
import { inspectLayout } from "../../shared/inspect";
import {
  CENTRAL_INGRESS_KIND,
  CENTRAL_INTAKE_KIND,
  CENTRAL_SWEEP_KIND,
  GITHUB_ISSUES_EVENT,
  GITHUB_PROVIDER,
  SWEEP_CRON,
  SWEEP_SCHEDULE_ID,
  SWEEP_TIMEZONE,
} from "../../shared/scenario";

const inspect = inspectLayout("central", [
  {
    path: "a-central/ingress/night-watch.ts",
    fires: "Host cron every 15 min, and a verified GitHub issues/opened delivery.",
    runs: "dispatcher → night-sweep / night-intake. This file owns both bindings.",
    sessionOwner: "Ingress: new session per cron tick; webhook sessionId is repo#number.",
  },
  {
    path: "a-central/workers/sweep/WORKER.md + kind.ts",
    fires: "Only when night-watch hops here. No own cron.",
    runs: "sweep-open-tickets",
    sessionOwner: "Hop session key night-watch-sweep on night-sweep.",
  },
  {
    path: "a-central/workers/intake/WORKER.md + kind.ts",
    fires: "Only when night-watch hops here. No own webhook.",
    runs: "record-inbound-issue, then dispatcher → night-triage",
    sessionOwner: "Hop session key repo#number on night-intake, then again on night-triage.",
  },
  {
    path: "a-central/leftover/CHANNEL.md",
    fires: "A post on the Workforce channel (Layer 2). Not an L1 binding.",
    runs: "onChannelPost / wakeMemberSeats — leftover, not compiled.",
    sessionOwner: "Channel session id. Not this ingress.",
  },
]);

/** Cron tick → sweep seat. `{ key }` not `{ id }` — BullMQ `{ id }` is FIX-1634. */
const fanToSweep = dispatcher({
  name: "fan-to-sweep",
  type: "internal",
  flowKind: CENTRAL_SWEEP_KIND,
  action: "sweep",
  inputSchema: sweepInputSchema,
  session: { key: () => "night-watch-sweep" },
});

/** GitHub opened → intake seat. Same dispatcher door, other flowKind. */
const fanToIntake = dispatcher({
  name: "fan-to-intake",
  type: "internal",
  flowKind: CENTRAL_INTAKE_KIND,
  action: "record",
  inputSchema: inboundInputSchema,
  session: { key: (input) => `${input.repo}#${input.issueNumber}` },
});

export const nightWatchIngress = defineFlow({
  kind: CENTRAL_INGRESS_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    inspect: { block: inspect },
    sweep: { block: fanToSweep },
    record: { block: fanToIntake },
  },
  schedules: {
    static: {
      [SWEEP_SCHEDULE_ID]: defineScheduleBinding({
        cron: SWEEP_CRON,
        timezone: SWEEP_TIMEZONE,
        onOverlap: "skip",
        description: "Sweep open tickets every 15 minutes",
        block: fanToSweep,
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
        [GITHUB_ISSUES_EVENT]: defineWebhookBinding<GitHubIssuesEvent>({
          block: fanToIntake,
          when: isIssueOpened,
          input: inboundFromGitHubIssue,
          sessionId: issueSessionId,
        }),
      },
    },
  },
});

export default nightWatchIngress();
