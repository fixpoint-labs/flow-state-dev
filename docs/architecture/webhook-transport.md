# Webhook Transport Adapter

Turns a signed provider POST (Stripe, GitHub, Slack, …) into a flow action, as an `InboundTransportAdapter` with `source: "webhook"`. A binding is an action in webhook form: `WebhookEventBinding extends ActionCore` on `flow.webhooks[provider].on[event]`, never in `flow.actions` ([Action Forms](./action-forms.md)). Configuration and the provider verifiers are user-facing: [Webhook receivers](../../apps/docs/docs/server/webhooks.md).

## Division of labour

- **The flow owns routing**: which event runs which handler and how the event maps to input and session. Version-controlled, browser-safe, **no secrets**.
- **The host owns provider mechanics**, supplied once at mount as `WebhookProviderDefinition` keyed by the same provider name: `verify` (needs a secret and Node `crypto`), `eventType` (its *location* is a wire fact: Stripe body `.type`, GitHub header, Slack nested), `parse`, `deliveryId`, `acknowledge` (handshake).
- Hence the packaging: declarations in `core` (`types/webhooks.ts`, browser-safe), runtime and verifiers in `engine` (`transports/webhook/`, `transports/auth/`). No separate package, since there's no external dependency to isolate and `crypto` can't be in `core`.
- At `start()`, `assertProvidersCoverSubscriptions` fails startup if a flow declares a provider the mount lacks, rather than 404-ing a live, retrying provider.
- `validateWebhookConfig` runs in `defineFlow` before resource aggregation walks the handler blocks. Event keys are **not** checked against a provider vocabulary (that would couple `core` to wire formats); a typo simply never matches.

## Request pipeline (order is load-bearing)

`POST /api/flows/:flowKind/webhooks/:provider`, one flow per request via `registry.get`. `handleWebhook` in `routes.ts`:

1. Flow and provider lookup on both maps → 404 if missing.
2. Read the raw body **once**, reused for verify, parse and the envelope's `rawBody`.
3. **Verify.** `false` **or a throw** → 401; a throwing verifier is a bad signature, never a 500.
4. Parse (default `JSON.parse`) → 400 on throw.
5. Build `WebhookInboundEvent` (eventType, deliveryId).
6. **Handshake:** a non-null `acknowledge` → 200 with that body, **no dispatch**.
7. Match `on[eventType]` whose `when` passes; otherwise **202 `ignored`**. Providers retry non-2xx, so a deliberately unhandled event must still ack 2xx.
8. Resolve `input` / `sessionId` → 500 `route_failed` on throw.
9. `host.resolvePrincipal({ source: "webhook", … })`, typically `authentication.defaultUserId`.
10. `host.validateDispatch` (org binding) → 403.
11. Find-or-create the session if one was derived.
12. Dispatch with `responseEmitter: null` (no outbound channel). **Await `handle.accepted`** when available, so a crash after the 202 can't silently drop the delivery; never await the action.
13. 202 `{ status, provider, eventType, requestId }`, well inside provider budgets (Slack 3 s, GitHub 10 s) however long the action runs.

`metadata.webhook = { provider, eventType, deliveryId? }` is the resolution coordinate (gated on `source`) and provenance.

## Not handled here

- **Redelivery dedupe.** Providers deliver at least once. The adapter surfaces `deliveryId` on the event and metadata and does not dedupe; the delivery id is the natural idempotency key.
- **Two different events racing one derived session** is the flow's [concurrency policy](../../apps/docs/docs/advanced/concurrency-policies.md); a `reject` there answers the provider with a skipped 2xx.
