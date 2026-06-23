# Webhook Transport Adapter

The webhook transport (FIX-439) turns an inbound HTTP webhook — Stripe,
GitHub, Slack Events, any signed service POST — into a flow action invocation.
It conforms to the `InboundTransportAdapter` contract, a sibling of the
built-in HTTP adapter, `@flow-state-dev/mcp`, and `@flow-state-dev/scheduled`.
See [Inbound Transports](./inbound-transports.md) for the contract. The runtime
below the adapter is identical to HTTP: `host.dispatch` runs the action, and
`RequestRecord.source = "webhook"` carries provenance through to DevTool.

A webhook binding carries its handler inline (the shared `ActionCore`), not a
named entry in `flow.actions`. As of FIX-838 the chat and scheduled transports
follow this same inline-core binding model — see [Action forms](./action-forms.md).

The defining trait is the **division of labour**. A flow declares routing only
— which event runs which action — and carries no secrets. The host supplies
provider mechanics — signature verification, payload parsing, event-type and
delivery-id extraction, and the optional handshake — at adapter mount, keyed by
the same provider name. This keeps secrets and Node `crypto` out of the
isomorphic flow definition.

## Packaging: core (declaration) + server (runtime)

The webhook transport does **not** ship as a separate package. It splits across
two existing ones:

- **`@flow-state-dev/core`** carries the declaration surface
  (`packages/core/src/types/webhooks.ts`): `WebhookConfig`,
  `WebhookSubscriptionConfig`, `WebhookEventBinding`, `WebhookInboundEvent`,
  `defineWebhookBinding`, and the registration-time `validateWebhookConfig`. A
  binding extends the shared `ActionCore` (`packages/core/src/types/flow.ts`).
  All browser-safe, no crypto.
- **`@flow-state-dev/server`** carries the runtime
  (`packages/server/src/transports/webhook/`), next to the HTTP adapter, plus
  the signature verifiers in `transports/auth/`.

Two reasons it isn't its own package. First, it isolates no external dependency
— unlike `@flow-state-dev/mcp` (the MCP SDK) or `@flow-state-dev/chat-sdk` (the
Vercel Chat SDK), the webhook transport needs nothing a consumer doesn't already
have. Second, signature verification needs Node `crypto`, which is not
isomorphic. The verification code therefore cannot live in `core`; it lives in
`server`, the same package the HTTP adapter and the existing
`createHmacVerifier` already live in. The flow-side declaration is pure routing
and stays in `core` so a flow definition remains browser-safe.

## Config surface

A flow declares its webhook subscriptions on `FlowDefinition.webhooks`, keyed by
provider:

```ts
type WebhookConfig = Record<string, WebhookSubscriptionConfig>;

interface WebhookSubscriptionConfig {
  on: Record<string, WebhookEventBinding>;
}

// A webhook binding is an action in webhook form: it extends the shared
// ActionCore (the handler `block` plus execution policy — `durable`,
// `tokenBudget`, `onCompleted`/`onErrored`, `inputSchema`) with the event
// mapping. It lives on `flow.webhooks`, never `flow.actions`, so it is
// event-addressed and has no caller-addressed (HTTP/MCP) surface.
interface WebhookEventBinding extends ActionCore {
  input: (event: WebhookInboundEvent) => unknown | Promise<unknown>;
  sessionId?: (event: WebhookInboundEvent) => string | Promise<string> | undefined;
  when?: (event: WebhookInboundEvent) => boolean;
}
```

Because a webhook handler lives off `flow.actions`, the runtime resolves it from
`flow.webhooks[provider].on[event]` via the `(provider, eventType)` coordinate
the adapter stamps onto `metadata.webhook` (see `resolveActionCore` in
`server`). The dispatched request records the handler block's `name` as its
`actionName` for provenance.

Unlike `ChatConfig` — where the event is typed `unknown` because `core` cannot
import the chat-sdk's `ChatInboundEvent` without inverting the package
dependency — the webhook event shape is **framework-owned**, so
`WebhookInboundEvent` is concrete in `core`. Only `payload` is `unknown`;
`defineWebhookBinding<TPayload>()` narrows it as a compile-time passthrough.

The host-side `WebhookProviderDefinition` lives in `server` because it carries
the `verify` function:

```ts
interface WebhookProviderDefinition {
  verify: (rawBody: Uint8Array, headers: Headers) => boolean | Promise<boolean>;
  eventType?: (payload: unknown, headers: Headers) => string | null;
  parse?: (rawBody: Uint8Array, headers: Headers) => unknown;
  deliveryId?: (payload: unknown, headers: Headers) => string | undefined;
  acknowledge?: (event: WebhookInboundEvent) => BodyInit | null;
}
```

## Provider mechanics at mount vs routing on the flow

The boundary is deliberate and mirrors what each side legitimately owns:

- **The flow owns routing.** It knows its actions and how an event maps to their
  inputs. That's domain logic, version-controlled with the flow, browser-safe,
  no credentials.
- **The host owns mechanics.** Verification needs a secret. The event-type
  discriminator's *location* is a wire-protocol fact (Stripe body `.type`,
  GitHub `X-GitHub-Event` header, Slack nested `payload.event.type`), not flow
  logic. Parsing, delivery-id extraction, and the handshake are likewise
  protocol concerns. They're supplied once at mount, keyed by provider name, and
  reused by every flow that subscribes to that provider.

The two maps are keyed by the same provider name. At `start()` the adapter
asserts every provider a flow declares has a matching definition on the mount
(`assertProvidersCoverSubscriptions`), throwing at startup rather than 404-ing a
live, retrying provider at request time.

## Registration-time validation

`validateWebhookConfig` runs inside `defineFlow`, alongside `validateChatConfig`
and `validateSchedulesConfig`, and *before* the resource/`requireOrg`
aggregation that walks each binding's handler block. No-op when `webhooks` is
absent. Otherwise each provider must declare an `on` map; each binding must
carry a `block` (the handler) and a function `input`; `sessionId`/`when`, when
present, must be functions; provider and event keys must be non-empty. Event-key
spelling is *not* validated against any provider vocabulary — keys are opaque
strings, a typo simply never matches — because hard-coding a vocabulary would
couple `core` to provider-specific wire formats. It throws plain `Error`,
matching the sibling validators.

## Per-request registry lookup by flowKind-in-URL

The adapter mounts one parameterized route,
`POST /api/flows/:flowKind/webhooks/:provider`, and resolves one flow per
request via `host.registry.get(flowKind)` keyed by the URL param — the same
per-request-lookup pattern MCP and Scheduled use.

This is a deliberate contrast with the **chat** adapter, which cannot key on a
URL param (chat events carry no flow kind in their payload) and instead walks
every flow at mount via the `start()` hook to build a subscription index.
Webhooks carry the flow kind in the URL, so they need no such index — the
provider, not the flow, is the only thing the URL doesn't already pin down, and
the `:provider` segment supplies that.

## Request pipeline

The order in `routes.ts` (`handleWebhook`) is load-bearing:

1. **Flow + provider lookup.** `registry.get(flowKind)`; the flow's
   `webhooks[provider]` and the mount's `providers[provider]`. A missing flow or
   unconfigured provider → 404.
2. **Read raw body once.** `req.arrayBuffer()` → `Uint8Array`. Read once,
   reused for verification, parsing, and the dispatch envelope's `rawBody`.
3. **Verify** (`def.verify`). A `false` return *or a throw* → 401. A throwing
   verifier is treated as invalid, never a 500 — a bad signature is a caller
   error.
4. **Parse** (`def.parse`, default `JSON.parse(utf8)`). A throw → 400.
5. **Build the event.** Extract `eventType` and `deliveryId`, assemble
   `WebhookInboundEvent`.
6. **Handshake short-circuit.** If `def.acknowledge` returns non-null, respond
   200 with that body and do **not** dispatch (Slack `url_verification`).
7. **Match.** The declarative `on[eventType]` binding whose `when` passes wins;
   else 202 `ignored`. (Providers retry on non-2xx, so a deliberately unhandled
   event must ack with 2xx.) The dispatch envelope's `action` is the matched
   handler block's `name` (provenance); the runtime re-resolves the handler from
   `flow.webhooks` via `metadata.webhook`.
8. **Resolve `input`/`sessionId`.** Awaited. A throw → 500 `route_failed`.
9. **Resolve principal.** `host.resolvePrincipal({ source: "webhook", request,
   rawBody, envelope })`. For typical webhook flows this returns
   `authentication.defaultUserId`. A `PrincipalResolutionError` maps to its
   `status`.
10. **Validate dispatch** (`host.validateDispatch`) — enforces org binding. A
    throw → 403.
11. **Ensure session** (find-or-create) when a `sessionId` was derived, so the
    action's session exists before dispatch.
12. **Dispatch** fire-and-forget. `responseEmitter: null` — there's no outbound
    stream. Await `handle.accepted` (durable request recording) when the
    dispatcher surfaces it, so a crash after the 202 doesn't silently drop the
    delivery; the action itself is never awaited.
13. **202 immediately** with `{ status, provider, eventType, requestId }`.

Because the action runs after the 202, the ack returns well inside provider
budgets (Slack 3s, GitHub 10s) regardless of action duration.

## Source and metadata provenance

Every dispatched request carries `source: "webhook"` and
`metadata.webhook = { provider, eventType, deliveryId? }` onto the
`RequestRecord`, for trace and DevTool. DevTool renders the `webhook` source
with its own badge (see [Inbound Transports](./inbound-transports.md) → known
sources). `deliveryId` is included only when the provider's `deliveryId`
extractor is configured.

## Key divergences from chat

Stated honestly, because they're real:

- **Webhooks own signature verification.** Chat delegates verification to the
  Vercel Chat SDK; webhooks verify directly with the `verify` slot, because
  there's no SDK in the middle. The verifiers (`stripeWebhookVerifier`,
  `githubWebhookVerifier`, `slackWebhookVerifier`, `createWebhookVerifier`) wrap
  the existing `createHmacVerifier` where the scheme is generic HMAC, and do
  bespoke HMAC where it isn't (Slack's `v0:<ts>:<body>` with the timestamp in a
  separate header). Secrets accept a `() => string` getter resolved lazily on
  first use.
- **Webhooks extract their own event-type discriminator.** Its location is
  provider-specific, so the host supplies `eventType` per provider rather than
  the framework assuming one location.
- **No outbound channel.** A webhook delivery gets a 202 ack and nothing else —
  no thread to stream back to, hence `responseEmitter: null`.

## Idempotency and concurrency

- **Redelivery dedup.** Providers deliver at-least-once. v1 surfaces
  `deliveryId` on the event and on `metadata.webhook` for downstream dedup;
  it does not dedup itself. A same-event-redelivery dedup store composes later
  with the idempotency work in **FIX-402** — the delivery id is the natural key.
- **Competing requests on one session.** Arbitrating two *different* events
  racing for the same derived session (as opposed to redeliveries of one event)
  is **FIX-837**. Until then, derive session ids that don't collide across
  unrelated events.

## Relationship to other work

- **FIX-441** (cross-flow event bus) — adjacent, same shape as the chat
  transport's relationship to it. This is the inbound side (external service
  events → flows); FIX-441 is the cross-flow side (flow → flow). Distinct
  primitives, no dependency.
- **FIX-402** (idempotency) — composes with the surfaced `deliveryId` for
  redelivery dedup.
- **FIX-837** (session request arbitration) — handles competing concurrent
  requests on a single session.

## Related contracts

- [Action forms](./action-forms.md) — the shared `ActionCore` model webhook,
  chat, and scheduled bindings all carry inline.
- [Inbound Transports](./inbound-transports.md) — the adapter contract.
- [Chat Transport](./chat-transport.md) — sibling adapter; contrast the
  mount-time index vs. this adapter's per-request URL lookup.
- [Scheduled Actions](./scheduled-actions.md) — sibling per-flow declarative
  transport with the same per-request registry lookup.
