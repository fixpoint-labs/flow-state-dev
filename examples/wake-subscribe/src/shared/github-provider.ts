/**
 * Host registration of the GitHub webhook provider — today's real API.
 *
 * Secrets and wire-protocol facts live here. Routing does not.
 * `createWebhookTransportAdapter({ providers: { github } })` already
 * registers the provider once and reuses it for every flow that
 * declares `webhooks.github`.
 *
 * `registerGitHubTransport` is a naming sketch over that mount. It
 * does not add a second adapter.
 */
import {
  createWebhookTransportAdapter,
  githubWebhookVerifier,
} from "@flow-state-dev/engine";
import { GITHUB_PROVIDER } from "./scenario";

export function githubProviderDefinition() {
  return {
    verify: githubWebhookVerifier(
      () => process.env.GITHUB_WEBHOOK_SECRET ?? "dev-only-not-for-prod",
    ),
    eventType: (_payload: unknown, headers: Headers) => headers.get("x-github-event"),
    deliveryId: (_payload: unknown, headers: Headers) =>
      headers.get("x-github-delivery") ?? undefined,
  };
}

/**
 * SKETCH name. Compiles 1:1 to `createWebhookTransportAdapter`.
 * Not a new inbound transport.
 */
export function registerGitHubTransport() {
  return createWebhookTransportAdapter({
    providers: {
      [GITHUB_PROVIDER]: githubProviderDefinition(),
    },
  });
}
