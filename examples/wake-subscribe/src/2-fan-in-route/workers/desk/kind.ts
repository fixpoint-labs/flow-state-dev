/**
 * Style 2 desk — compiled `webhooks.on` live here.
 *
 * The authoring file is `WORKER.md` (`route:`). This kind is the compile
 * target, not a second spelling of the rules.
 *
 *   POST /api/flows/github-desk/webhooks/github
 *
 * `{ key }` not `{ id }` — BullMQ `{ id }` is FIX-1634.
 */
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { inboundInputSchema } from "../../../shared/handlers";
import { inspectLayout } from "../../../shared/inspect";
import {
  FANIN_DESK_KIND,
  FANIN_INTAKE_KIND,
  FANIN_REVIEWER_KIND,
} from "../../../shared/scenario";
import { compileRouteRules, readDeskWorkerMarkdown } from "./route-rules";

const inspect = inspectLayout("fan-in-route", [
  {
    path: "2-fan-in-route/host.ts",
    fires: "One GitHub URL. Provider registered once, same as style 1.",
    runs: "registerGitHubTransport → createWebhookTransportAdapter",
    sessionOwner: "Not the host. Desk bindings derive sessionId from the payload.",
  },
  {
    path: "2-fan-in-route/workers/desk/WORKER.md",
    fires: "Verified GitHub issues/opened or pull_request/review_requested.",
    runs: "route rules compile to dispatcher hops",
    sessionOwner: "Rule `session:` — issue → repo#n, pull_request → repo#prN.",
  },
  {
    path: "2-fan-in-route/workers/intake/kind.ts",
    fires: "Only when the desk hops here. No own webhook.",
    runs: "record-inbound, then dispatcher → github-triage",
    sessionOwner: "Hop session key repo#n on github-intake.",
  },
  {
    path: "2-fan-in-route/workers/reviewer/kind.ts",
    fires: "Only when the desk hops here. No own webhook.",
    runs: "record-inbound",
    sessionOwner: "Hop session key repo#prN on github-reviewer.",
  },
  {
    path: "2-fan-in-route/leftover/CHANNEL.md",
    fires: "A post on the Workforce channel (Layer 2). Not an L1 binding.",
    runs: "onChannelPost / wakeMemberSeats — leftover, not compiled.",
    sessionOwner: "Channel session id. Not a route rule.",
  },
]);

/** Desk → intake. Same dispatcher door #2370 A uses. */
export const hopToIntake = dispatcher({
  name: "hop-to-intake",
  type: "internal",
  flowKind: FANIN_INTAKE_KIND,
  action: "record",
  inputSchema: inboundInputSchema,
  session: { key: (input) => `${input.repo}#${input.number}` },
});

/** Desk → reviewer. */
export const hopToReviewer = dispatcher({
  name: "hop-to-reviewer",
  type: "internal",
  flowKind: FANIN_REVIEWER_KIND,
  action: "record",
  inputSchema: inboundInputSchema,
  session: { key: (input) => `${input.repo}#pr${input.number}` },
});

export const DESK_HOPS = {
  [FANIN_INTAKE_KIND]: hopToIntake,
  [FANIN_REVIEWER_KIND]: hopToReviewer,
};

export const compiledDeskRoutes = compileRouteRules(readDeskWorkerMarkdown(), DESK_HOPS);

export const githubDeskKind = defineFlow({
  kind: FANIN_DESK_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    inspect: { block: inspect },
    recordIssue: { block: hopToIntake },
    recordPr: { block: hopToReviewer },
  },
  webhooks: compiledDeskRoutes.webhooks,
});

export default githubDeskKind();
