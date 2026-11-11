// FIX-2534, epic FIX-2471.
/**
 * Subscriptions: a session follows a thread, and
 * each event on it reaches that session once, from the service, after code
 * screens, as a message. A subscription is an event routine's trigger: the
 * routine verbs (the routines capability, the roster flow) write it through `subscribe`
 * and `unsubscribe`. A provider's service flow (`../service-flows`) routes
 * and delivers.
 */
export {
  SUBSCRIPTION_CURSORS_PATTERN,
  SUBSCRIPTION_INDEX_PATTERN,
  SUBSCRIPTIONS_PATTERN,
  serviceSender
} from "./keys";
export {
  SCREEN_KINDS,
  listedScreenSchema,
  subscriptionCursorSchema,
  subscriptionResources,
  subscriptionResourceStateSchema,
  type ScreenKind,
  type SubscriptionResourceState
} from "./rows";
export {
  refusedOnContent,
  screenRefusal,
  screenVerdictSchema,
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
