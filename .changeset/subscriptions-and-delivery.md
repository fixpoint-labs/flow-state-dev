---
"@flow-state-dev/workforce": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

A worker's conversation can follow a thread on an outside service, and hears each event on it once, as a message from `service:<provider>` (FIX-2534).

- **workforce:** `subscriptionTools({ providers })` gives the `subscribe` and `unsubscribe` tools; `defineSubscriptionServiceFlow({ kind, provider, installation, trustedBots?, capPerHour? })` builds a provider's service flow, which routes each event through five code screens (`sender`, `own`, `labels`, `words`, `allow`) and delivers once per conversation, under the subscribing session's tenant. A subscription ends on `unsubscribe`, when the thread it follows closes (a PR's closing leaves a subscription to its repository running), or when the task whose session made it fails or is cancelled. See the README's Subscriptions section.
- **engine:** `fireOwnerRunThrough(host, run)` starts an internal entry as the user whose stored row it names, only when the row is there, names the same org and tenant, and isn't `enabled: false`; `routeServiceEvent(host, …, { concurrency? })` runs a service flow's entry, reads the owner runs it names, and fires them a few at once, recording each one's failure. `resolveSharedUserCellKey(userId, orgId, flowKind)` is the storage key both read a user's shared rows at.
- **core:** `subscriptionEventSchema` / `SubscriptionEvent`, the normalized event a webhook or a poll maps into.
