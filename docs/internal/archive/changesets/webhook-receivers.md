---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Flows can now declare inbound webhook receivers. Add `webhooks: { <provider>: { on: { <eventType>: binding } } }` to a flow and verified events from Stripe, GitHub, Slack, or any custom service run the handler you bind to them, with per-event input mapping, optional session-id derivation, and a synchronous `when` predicate. Use `defineWebhookBinding<T>()` for a typed event payload. The flow declares routing only — no secrets.

A webhook binding *is an action in webhook form*: it carries the handler `block` and its execution policy (`durable`, `tokenBudget`, `onCompleted`/`onErrored`) inline — the same shared `ActionCore` an HTTP action carries — but it is addressed by the provider's event type rather than by a caller-supplied name. This generalizes the concept of an action: the new `ActionCore` type is the shared core every form builds on. A webhook handler lives on `flow.webhooks`, never `flow.actions`, so it is structurally event-addressed and transport-authenticated: it has no HTTP action endpoint, never appears in the flow listing, and is never exposed as an MCP tool. Webhook-originated requests are likewise not re-runnable from the public retry/continue routes (which carry no signature check).

`@flow-state-dev/engine` adds `createWebhookTransportAdapter`, mounting `POST /api/flows/:kind/webhooks/:provider`. The host supplies signature verification and payload mechanics per provider at adapter mount, keeping secrets out of the flow definition; `stripeWebhookVerifier`, `githubWebhookVerifier`, `slackWebhookVerifier`, and `createWebhookVerifier` cover the common signature formats. The runtime resolves a webhook handler from `flow.webhooks` via the `(provider, eventType)` coordinate stamped on `metadata.webhook`; webhook-originated requests carry `source: "webhook"` with provider and event provenance.
