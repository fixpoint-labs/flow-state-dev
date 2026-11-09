// FIX-2534, epic FIX-2471.
/**
 * Subscriptions: a session follows a thread, and
 * each event on it reaches that session once, from the service, after code
 * screens, as a message. A subscription is an event routine's trigger: the
 * routine verbs (`routineTools`, the roster flow) write it through `subscribe`
 * and `unsubscribe`. A provider's `defineSubscriptionServiceFlow` routes and
 * delivers; an ingestion calls the engine's `routeServiceEvent` with the entry
 * `routeSubscriptionEvent`.
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
export { screenRefusal, screenVerdictSchema, screenVerdictsSchema, type ScreenVerdict } from "./screens";
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
  type SubscriptionProvider
} from "./subscribe";
export {
  DEFAULT_SUBSCRIPTION_CAP_PER_HOUR,
  defineSubscriptionServiceFlow,
  deliveryMessageId,
  deliveryText,
  type Routed,
  type SubscriptionServiceOptions
} from "./service-flow";
