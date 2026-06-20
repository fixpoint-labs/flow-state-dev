---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
---

Flows can now declare inbound webhook receivers. Add `webhooks: { <provider>: { on: { ... } } }` to a flow and verified events from Stripe, GitHub, Slack, or any custom service route to its actions. The flow declares routing only — which event maps to which action, with per-event input mapping, optional session-id derivation, and a synchronous predicate; the imperative `route()` escape hatch and `defineWebhookBinding<T>()` for typed handlers are also available. Bindings are validated against the flow's own actions at registration.

`@flow-state-dev/server` adds `createWebhookTransportAdapter`, mounting `POST /api/flows/:kind/webhooks/:provider`. The host supplies signature verification and payload mechanics per provider at adapter mount, keeping secrets out of the flow definition; `stripeWebhookVerifier`, `githubWebhookVerifier`, `slackWebhookVerifier`, and `createWebhookVerifier` cover the common signature formats. Webhook-originated requests carry `source: "webhook"` with provider and event provenance.
