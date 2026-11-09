// FIX-2535 D1; epic FIX-2471.
/**
 * GitHub's service flow: the subscription service flow built for GitHub, with the
 * webhook service route declared (`webhooks: { github: { service } }`). A
 * signed GitHub delivery to `/<base>/<kind>/webhooks/github` is verified by
 * the host's transport, normalized here ({@link normalizeGitHubEvent}), and
 * routed to the sessions that follow one of its threads, each once, from
 * `service:github`. No `sessionId` is on the path: an event reaches the session
 * that asked for it, never one made from the event.
 *
 * The host mounts the webhook transport with GitHub's mechanics:
 *
 * ```ts
 * createWebhookTransportAdapter({ providers: { github: {
 *   verify: githubWebhookVerifier(secret),
 *   eventType: (_payload, headers) => headers.get("x-github-event"),
 *   deliveryId: (_payload, headers) => headers.get("x-github-delivery") ?? undefined,
 * } } })
 * ```
 */
import type { WorkerInstallation } from "../../workers/installation";
import { defineSubscriptionServiceFlow, type SubscriptionServicePollOptions } from "../service-flow";
import { GITHUB_PROVIDER, normalizeGitHubEvent } from "./normalize";
import type { GitHubSubscriptionProvider } from "./provider";

/** The flow kind GitHub's service flow takes unless told otherwise. */
export const GITHUB_SERVICE_FLOW = "github-service";

/** What {@link githubServiceFlow} is built with. */
export interface GitHubServiceFlowOptions {
  /** GitHub's provider (`githubSubscriptionProvider`): the same one the coding sessions subscribe on. */
  readonly provider: GitHubSubscriptionProvider;
  /** The app's worker installation: the sessions it delivers to run its workers. */
  readonly installation: WorkerInstallation;
  /** The flow kind, and so the webhook URL's flow segment. Default {@link GITHUB_SERVICE_FLOW}. */
  readonly kind?: string;
  /** Bot ids the sender screen lets through, without `[bot]` (`github-actions`, `codex`). */
  readonly trustedBots?: readonly string[];
  /**
   * The app's agent handles: an event that mentions one (outside quotes and
   * code), assigns one, or requests its review is `addressed`. Default the
   * provider's App bot login, when it has one; else none.
   */
  readonly agentHandles?: readonly string[];
  /** The most messages one subscription sends in an hour. */
  readonly capPerHour?: number;
  /** The most subscriptions one event is delivered to. */
  readonly maxOwnerRuns?: number;
  /** Poll GitHub for subscriptions with no webhook: see `defineSubscriptionServiceFlow`'s `poll`. */
  readonly poll?: SubscriptionServicePollOptions;
}

/** Build GitHub's service flow, with its webhook service route. */
export function githubServiceFlow(options: GitHubServiceFlowOptions) {
  if (options.provider.provider !== GITHUB_PROVIDER) {
    throw new Error(`githubServiceFlow: the provider's key is "${options.provider.provider}", not "${GITHUB_PROVIDER}".`);
  }
  const agentHandles = options.agentHandles ?? (options.provider.agentHandle === undefined ? [] : [options.provider.agentHandle]);
  return defineSubscriptionServiceFlow({
    kind: options.kind ?? GITHUB_SERVICE_FLOW,
    provider: options.provider,
    installation: options.installation,
    ...(options.trustedBots === undefined ? {} : { trustedBots: options.trustedBots }),
    ...(options.capPerHour === undefined ? {} : { capPerHour: options.capPerHour }),
    ...(options.maxOwnerRuns === undefined ? {} : { maxOwnerRuns: options.maxOwnerRuns }),
    ...(options.poll === undefined ? {} : { poll: options.poll }),
    normalize: (event, at) =>
      normalizeGitHubEvent(
        {
          eventType: event.eventType ?? "",
          payload: event.payload,
          received: at.received,
          ...(event.deliveryId === undefined ? {} : { deliveryId: event.deliveryId })
        },
        { agentHandles }
      )
  });
}
