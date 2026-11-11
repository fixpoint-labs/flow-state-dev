// FIX-2534, FIX-2535, epic FIX-2471.
/**
 * Service flows: a provider's flow that routes each of its events to the
 * subscriptions that follow the event's threads, and delivers it to each as
 * the service. `defineSubscriptionServiceFlow` builds one; an ingestion calls
 * the engine's `routeServiceEvent` with the entry `routeSubscriptionEvent`.
 * GitHub is the first provider: `githubServiceFlow`,
 * `githubSubscriptionProvider`, and `followPullRequest` for a coding session
 * that opened a pull request. Internal events (`internalServiceFlow`) are the
 * third way in: a session publishes on a declared topic with `publishEvent`.
 * Subscriptions themselves live in `../subscriptions`.
 */
export { normalizeGitHubEvent, type GitHubEventInput, type GitHubNormalizeOptions } from "./github/normalize";
export {
  githubSubscriptionProvider,
  type GitHubSubscriptionProvider,
  type GitHubSubscriptionProviderOptions
} from "./github/provider";
export { githubServiceFlow, type GitHubServiceFlowOptions } from "./github/service-flow";
export { followPullRequest, type FollowPullRequestOptions } from "./github/follow-pull-request";
export {
  internalServiceFlow,
  type InternalServiceFlow,
  type InternalServiceFlowOptions
} from "./internal-events/service-flow";
export { type PublishOutcome } from "./internal-events/publish";
export { type InternalTopic, type InternalTopics } from "./internal-events/topics";
export {
  DEFAULT_SUBSCRIPTION_CAP_PER_HOUR,
  defineSubscriptionServiceFlow,
  deliveryMessageId,
  deliveryText,
  unheard,
  type Routed,
  type SubscriptionServiceOptions
} from "./service-flow";
