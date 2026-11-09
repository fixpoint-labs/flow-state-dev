---
"@flow-state-dev/workforce": minor
---

A coordinator can hear what nobody else heard on a PR, issue or repository it follows, and its `inferredWork:` decides what its turn may do with work nobody asked for (FIX-2538).

- **Subscribing unmatched:** `subscribe` takes `unmatched: true`, in a coordinator's conversation only (`not_a_coordinator` elsewhere). Such a subscription hears an event only when no other subscription heard it, and only the event types the app forwards. `defineCoordinatorFlow({ subscriptions: { providers } })` gives the coordinator flow the `subscribe` and `unsubscribe` actions.
- **Forwarding:** `defineSubscriptionServiceFlow` and `githubServiceFlow` take `forwards`, the event types the app forwards. Without it nothing is forwarded. An event a screen couldn't judge (`interest: unjudged`, or `<screen>: failed`) is never forwarded. The routing entry's output gains `unmatched: { forwarded, dropped? }`, which counts each unheard event and says why none heard it.
- **The mark:** the delivery marks each forward `addressed` (the event's `addressed`) or `inferred`, on the message row's new optional `forward` field. A model never writes it.
- **`inferredWork:`** on a coordinator's `WORKER.md`: `observe` (the default) runs the turn, and every task it files on an inferred forward waits on the user's yes, a confirm in the Inbox. A step for itself, or a message to another worker, is refused on that turn. `auto` runs the turn as any other. `off` lands an inferred forward as a line and runs no model. An addressed event runs in every mode.

Docs: packages/workforce/README.md (unmatched subscriptions, `forwards`, `inferredWork`), apps/docs/docs/workforce/messaging-workers.md (a forward as a message from the service), the coordinator guide (`inferredWork:` and the confirm)
