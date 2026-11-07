---
"@flow-state-dev/workforce": minor
---

**Breaking:** `SUBSCRIPTION_ROUTE_ENTRY` and `SUBSCRIPTION_DELIVER_ENTRY` leave the `@flow-state-dev/workforce` root with no alias, the same as the other `*_ENTRY` constants (FIX-2463). An ingestion that feeds events through the engine's `routeServiceEvent` names the routing entry by its documented string: `entry: "routeSubscriptionEvent"`. The delivery entry is `"deliverSubscriptionEvent"`. The strings themselves are unchanged, so nothing persisted or in flight reads differently. An old import fails to compile with "has no exported member".

Docs: FIX-2463 — packages/workforce/README.md (the subscriptions section and the API table row name the entries as strings, `routeSubscriptionEvent` and `deliverSubscriptionEvent`, not `SUBSCRIPTION_ROUTE_ENTRY` / `SUBSCRIPTION_DELIVER_ENTRY`), packages/engine/README.md (`routeServiceEvent`: workforce's subscriptions route through the `routeSubscriptionEvent` entry, not `SUBSCRIPTION_ROUTE_ENTRY`)
