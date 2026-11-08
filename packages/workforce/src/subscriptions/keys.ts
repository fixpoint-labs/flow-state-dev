// FIX-2534.
/**
 * Subscriptions' pinned names: where the rows live, the tools, and
 * the service flow's two entries. A leaf module.
 */

/** A session's subscriptions, one row each, at user scope. **Pinned**: persisted. */
export const SUBSCRIPTIONS_PATTERN = "workforce/subscriptions/*";

/** The accessor a flow declares the subscriptions under. */
export const SUBSCRIPTIONS_RESOURCE = "workforceSubscriptions";

/** One cursor per subscription, at user scope: the versions it has seen, and its cap's count. **Pinned**: persisted. */
export const SUBSCRIPTION_CURSORS_PATTERN = "workforce/subscription-cursors/*";

/** The accessor a flow declares the cursors under. */
export const SUBSCRIPTION_CURSORS_RESOURCE = "workforceSubscriptionCursors";

/**
 * The thread index, at org scope: one row per thread key, naming the
 * subscriptions that follow it. It nominates; it grants nothing. **Pinned**:
 * persisted. Server-only.
 */
export const SUBSCRIPTION_INDEX_PATTERN = "workforce/subscription-index/*";

/** The accessor a flow declares the thread index under. */
export const SUBSCRIPTION_INDEX_RESOURCE = "workforceSubscriptionIndex";

/** The two tools a session subscribes and unsubscribes with. */
export const SUBSCRIPTION_TOOLS = { subscribe: "subscribe", unsubscribe: "unsubscribe" } as const;

/** The service flow's routing entry: one normalized event in, run as the service. **Pinned**: an ingestion names it by this string; not on the root. */
export const SUBSCRIPTION_ROUTE_ENTRY = "routeSubscriptionEvent";

/** The service flow's delivery entry: one subscription and one event in, run as that subscription's user. **Pinned**: not on the root. */
export const SUBSCRIPTION_DELIVER_ENTRY = "deliverSubscriptionEvent";

/** The sender a delivery's message names: `service:<provider>` (epic D9). */
export const serviceSender = (provider: string) => `service:${provider}`;
