---
"@flow-state-dev/workforce": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

A worker's conversation can follow a thread on an outside service, and hears each event on it once, as a message from `service:<provider>` (FIX-2534).

- **workforce:** `subscriptionTools({ providers })` gives the `subscribe` and `unsubscribe` tools; `defineSubscriptionServiceFlow({ kind, provider, installation, trustedBots?, capPerHour? })` builds a provider's service flow, which routes each event through five code screens (`sender`, `own`, `labels`, `words`, `allow`) and delivers once per conversation. A subscription ends on `unsubscribe`, when its thread closes, or when the task whose session made it fails or is cancelled. `sendMessage` takes `service: { sender, to }` for a service's delivery. See the README's Subscriptions section.
- **engine:** `fireOwnerRunThrough(host, run)` starts an internal entry as the user whose cell holds a row, only when the row is there, names the same org and isn't `enabled: false`; `routeServiceEvent(host, …)` runs a service flow's entry and fires each owner run it names.
- **core:** `subscriptionEventSchema` / `SubscriptionEvent`, the normalized event a webhook or a poll maps into.
