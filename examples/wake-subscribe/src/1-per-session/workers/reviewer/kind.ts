/**
 * Style 1 reviewer — no `webhooks.on`.
 *
 * Subscribe lives on `WORKER.md` and compiles to a fictional table
 * (`subscribe.ts`). This kind is ordinary actions plus one dispatcher hop.
 *
 * `{ key }` not `{ id }` — BullMQ `{ id }` is FIX-1634.
 */
import { defineFlow, dispatcher, sequencer } from "@flow-state-dev/core";
import { noteTriage, reviewInputSchema, startReview } from "../../../shared/handlers";
import { inspectLayout } from "../../../shared/inspect";
import { SESSION_REVIEWER_KIND, SESSION_TRIAGE_KIND } from "../../../shared/scenario";

const inspect = inspectLayout("per-session", [
  {
    path: "1-per-session/host.ts",
    fires: "GitHub provider registered once. No per-session route today.",
    runs: "registerGitHubTransport → createWebhookTransportAdapter",
    sessionOwner: "Not the host. A session would subscribe after it starts.",
  },
  {
    path: "1-per-session/workers/reviewer/WORKER.md",
    fires: "Only after this session subscribed (sketch). Auto on review-started.",
    runs: "start-review, then dispatcher → pr-triage",
    sessionOwner: "This session. Resource is the PR it opened.",
  },
  {
    path: "1-per-session/workers/reviewer/kind.ts",
    fires: "HTTP / fsdev `review`. No webhook binding.",
    runs: "start-review",
    sessionOwner: "Caller session. Not derived from a GitHub payload.",
  },
  {
    path: "1-per-session/leftover/CHANNEL.md",
    fires: "A post on the Workforce channel (Layer 2). Not an L1 binding.",
    runs: "onChannelPost / wakeMemberSeats — leftover, not compiled.",
    sessionOwner: "Channel session id. Not this subscribe table.",
  },
]);

const hopToTriage = dispatcher({
  name: "hop-to-triage",
  type: "internal",
  flowKind: SESSION_TRIAGE_KIND,
  action: "note",
  inputSchema: reviewInputSchema,
  session: { key: (input) => `${input.repo}#pr${input.number}` },
  payload: (input) => ({
    kind: "review-started",
    repo: input.repo,
    number: input.number,
    title: input.title,
  }),
});

const reviewThenHop = sequencer({
  name: "review-then-hop",
  inputSchema: reviewInputSchema,
})
  .step(startReview)
  .step(hopToTriage);

export const prReviewerKind = defineFlow({
  kind: SESSION_REVIEWER_KIND,
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    inspect: { block: inspect },
    review: { block: reviewThenHop },
  },
  internal: {
    actions: {
      review: { block: reviewThenHop },
    },
  },
});

export default prReviewerKind();
