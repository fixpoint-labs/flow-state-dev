/**
 * Host mount for layout A — secrets and the clock stay here.
 *
 * One schedule POST. One webhook URL. The ingress file decides who runs.
 *
 *   POST /api/flows/night-watch/schedules/sweep-open/dispatch
 *   POST /api/flows/night-watch/webhooks/github
 *
 * Not a running server. `fsdev.config.ts` skips these adapters so inspect /
 * sweep / record run locally with no secrets.
 */
import {
  createFlowState,
  createWebhookTransportAdapter,
  githubWebhookVerifier,
  inMemoryStores,
} from "@flow-state-dev/engine";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import nightWatchIngress from "./ingress/night-watch";
import nightIntakeKind from "./workers/intake/kind";
import nightSweepKind from "./workers/sweep/kind";
import nightTriageKind from "./workers/triage/kind";

export function createCentralNightWatchHost() {
  return createFlowState({
    flows: {
      [nightWatchIngress.kind]: nightWatchIngress,
      [nightSweepKind.kind]: nightSweepKind,
      [nightIntakeKind.kind]: nightIntakeKind,
      [nightTriageKind.kind]: nightTriageKind,
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
