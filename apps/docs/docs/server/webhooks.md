---
sidebar_position: 8
sidebar_label: Webhooks
---

# Webhook receivers

A webhook is an HTTP POST from an external service: Stripe telling you an
invoice was paid, GitHub telling you a pull request opened, Slack telling you
someone sent your bot a message. The webhook transport turns those deliveries
into flow action invocations. The framework verifies the request is genuine,
figures out which event it is, and routes it to the action you named — all
declared on the flow definition.

The split that matters: the flow declares routing, and nothing else. Which
event runs which action, how the event maps to the action's input. No secrets,
no signature code. Verification and the provider-specific mechanics live on the
host, supplied once when you mount the adapter. A flow author reads one file to
know what fires it; secrets stay out of that file.

## Install and mount

The webhook transport ships inside `@flow-state-dev/server` — the declaration
helpers are in `@flow-state-dev/core`, the runtime sits next to the HTTP
adapter. There's no separate package to install.

`createWebhookTransportAdapter` is another entry in `adapters` on
[`createFlowState`](./setup.md), the canonical setup entrypoint:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import {
  createWebhookTransportAdapter,
  stripeWebhookVerifier,
} from "@flow-state-dev/server";

export const flowstate = createFlowState({
  flows: { billing: billingFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        stripe: {
          verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!),
          eventType: (payload) => (payload as StripeEvent).type,
        },
      },
    }),
  ],
});
```

Turn the handle into route handlers with a platform handler — the webhook route
mounts under the same router:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

The adapter mounts one route, `POST /api/flows/:flowKind/webhooks/:provider`.
The `:provider` segment is the same name you key the flow's `webhooks` map and
the mount's `providers` map by. `basePath` defaults to `/api/flows`; override it
if your routes mount elsewhere.

If a flow declares a webhook provider the mount didn't configure, the adapter
throws at startup rather than 404-ing a live, retrying provider later. You see
the misconfiguration once, in development.

## Declaring subscriptions on the flow

Put a `webhooks` map on the flow, keyed by provider name. Each provider has an
`on` map: each key is an event type, each value binds it to an action and says
how the event maps to that action's input. These imports come from
`@flow-state-dev/core` only — a flow definition never touches the transport
package or a secret.

```ts
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";

const billingFlow = defineFlow({
  kind: "billing",
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    recordPayment: { block: recordPaymentPipeline },
  },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding<StripeEvent>({
          action: "recordPayment",
          input: (e) => ({ invoiceId: e.payload.data.object.id }),
          sessionId: (e) => `customer-${e.payload.data.object.customer}`,
        }),
      },
    },
  },
});
```

A binding has four fields:

- **`action`** — the flow action to run. Must be a key in `actions`;
  `defineFlow` throws at registration if it isn't.
- **`input`** — maps the event to the action's input. May be async. The result
  is validated against the action's `inputSchema`, the same way an HTTP body is.
- **`sessionId`** (optional) — derives the session id from the event. May be
  async. Omit it and the webhook runs in a fresh session — a webhook has no
  thread to key on. See [Sessions](#sessions).
- **`when`** (optional) — a synchronous predicate. A falsy result skips the
  binding, the event is acknowledged and ignored. Use it to narrow a coarse
  event type to a sub-action, e.g. `when: (e) => e.payload.action === "opened"`.

The event handed to a binding is a `WebhookInboundEvent`:

```ts
interface WebhookInboundEvent<TPayload = unknown> {
  provider: string;           // the :provider URL segment
  eventType: string | null;   // the host's extracted discriminator
  payload: TPayload;          // the parsed body
  headers: Headers;           // raw request headers
  rawBody: Uint8Array;        // exact request bytes
  deliveryId?: string;        // stable per-delivery id, when configured
}
```

`payload` is `unknown` unless you narrow it. `defineWebhookBinding<TPayload>()`
gives `e.payload` a type — it's a compile-time convenience and a passthrough at
runtime, so a plain object literal works too, you just lose the type.

`requireUser: false` opts the flow out of user-scope identity at build time; the
framework rejects user-scope state, `client` blocks, and user-scope resource
declarations on such a flow. The runtime still needs a `userId` for the request
record — that's what `defaultUserId` covers. See
[Authentication](./authentication.md#what-requireuser-true-does-and-doesnt).

## Provider definitions

A flow says *which event runs which action*. It cannot say *how to read this
provider's wire format* — that needs the provider's secret and its
event-type/delivery-id conventions, which differ from one service to the next.
Those live on the host, keyed by the same provider name, supplied to the
adapter:

```ts
interface WebhookProviderDefinition {
  verify: (rawBody: Uint8Array, headers: Headers) => boolean | Promise<boolean>;
  eventType?: (payload: unknown, headers: Headers) => string | null;
  parse?: (rawBody: Uint8Array, headers: Headers) => unknown;
  deliveryId?: (payload: unknown, headers: Headers) => string | undefined;
  acknowledge?: (event: WebhookInboundEvent) => BodyInit | null;
}
```

- **`verify`** (required) — confirm the request is authentically from the
  provider, over the raw bytes. Returning `false` (or throwing) rejects the
  delivery with 401. Compose one of the presets below or supply your own.
- **`eventType`** — extract the discriminator that matches the flow's `on` keys.
  Required when any subscribed flow uses `on`. Its location varies by provider:
  Stripe puts it in the body (`payload.type`), GitHub puts it in a header
  (`X-GitHub-Event`), Slack puts it under `payload.type` / `payload.event.type`.
- **`parse`** — turn the raw body into a payload. Defaults to
  `JSON.parse(utf8(rawBody))`.
- **`deliveryId`** — extract a stable per-delivery id for provenance and
  downstream deduplication. See [Idempotency](#idempotency).
- **`acknowledge`** — an optional handshake. When it returns a non-null body,
  the adapter responds 200 with that body and does not dispatch. This is how
  Slack's `url_verification` challenge gets answered. See
  [Acknowledgement and async execution](#acknowledgement-and-async-execution).

Secrets are read here, never on the flow. Each verifier accepts a string or a
`() => string` getter; the getter is resolved lazily on first use, so it can
read an env var that's populated after module load.

## Verifying signatures

`verify` is the trust boundary. The webhook transport owns signature
verification directly — unlike the chat transport, which delegates to the
Vercel Chat SDK. Three presets cover the common providers, plus a generic
constructor:

```ts
import {
  stripeWebhookVerifier,
  githubWebhookVerifier,
  slackWebhookVerifier,
  createWebhookVerifier,
} from "@flow-state-dev/server";
```

- **`stripeWebhookVerifier(secret, { toleranceSeconds? })`** — reads
  `Stripe-Signature` (`t=<ts>,v1=<hex>`), signs `<ts>.<rawBody>`, and rejects
  timestamps older than `toleranceSeconds` (default 300s) to defend against
  replay.
- **`githubWebhookVerifier(secret)`** — reads `X-Hub-Signature-256`
  (`sha256=<hex>`) and signs the raw body.
- **`slackWebhookVerifier(secret, { toleranceSeconds? })`** — Slack's scheme
  signs `v0:<timestamp>:<rawBody>`, with the timestamp in a separate
  `X-Slack-Request-Timestamp` header and the signature in `X-Slack-Signature`.
  Default window is 300s.

For any other provider, `createWebhookVerifier` builds an HMAC verifier from the
header name and format:

```ts
createWebhookVerifier({
  header: "x-acme-signature", // request header carrying the signature
  secret: () => process.env.ACME_WEBHOOK_SECRET!,
  format: "raw",              // "raw" | "stripe" | "custom"
  prefix: "sha256=",          // stripped before comparison (raw format)
  algorithm: "sha256",        // sha256 | sha1 | sha512, default sha256
  encoding: "hex",            // hex | base64 | base64url, default hex
  toleranceSeconds: 300,      // for timestamped formats
});
```

All verifiers compare in constant time. The framework stores no secrets — the
verifier is a pure function over `(rawBody, headers)`.

## Routing

There are two ways to map an event to an action. They compose:

**`on` — declarative, the primary surface.** A map from event type to binding.
The adapter looks up `on[event.eventType]`, runs the binding's `when` predicate
if present, and if it passes, that binding wins.

**`route` — imperative, the escape hatch.** A function over the event returning
`{ action, input, sessionId? }` or `null`. Consulted only when no `on` binding
matched. Reach for it when the event-to-action decision is too dynamic for a
static map.

```ts
webhooks: {
  stripe: {
    on: {
      "invoice.paid": defineWebhookBinding<StripeEvent>({
        action: "recordPayment",
        input: (e) => ({ invoiceId: e.payload.data.object.id }),
      }),
    },
    route: (e) => {
      // fallback: anything not in `on`
      if (e.eventType?.startsWith("customer.")) {
        return { action: "syncCustomer", input: { raw: e.payload } };
      }
      return null; // acknowledge and ignore
    },
  },
}
```

Precedence is total. A matching `on` binding wins and `route` is never
consulted. When neither matches — no `on` key for this event type, or its `when`
failed, and `route` returned `null` — the event is acknowledged and ignored with
a 202. Webhook providers retry on non-2xx, so ignored events return 2xx on
purpose: you don't want a provider hammering an endpoint over an event you
deliberately don't handle.

`when` is synchronous, evaluated before any async work so the no-match case
stays cheap. For asynchronous filtering, let the action run and reject inside
it.

## Sessions

Most webhooks have no conversation thread. A binding that omits `sessionId`
runs in a fresh ephemeral session — fine for fire-and-forget side effects like
recording a payment.

When you do want continuity, derive a `sessionId` from something stable in the
payload: a Stripe customer id, a GitHub PR number, a Slack channel. The runtime
finds the existing session or creates it (find-or-create), so repeated events
for the same key land in the same session and its state accumulates.

```ts
sessionId: (e) => `customer-${e.payload.data.object.customer}`,
```

A derived session is bound to the resolved principal the first time it's
created. Later deliveries that resolve to the same session must resolve to the
same principal — the standard
[session consistency check](./authentication.md#session-consistency-check)
applies.

## Acknowledgement and async execution

The endpoint is fire-and-forget. Once a delivery is verified, routed, and the
session ensured, the adapter dispatches the action and returns **202
immediately** with a `requestId`. The action runs asynchronously; the 202 does
not mean it finished. Errors after dispatch land on the request record and
surface in DevTool, not in the webhook response.

Returning fast is the point. Providers enforce tight delivery budgets — Slack
wants a response in 3 seconds, GitHub in 10 — and treat a slow or failing
response as a failed delivery worth retrying. Because the action runs after the
202, the ack returns well inside those budgets no matter how long the action
takes.

Some providers need a one-time handshake before they'll send real events. Slack
posts a `url_verification` challenge and expects the `challenge` value echoed
back. The `acknowledge` hook handles it: return a body and the adapter responds
200 with it and skips dispatch.

```ts
slack: {
  verify: slackWebhookVerifier(() => process.env.SLACK_SIGNING_SECRET!),
  acknowledge: (e) => {
    const p = e.payload as { type?: string; challenge?: string };
    return p.type === "url_verification" ? p.challenge ?? null : null;
  },
  eventType: (payload) => {
    const p = payload as { type?: string; event?: { type?: string } };
    return p.event?.type ?? p.type ?? null;
  },
}
```

## Idempotency

Providers deliver at-least-once. The same event can arrive more than once,
especially after a slow response triggers a retry. When the provider stamps each
delivery with a stable id, wire `deliveryId` so it flows onto the request as
`metadata.webhook.deliveryId`, and through to the event your binding sees:

```ts
stripe: {
  verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!),
  eventType: (payload) => (payload as StripeEvent).type,
  deliveryId: (payload) => (payload as StripeEvent).id,
}
```

v1 surfaces the delivery id; it does not dedup for you. Make the action
idempotent — key your own write on `deliveryId` (or a natural key from the
payload) and no-op on a repeat. That's the right place for it anyway: only your
action knows whether reprocessing an event is harmful.

Arbitrating two genuinely competing deliveries on the same session — not
redeliveries of one event, but two different events racing for the same session
— is a separate concern the runtime will grow over time. For now, derive
session ids that don't collide across unrelated events.

## Webhooks vs chat

Slack shows up in two places, and the difference is real. The
[chat transport](./chat.md) wraps a Slack bot for real-time conversation:
mentions, slash commands, reactions, replies streamed back to the thread. The
webhook transport receives Slack's Events API — asynchronous server-to-server
notifications with no outbound reply channel, just a 202 ack.

Reach for chat when you're building a conversational bot. Reach for webhooks
when an external service is notifying your backend that something happened and
you want to react. They can coexist on the same server.

Three honest divergences from the chat transport:

- **Webhooks own signature verification.** Chat delegates it to the Vercel Chat
  SDK; webhooks verify directly because there's no SDK in the middle.
- **Webhooks extract their own event-type discriminator.** Its location varies
  by provider — Stripe's body, GitHub's header, Slack's nested payload — so the
  host's `eventType` function names it per provider.
- **No outbound channel.** A webhook delivery gets a 202 ack and nothing else.
  There's no thread to stream back to.

## Minimal example

The smallest end-to-end Stripe `invoice.paid` → `recordPayment`, split across
the flow (routing) and the host (mechanics).

The flow — routing only, no secrets:

```ts title="flows/billing.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";

interface StripeEvent {
  type: string;
  data: { object: { id: string; customer: string } };
}

export const billingFlow = defineFlow({
  kind: "billing",
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    recordPayment: { block: recordPaymentPipeline },
  },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding<StripeEvent>({
          action: "recordPayment",
          input: (e) => ({ invoiceId: e.data.object.id }),
        }),
      },
    },
  },
});
```

The host — verification and mechanics:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import {
  createWebhookTransportAdapter,
  stripeWebhookVerifier,
} from "@flow-state-dev/server";
import { billingFlow } from "@/flows/billing";

export const flowstate = createFlowState({
  flows: { billingFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        stripe: {
          verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!),
          eventType: (payload) => (payload as { type: string }).type,
        },
      },
    }),
  ],
});
```

A `POST /api/flows/billing/webhooks/stripe` with a valid signature and an
`invoice.paid` body runs `recordPayment` and returns 202.

## Guides

- [Receiving Stripe webhooks](/guides/webhooks-stripe)
- [Receiving GitHub webhooks](/guides/webhooks-github)
- [Receiving Slack Events](/guides/webhooks-slack-events)

For provenance, the `source` field, and the per-flow declarative pattern this
shares with MCP and Scheduled, see
[Inbound transports](/docs/advanced/inbound-transports).
