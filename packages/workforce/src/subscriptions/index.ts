// FIX-2534, epic FIX-2471.
/**
 * Subscriptions: a session follows a thread, and
 * each event on it reaches that session once, from the service, after code
 * screens, as a message. `subscriptionTools` are the two tools; a provider's
 * `defineSubscriptionServiceFlow` routes and delivers; an ingestion calls the
 * engine's `routeServiceEvent` with the entry `routeSubscriptionEvent`. GitHub is
 * the first provider: `githubServiceFlow`, `githubSubscriptionProvider`, and
 * `followPullRequest` for a coding session that opened a pull request.
 */
export {
  SUBSCRIPTION_CURSORS_PATTERN,
  SUBSCRIPTION_CURSORS_RESOURCE,
  SUBSCRIPTION_INDEX_PATTERN,
  SUBSCRIPTION_INDEX_RESOURCE,
  SUBSCRIPTION_TOOLS,
  SUBSCRIPTIONS_PATTERN,
  SUBSCRIPTIONS_RESOURCE,
  serviceSender
} from "./keys";
export {
  MAX_SCREEN_TERMS,
  SCREEN_KINDS,
  listedScreenSchema,
  subscriptionCursorSchema,
  subscriptionResources,
  subscriptionResourceStateSchema,
  type ListedScreen,
  type ScreenKind,
  type SubscriptionCursor,
  type SubscriptionResourceState
} from "./rows";
export { screenRefusal, screenVerdictSchema, screenVerdictsSchema, type ScreenVerdict } from "./screens";
export {
  endTaskSubscriptions,
  subscribe,
  subscribeInputSchema,
  subscriptionTools,
  unsubscribe,
  type SubscribeInput,
  type SubscribeOutcome,
  type SubscriptionEnd,
  type SubscriptionPollCursor,
  type SubscriptionPollResult,
  type SubscriptionProvider
} from "./subscribe";
export type { SubscriptionPolling, SubscriptionPollingOptions } from "./poll";
export { normalizeGitHubEvent, type GitHubEventInput, type GitHubNormalizeOptions } from "./github/normalize";
export {
  githubSubscriptionProvider,
  type GitHubSubscriptionProvider,
  type GitHubSubscriptionProviderOptions
} from "./github/provider";
export { githubServiceFlow, type GitHubServiceFlowOptions } from "./github/service-flow";
export { followPullRequest, type FollowPullRequestOptions } from "./github/follow-pull-request";
export {
  DEFAULT_SUBSCRIPTION_CAP_PER_HOUR,
  defineSubscriptionServiceFlow,
  deliveryMessageId,
  deliveryText,
  type Routed,
  type SubscriptionServiceOptions,
  type SubscriptionServicePollOptions
} from "./service-flow";
