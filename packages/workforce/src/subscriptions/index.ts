// FIX-2534, epic FIX-2471.
/**
 * Subscriptions: a session follows a thread, and
 * each event on it reaches that session once, from the service, after code
 * screens, as a message. A subscription is an event routine's trigger: the
 * routine verbs (the routines capability, the roster flow) write it through `subscribe`
 * and `unsubscribe`. A provider's `defineSubscriptionServiceFlow` routes and
 * delivers; an ingestion calls the engine's `routeServiceEvent` with the entry
 * `routeSubscriptionEvent`. GitHub is the first provider: `githubServiceFlow`,
 * `githubSubscriptionProvider`, and `followPullRequest` for a coding session
 * that opened a pull request.
 */
export {
  SUBSCRIPTION_CURSORS_PATTERN,
  SUBSCRIPTION_CURSORS_RESOURCE,
  SUBSCRIPTION_INDEX_PATTERN,
  SUBSCRIPTION_INDEX_RESOURCE,
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
export {
  refusedOnContent,
  screenRefusal,
  screenVerdictSchema,
  screenVerdictsSchema,
  type CustomScreen,
  type ScreenVerdict,
  type SubscriptionScreens
} from "./screens";
export {
  endTaskSubscriptions,
  subscribe,
  subscribeInputSchema,
  unsubscribe,
  type SubscribeInput,
  type SubscribeOutcome,
  type SubscribeTarget,
  type SubscribeWrite,
  type SubscriptionEnd,
  type SubscriptionPollCursor,
  type SubscriptionPollResult,
  type SubscriptionProvider
} from "./subscribe";
export type { SubscriptionPolling } from "./poll";
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
  unheard,
  type Routed,
  type SubscriptionServiceOptions
} from "./service-flow";
