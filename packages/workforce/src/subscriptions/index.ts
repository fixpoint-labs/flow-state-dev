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
  type SubscriptionProvider
} from "./subscribe";
export {
  GITHUB_PROVIDER,
  githubLoginId,
  githubMentions,
  githubThreadKey,
  normalizeGitHubEvent,
  type GitHubEventInput,
  type GitHubNormalizeOptions
} from "./github/normalize";
export {
  githubRepositoryOf,
  githubSubscriptionProvider,
  type GitHubSubscriptionProvider,
  type GitHubSubscriptionProviderOptions
} from "./github/provider";
export { GITHUB_SERVICE_FLOW, githubServiceFlow, type GitHubServiceFlowOptions } from "./github/service-flow";
export {
  FOLLOWED_PULL_REQUEST_KINDS,
  followPullRequest,
  pullRequestThread,
  type FollowPullRequestOptions
} from "./github/follow-pull-request";
export {
  DEFAULT_MAX_OWNER_RUNS,
  DEFAULT_SUBSCRIPTION_CAP_PER_HOUR,
  defineSubscriptionServiceFlow,
  deliveryMessageId,
  deliveryText,
  type Routed,
  type SubscriptionServiceOptions
} from "./service-flow";
