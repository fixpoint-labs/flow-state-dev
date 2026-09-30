/**
 * Host mount sketch — secrets stay here, routing stays on the flow.
 *
 * Register any of the three variant instances. The adapters are the same
 * regardless of how the flow was authored. Cron is still a host clock;
 * GitHub still needs `eventType` from `X-GitHub-Event`.
 *
 * Not a running server. `fsdev.config.ts` registers the flows without these
 * adapters so `inspect` / `sweep` / `record` run locally with no secrets.
 */
import {
  createFlowState,
  createWebhookTransportAdapter,
  githubWebhookVerifier,
  inMemoryStores,
} from "@flow-state-dev/engine";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import inboxWatchFlowConfig from "./flow-config";
import inboxWatchWorkerMd from "./worker-md/flow";
import inboxWatchWakesAlias from "./wakes-alias-flow";

export function createInboxWatchHost() {
  return createFlowState({
    flows: {
      "inbox-watch-flow": inboxWatchFlowConfig,
      "inbox-watch-worker": inboxWatchWorkerMd,
      "inbox-watch-alias": inboxWatchWakesAlias,
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
