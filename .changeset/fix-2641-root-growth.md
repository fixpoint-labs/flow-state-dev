---
"@flow-state-dev/workforce": minor
"@flow-state-dev/workspace": minor
---

**Breaking:** eleven names leave the `@flow-state-dev/workforce` and `@flow-state-dev/workspace` roots, with no alias (FIX-2641). An old import fails to compile with "has no exported member".

- **workforce:** `taskBriefOf`, `taskBriefMetadata` and the `TaskBrief` type leave the root. They stay on `@flow-state-dev/workforce/browser`, beside `delegateAnswerOf`: a client reads a task's brief with `taskBriefOf(item)`, which answers `{ taskId }` for a message item that is a task's brief and `undefined` for any other. To migrate, import them from `@flow-state-dev/workforce/browser`.
- **workforce:** the subscription storage internals leave the root and are no longer exported: `SUBSCRIPTIONS_RESOURCE`, `SUBSCRIPTION_CURSORS_RESOURCE`, `SUBSCRIPTION_INDEX_RESOURCE`, `MAX_SCREEN_TERMS`, `screenVerdictsSchema`, and the `ListedScreen` and `SubscriptionCursor` types. A flow declares the subscription resources through `subscriptionResources`; the shapes stay public as `listedScreenSchema`, `subscriptionCursorSchema` and `screenVerdictSchema`, and a `subscribe` input's screens are typed by `SubscribeInput["screens"]`. Nothing persisted changes.
- **workspace:** `LAND_TIMEOUT_MS` leaves the root and is no longer exported. A landing still defaults to two minutes when `LandRequest.timeoutMs` is unset.

Docs: packages/workforce/README.md ("Reading a task's lines in a client": a task's brief is read with `taskBriefOf(item)` from `@flow-state-dev/workforce/browser`, which answers `{ taskId }`, next to `delegateAnswerOf`). The other ten names never had a README entry, so no other README changes.
