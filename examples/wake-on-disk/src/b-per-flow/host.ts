/**
 * Host mount for layout B — secrets stay here; each flow owns its routes.
 *
 * The clock must know *which* flows have schedules:
 *
 *   POST /api/flows/inbox-sweep/schedules/sweep-open/dispatch
 *
 * GitHub must hit *this* flow's webhook URL (a second flow that also
 * wants issues needs a second URL, or GitHub fans out):
 *
 *   POST /api/flows/inbox-intake/webhooks/github
 *
 * Not a running server. `fsdev.config.ts` skips these adapters.
 */
import {
  createFlowState,
  createWebhookTransportAdapter,
  githubWebhookVerifier,
  inMemoryStores,
} from "@flow-state-dev/engine";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import inboxIntakeFlow from "./flows/intake/flow";
import inboxSweepFlow from "./flows/sweep/flow";
import inboxTriageFlow from "./flows/triage/flow";

export function createPerFlowNightWatchHost() {
  return createFlowState({
    flows: {
      [inboxSweepFlow.kind]: inboxSweepFlow,
      [inboxIntakeFlow.kind]: inboxIntakeFlow,
      [inboxTriageFlow.kind]: inboxTriageFlow,
    },
    stores: { default: { primary: inMemoryStores() } },
    adapters: [
      createScheduledTransportAdapter(),
      createWebhookTransportAdapter({
        providers: {
          github: {
            verify: githubWebhookVerifier(
              () => process.env.GITHUB_WEBHOOK_SECRET ?? "dev-only-not-for-prod",
            ),
            eventType: (_payload, headers) => headers.get("x-github-event"),
            deliveryId: (_payload, headers) =>
              headers.get("x-github-delivery") ?? undefined,
          },
        },
      }),
    ],
  });
}
