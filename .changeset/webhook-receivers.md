---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
"@flow-state-dev/chat-sdk": minor
"@flow-state-dev/mcp": patch
---

Flows can now declare inbound webhook receivers. Add `webhooks: { <provider>: { on: { ... } } }` to a flow and verified events from Stripe, GitHub, Slack, or any custom service route to its actions. The flow declares routing only — which event maps to which action, with per-event input mapping, optional session-id derivation, and a synchronous predicate; the imperative `route()` escape hatch and `defineWebhookBinding<T>()` for typed handlers are also available. Bindings are validated against the flow's own actions at registration.

`@flow-state-dev/server` adds `createWebhookTransportAdapter`, mounting `POST /api/flows/:kind/webhooks/:provider`. The host supplies signature verification and payload mechanics per provider at adapter mount, keeping secrets out of the flow definition; `stripeWebhookVerifier`, `githubWebhookVerifier`, `slackWebhookVerifier`, and `createWebhookVerifier` cover the common signature formats. Webhook-originated requests carry `source: "webhook"` with provider and event provenance.

A webhook or chat binding can now carry an inline `block` instead of an `action`, for handlers that exist only to service that transport. `defineFlow` lowers each inline block into an internal action that runs through the full dispatch runtime (lifecycle, state, items, request records, DevTool) but is never exposed on the public HTTP action endpoint or as an MCP tool — so a webhook-only handler can't be invoked in a way that bypasses signature verification. A binding declares exactly one of `action` or `block`. This works symmetrically for the chat transport (`chat.on[*].block`, including via `defineChatBinding`).
