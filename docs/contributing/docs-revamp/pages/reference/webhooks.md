---
title: Webhooks and inbound transports
type: reference
description: "How a flow receives events from services such as Stripe, GitHub and Slack: the binding fields, the provider definition and verifiers, what happens to a delivery, what a sender gets back, who the caller is, and how to write a transport of your own."
---

# Webhooks and inbound transports

A webhook is a request a service sends to your server when something happens on its side: an invoice was paid, a pull request opened, a message posted. No user is signed in. The sender waits a few seconds for an answer, and it sends the request again when the answer is a failure.

Flow State gives these requests their own entrance, and splits the work in two. The flow declares which events it handles and what each one runs. The server's mount holds everything about the sender: its secret, how it signs requests and where the event name sits in the body. A request is trusted because its signature checks out, and it is answered once it is recorded, while the work runs after the answer. The flow never sees a secret, and the sender never waits on the work.

A webhook is one inbound transport, the general name for anything that turns a request from outside into a run of a flow. HTTP, MCP, webhooks and the schedule tick are transports. This page covers the webhook transport and what you need to write another.

The tables use one app, a `billing` flow. Stripe sends it `invoice.paid`, and the flow records the payment in a session named for the Stripe customer, which is where the flow keeps that customer's payments together as one record. `recordPayment` is a handler, the simplest kind of block.

```ts title="src/flows/billing/blocks/record-payment.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const recordPayment = handler({
  name: "record-payment",
  inputSchema: z.object({
    invoiceId: z.string(),
    deliveryId: z.string().optional(),
  }),
  execute: (input) => ({ recorded: input.invoiceId }),
});
```

```ts title="src/flows/billing/flow.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
import { recordPayment } from "./blocks/record-payment";

type InvoicePaid = {
  data: { object: { id: string; customer: string; amount_paid: number } };
};

export const billing = defineFlow({
  kind: "billing",
  actions: {},
  authentication: { defaultUserId: "system", requireUser: false },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding<InvoicePaid>({
          block: recordPayment,
          input: (event) => ({
            invoiceId: event.payload.data.object.id,
            deliveryId: event.deliveryId,
          }),
          sessionId: (event) => `customer-${event.payload.data.object.customer}`,
          when: (event) => event.payload.data.object.amount_paid > 0,
        }),
      },
    },
  },
});
```

```ts title="src/lib/flowstate.ts"
import {
  createFlowState,
  createWebhookTransportAdapter,
  inMemoryStores,
  stripeWebhookVerifier,
} from "@flow-state-dev/engine";
import { billing } from "../flows/billing/flow";

export const flowstate = createFlowState({
  flows: [billing({ id: "billing" })],
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        stripe: {
          verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!),
          eventType: (payload) => (payload as { type: string }).type,
          deliveryId: (payload) => (payload as { id: string }).id,
        },
      },
    }),
  ],
});
```

The flow file imports from `@flow-state-dev/core` only. The mount file holds the secret and the Stripe wire format. A flow that receives only webhooks writes `actions: {}`, because `defineFlow` requires the map. In Next.js, `createVercelNextHandler(flowstate)` from `@flow-state-dev/vercel/next` serves the route. The Stripe, GitHub and Slack guides cover each provider's dashboard setup.

## Where a delivery arrives

| Part | Behavior |
| --- | --- |
| Route | `POST <basePath>/:flowKind/webhooks/:provider`. For the example, `POST /api/flows/billing/webhooks/stripe`. Matched ahead of the built-in routes, so the HTTP router's cross-site and body-type checks do not apply. |
| `basePath` | Default `/api/flows`. Trimmed, given a leading `/`, and stripped of trailing `/`. `basePath: "/hooks"` mounts `/hooks/:flowKind/webhooks/:provider`. |
| `:flowKind` | The id of the flow instance. An unknown id answers `404 flow_not_found`. |
| `:provider` | The key of the flow's `webhooks` map and of the mount's `providers` map. Spell them the same. |
| Where it is installed | An entry in `adapters` on `createFlowState` or `createFlowApiRouter`. It ships inside `@flow-state-dev/engine`; there is no separate package. |
| Adapter `source` | `"webhook"`. Stamped on every request it dispatches. |

When the router is built, a registered flow that declares a provider the mount has no definition for throws, and so does a flow with an `on` map whose provider definition has no `eventType`. The server does not start. When the flow is defined, `defineFlow` throws a plain `Error` for a malformed `webhooks` map: an empty provider name, an empty `on` key, a binding with no `block` or whose `input` is not a function, a `sessionId` or `when` that is not a function, a provider with both `on` and `service`. Event keys are opaque strings. A typo is not caught, and never matches.

## Binding fields

A binding is the value under `webhooks[provider].on[eventType]`. `defineWebhookBinding<TPayload>()` types the payload and returns its argument unchanged. A binding is an action in webhook form, so it carries the block and its policy directly and has no entry in `actions`.

| Field | Meaning |
| --- | --- |
| `on` key | The event type, compared by exact equality with what the provider's `eventType` extractor returned. Never a dotted sub-event: for GitHub the key is `pull_request`, and `action === "opened"` goes in `when`. An event whose type is `null` matches nothing. |
| `block` | Required. Any block kind. |
| `input` | Required. `(event) => unknown`, may be async. Maps the event to the block's input. The result is validated against the binding's `inputSchema`, falling back to the block's own schema, as an HTTP body is. A throw answers `500 route_failed`. |
| `sessionId` | Optional. `(event) => string \| undefined`, may be async. Omitted, or returning `undefined`, the delivery runs in a fresh session. Given, the session is found or created, so events with the same id share one. A throw answers `500 route_failed`. |
| `when` | Optional. `(event) => boolean`, synchronous. A falsy result is a non-match: the delivery is answered `202 ignored` and nothing runs. A throw is logged as a warning and treated as a non-match. |
| Action policy | The binding also takes the rest of an action's policy: `inputSchema`, `durable`, `tokenBudget`, `onCompleted`, `onErrored`. A flow-level `tools` setting applies to a webhook block as it does to a caller's action. |

The event passed to `input`, `sessionId` and `when`:

| Field | Meaning |
| --- | --- |
| `provider` | The `:provider` segment. |
| `eventType` | What the extractor returned, or `null`. |
| `payload` | The parsed body. `unknown` until typed with `defineWebhookBinding<T>()`. |
| `headers` | The request's `Headers`. |
| `rawBody` | The exact request bytes, as a `Uint8Array`. |
| `deliveryId` | Present only when the provider's `deliveryId` extractor returned one. |

A binding has no action endpoint, is not listed among the flow's actions and is never an MCP tool. It runs only through a verified delivery. A request that arrived by webhook cannot be re-run from the public `retry`, `continue` or `resume` routes, and a refused re-run answers the not-found a missing request does. The sources those routes accept are on [HTTP API](./http-api.md). `webhook`, `internal` and `task` cannot be added with `publicReentrySources`: naming one throws when the router is built.

## Provider definition

`createWebhookTransportAdapter({ providers, basePath? })` takes one definition per provider name.

| Field | Meaning |
| --- | --- |
| `verify` | Required. `(rawBody, headers) => boolean \| Promise<boolean>`. Runs over the raw bytes before anything is parsed. `false` or a throw answers `401`. |
| `eventType` | `(payload, headers) => string \| null`. Required when a flow uses `on` for this provider. A throw is logged and read as `null`. Stripe reads `payload.type`, GitHub the `X-GitHub-Event` header, Slack `payload.event.type` falling back to `payload.type`. |
| `parse` | `(rawBody, headers) => unknown`. Default is `JSON.parse` of the UTF-8 body. A failure, including a throw from a custom `parse`, answers `400 invalid_payload`. Runs after `verify`. |
| `deliveryId` | `(payload, headers) => string \| undefined`. The sender's id for this delivery: Stripe's `payload.id`, GitHub's `X-GitHub-Delivery` header, Slack's `payload.event_id`. Set on `event.deliveryId` and recorded as `metadata.webhook.deliveryId`. A throw is logged and the id omitted; the delivery runs. |
| `acknowledge` | `(event) => BodyInit \| null`. A handshake. A non-null return is sent as the body of a `200` and nothing runs (Slack's `url_verification` challenge). `null` continues. A throw is logged and read as `null`. Runs after verification, so an unsigned request never reaches it. |

The route does not deduplicate. A sender that redelivers makes another request. Pass `event.deliveryId` into the block's input and make the block idempotent.

## Verification

Every verifier has the type `(rawBody: Uint8Array, headers: Headers) => boolean`, compares in constant time, and returns `false` for a missing or malformed header. Each takes the secret as a string or a `() => string` getter. A getter is called on first use and memoized. An empty or non-string secret throws when the verifier is built or first used. The framework stores no secrets.

**What is returned to a sender whose signature fails?** `401` with `{ "error": "invalid_signature" }`. Nothing is parsed, routed or run, and no session is created. A `verify` that throws gets the same answer.

| Verifier | What it checks |
| --- | --- |
| `stripeWebhookVerifier(secret, { toleranceSeconds? })` | Header `Stripe-Signature`, `t=<unix seconds>,v1=<hex>`. HMAC-SHA256 over `<t>.<rawBody>`; any listed `v1` may match. Fails when the timestamp is more than `toleranceSeconds` from the current time in either direction. Default 300; `Infinity` turns the check off. |
| `githubWebhookVerifier(secret)` | Header `X-Hub-Signature-256`, `sha256=<hex>`. HMAC-SHA256 over the raw body. A header without the `sha256=` prefix fails. |
| `slackWebhookVerifier(secret, { toleranceSeconds?, now? })` | Headers `X-Slack-Signature` (`v0=<hex>`) and `X-Slack-Request-Timestamp` (digits only). HMAC-SHA256 over `v0:<timestamp>:<rawBody>`. Same tolerance as Stripe's. The secret is the app's signing secret, not a bot token. |
| `createWebhookVerifier(options)` | Any other HMAC scheme. See below. |

`createWebhookVerifier` options:

| Option | Meaning |
| --- | --- |
| `header`, `secret` | The header carrying the signature, and the secret. |
| `format` | `"raw"` (default, `[prefix]<signature>`), `"stripe"` (`t=…,v1=…`) or `"custom"`. |
| `parseSignature` | Required for `"custom"`: `(headerValue) => { timestamp?, signatures } \| null`. Without it the first verification throws, so a delivery fails. |
| `prefix` | Stripped before comparing. `"raw"` only. |
| `algorithm`, `encoding` | `sha256` (default), `sha1`, `sha512`; `hex` (default), `base64`, `base64url`. |
| `toleranceSeconds`, `now` | Default 300. Applies when the parsed header carries a timestamp. |

## What happens to a delivery

The steps run in this order, and the first that fails answers.

| Step | Outcome on failure, or what it does |
| --- | --- |
| Flow and provider lookup | Unknown flow: `404 flow_not_found`. Provider not declared on the flow, or not configured on the mount: `404 webhook_not_found` with the `provider`. |
| Verify | `401 invalid_signature`. |
| Parse | `400 invalid_payload`. |
| Extract | Runs `eventType` and `deliveryId`. A throw in either is logged, not an error. |
| Handshake | A non-null `acknowledge` answers `200` with that body. |
| Match | `on[eventType]`, then `when`. No match answers `202 ignored`, so the sender does not retry an event the flow does not handle. |
| Resolve | `input` and `sessionId` are awaited. A throw answers `500 route_failed`. |
| Principal | Resolves who the run belongs to; see [Who the caller is](#who-the-caller-is). |
| Validate | A missing or invalid organization, or a flow pinned to another owner, answers `403 dispatch_rejected`. |
| Session | With a `sessionId`, the session is created if absent. Two simultaneous first deliveries create one session. The create carries no initial state, so a flow whose sessions need some refuses it with `400`, `403` or `404`. A store failure answers `503 session_unavailable`. |
| Dispatch | Starts the run without waiting for it. A concurrency policy of `reject` with the key held answers `200 skipped`. Any other failure to start the run answers `503 flow_unregistered`, whatever the cause; read `message`. |
| Record | Waits until the request is durably recorded, never until it finishes. A failure answers `503 dispatch_not_durable`, so the sender retries, except a `reject` refusal, which answers `200 skipped`. |
| Answer | `202 accepted`. The block runs after the response; an error in it lands on the request record, not in the response. |

The answer does not wait for the block, so a slow block cannot push it past a provider's time budget (Slack's three seconds, GitHub's ten). It does wait for the record, so a slow store can.

The request record carries `source: "webhook"` and `metadata.webhook = { provider, eventType, deliveryId? }`. DevTool shows it with a webhook badge. The record's `action` is the block's `name`, for display; posting that name to the public action endpoint does not reach a webhook handler. A block reads the delivery through the event your `input` function maps, not through `metadata.webhook`.

## What a sender gets back

| Status | Body | When |
| --- | --- | --- |
| `202` | `{ status: "accepted", provider, eventType, requestId }` | Verified, matched and recorded. The block's output is not returned. |
| `202` | `{ status: "ignored", provider, eventType }` | No `on` key for the event type, or `when` was falsy or threw. |
| `200` | The `acknowledge` body | A handshake. Nothing runs. |
| `200` | `{ status: "skipped", reason: "in_flight", requestId }` | Concurrency policy `reject` dropped a duplicate while another request held the key. The sender stops redelivering. |
| `400` | `{ error: "invalid_payload" }` | `parse` failed. |
| `400`, `403`, `404` | `{ error: <message>, field? }` | The flow refused to create the session. |
| `401` | `{ error: "invalid_signature" }` | `verify` returned `false` or threw. |
| `401` | `{ error: "unauthorized", message }` | Principal resolution failed. The resolver may set another status. |
| `403` | `{ error: "dispatch_rejected", message }` | Validation refused the dispatch. |
| `404` | `{ error: "flow_not_found" }` | No such flow. |
| `404` | `{ error: "webhook_not_found", provider }` | The flow does not declare the provider, or the mount does not configure it. |
| `500` | `{ error: "route_failed", message }` | `input` or `sessionId` threw. |
| `500` | `{ error: "unauthorized", message }` | `requireUser: false`, no `userId` resolved and no `defaultUserId`. A server configuration error: set `defaultUserId` or resolve a `userId`. |
| `503` | `{ error: "session_unavailable" }` | The session store failed. |
| `503` | `{ error: "dispatch_not_durable" }` | The request was not recorded. |
| `503` | `{ error: "flow_unregistered", message }` | Starting the run threw for a reason other than a `reject` policy. The error name is the same for every cause; `message` carries the actual one. |
| `503` | `{ error: "session_unavailable" }` or `{ error: "dispatch_not_durable" }` | The `sessionId` or `requestId` belongs to another flow instance. |

## Who the caller is

The sender is authenticated by its signature. The route never reads a `userId` from the body, headers or query, so a delivery has no user of its own. The run needs a user and an organization to belong to, and gets them from the same resolution every transport uses. See [Authentication and tenancy](./authentication.md).

| Question | Answer |
| --- | --- |
| Where does `userId` come from? | The flow's `authentication.resolvePrincipal` when it has one, else the host's resolver, then `authentication.defaultUserId` when the resolver returns no `userId`. The host's default resolver reads `userId` from a JSON body, and a webhook body has none. |
| What does a webhook-only flow set? | `authentication: { defaultUserId: "system", requireUser: false }`. The request record and the session carry a `userId`, the `defaultUserId`. |
| What does `requireUser: false` rule out? | User-scope state, `client` blocks and user-scope resource declarations, checked when the flow is defined. |
| What if `requireUser` is `true`, the default? | A delivery with no `userId` after the `defaultUserId` fallback answers `401`. With `requireUser: false` and no `userId`, it answers `500`. |
| Which organization? | Every request needs a verified one. With no resolver configured anywhere, the framework supplies a development organization and logs one warning. A configured resolver must return a valid `orgId` that is not the development one, or the delivery answers `401`. For a webhook or other machine caller, have the resolver return `{ orgId }` and let `defaultUserId` name the user. |
| What does a resolver see? | `source: "webhook"`, the request, the `rawBody`, and an envelope with `flowKind`, `action`, `sessionId`, `metadata.webhook` and `input`. It can re-verify the signature itself. |
| Who owns a derived session? | The principal that created it. A later delivery that resolves to the same session id must resolve to the same principal. |
| Which copy of a flow? | The request is stamped with the instance named in the URL. A `sessionId` or `requestId` owned by another instance is refused with `FlowInstanceBindingMismatchError`, which the sender sees as a `503`. Knowing another instance's session id does not give access to it. |

## What a delivery stores

| Stored part | Owner | Where | How many |
| --- | --- | --- | --- |
| The request record: `source`, `metadata.webhook`, `userId`, `orgId`, `input` | The flow instance in the URL, run as the resolved principal | The host's request store (in memory unless the app installs SQLite or Postgres) | One per accepted delivery. A redelivery makes another. An ignored delivery makes none. |
| The derived session, when the binding sets `sessionId` | The principal that first created it | The host's session store, with metadata `{ source: "webhook", provider, eventType? }` | One per distinct `sessionId`. Without `sessionId`, a fresh session per delivery. |

## Service routes

A provider entry on a flow can be `{ service: { entry, normalize } }` in place of `on`, never both. `normalize(event, { received })` returns zero or more normalized events. Each is passed to the flow action named by `entry`, as the user `service:<provider>`, in the organization the host's resolver names. The action's output names the runs to start, each for the user who owns a stored record such as a subscription. A flow gets this from a provider's service-flow factory, such as `githubServiceFlow` in `@flow-state-dev/workforce`, rather than by hand. Verification and the handshake run before it, as for a binding.

| Status | Body | When |
| --- | --- | --- |
| `202` | `{ status: "accepted", provider, eventType, events, ownerRuns, refused }` | Each run started is recorded. `events` counts normalized events, `ownerRuns` the runs started, and `refused` the runs not started because the subscription record is missing, disabled, or in another organization or tenant. |
| `202` | `{ status: "ignored", provider, eventType }` | `normalize` returned no events. |
| `400` | `{ error: "invalid_payload" }` | `normalize` threw. |
| `500` | `{ error: "route_failed" }` | The entry action errored. Runs already started for earlier events stay started, and the sender should retry. |
| `503` | `{ error: "route_incomplete" }` | Routing was stopped before it finished, such as by a shutdown. The sender should retry. |
| `503` | `{ error: "dispatch_not_durable", failed }` | A started run was not recorded. `failed` counts them. |

## Writing a transport

A transport is an `InboundTransportAdapter`: a `source` string and a `createBindings(host)` function, called once when the host is built. It turns a request from outside into an envelope and hands it to the host. It authenticates the caller through `host.resolvePrincipal`, described below.

The example is a `partner` transport. A partner posts an input to `/partner/<flow>/<action>`, and the route starts that action.

```ts title="src/lib/partner-adapter.ts"
import type { InboundTransportAdapter } from "@flow-state-dev/engine/host";

export function createPartnerAdapter(): InboundTransportAdapter {
  return {
    source: "partner",
    createBindings(host) {
      return {
        routes: [
          {
            method: "POST",
            path: "/partner/:flowKind/:action",
            handler: async (req, { params }) => {
              const input = await req.json();
              const flowKind = params.flowKind;
              const action = params.action;

              const principal = await host.resolvePrincipal({
                source: "partner",
                request: req,
                envelope: { flowKind, action, input },
              });
              const envelope = {
                source: "partner",
                flowKind,
                action,
                input,
                principal,
                responseEmitter: null,
              };

              await host.validateDispatch(envelope);
              const handle = host.dispatch(envelope);
              await handle.accepted;
              return Response.json({ requestId: handle.requestId }, { status: 202 });
            },
          },
        ],
      };
    },
  };
}
```

Add it beside the webhook adapter: `adapters: [createWebhookTransportAdapter({ providers }), createPartnerAdapter()]`.

| Part | Behavior |
| --- | --- |
| `TransportBindings` | `routes?`, `start?()` and `stop?()`. `start` runs after every adapter's bindings are collected. A synchronous throw aborts startup; an async rejection is logged. `stop` tears down. |
| `TransportRoute` | `{ method, path, handler(req, { params }) => Promise<Response> }`. `method` is `GET`, `POST`, `PATCH`, `DELETE` or `PUT`. `:name` segments in `path` arrive in `params`. |
| Mounting | `adapters` on `createFlowState` or `createFlowApiRouter`. The HTTP adapter and the schedule endpoint are always mounted. Two adapters declaring the same method and path throw `TransportRouteCollisionError` when the router is built, with `method`, `path` and `sources`. |
| `source` | An open string stamped on every request record. Known values are `http`, `mcp`, `webhook`, `scheduled` and `notification`; no built-in transport sends `notification`. DevTool labels the known ones and shows others as written. `cli`, `internal` and `task` are reserved: a resolver call from a transport under `cli` is refused with `401`. |
| One adapter, every flow | An adapter serves every flow in the registry. |

The order an adapter follows is fixed: `host.resolvePrincipal(context)`, then build the envelope, then `await host.validateDispatch(envelope)`, then `host.dispatch(envelope)`.

| Host member | Meaning |
| --- | --- |
| `resolvePrincipal(context)` | Applies the flow's resolver, the host resolver, `defaultUserId` and `requireUser`. The context is `{ source, request?, envelope, rawBody? }`. |
| `validateDispatch(envelope)` | Throws for an unregistered flow or an envelope with no usable organization. |
| `dispatch(envelope)` | Synchronous. Returns a handle, and throws for an unknown flow or a malformed envelope. |
| `continueRequest(options)` | Re-enters a suspended request under its own id, as the HTTP `continue` route does: finished blocks replay and no second request is made. `options` takes `requestId`, `resumeContext`, `signal`, `responseEmitter`, `includeTrace` and `leaseId?`. Rejects for a missing record or an unregistered flow. The `partner` example does not use it. |
| `registry`, `stores`, `logger?`, `resolvers?` | The flow registry and the stores, with an optional logger and resolvers. |

The handle `dispatch` returns:

| Member | Meaning |
| --- | --- |
| `requestId` | The id the request runs under. |
| `accepted?` | Resolves once the request is durably recorded. Rejects if it could not be. An adapter that answers before the run ends awaits this. |
| `finished` | Resolves with the result when the run ends, however it ends. Await it only for a transport that answers with the result. |
| `responseEmitter`, `liveStream` | The run's output. `liveStream` is `null` when the envelope sets `responseEmitter: null`, as `partner` does, or when the host runs requests on an external job queue. Leave `responseEmitter` out and the host makes one. |

The envelope an adapter sets:

| Field | Meaning |
| --- | --- |
| `source`, `flowKind`, `action`, `input`, `principal` | Required. `flowKind` is the instance id, passed through unchanged. |
| `sessionId?`, `requestId?`, `tenantId?`, `metadata?` | Optional. |
| `rawBody?` | The raw bytes, for a resolver that verifies a signature. |
| `responseEmitter?` | `null` for fire-and-forget. |
| `signal?` | An abort signal. |

A concurrency policy of `reject` surfaces as `ConcurrencyRejectedError` (status `409`, `key`, `inFlightRequestId`), thrown from `dispatch` or rejecting `accepted`. A fire-and-forget adapter should answer it as a skip, the way the webhook route does. An adapter writes no concurrency code; it only answers the error. See [Concurrency policies](./concurrency.md).

To let the `partner` source use the public `retry`, `continue` and `resume` routes, pass `publicReentrySources: ["partner"]` to `createFlowApiRouter` or `createFlowState`.

`createInboundTransportConformanceTests({ name, factory, helpers: { buildEnvelope, teardown? } })` and `createMockTransportHost({ resolvePrincipal? })` come from `@flow-state-dev/testing/conformance`. The suite checks that `source` is non-empty, `createBindings` returns an object, the envelope carries the adapter's `source` and the resolved principal's `userId`, and teardown completes. The mock host records `dispatchCalls` and `principalCalls`.

## Next

- [HTTP API](./http-api.md): the built-in routes beside this one.
- [Authentication and tenancy](./authentication.md): the resolver a delivery's caller comes from.
- [Concurrency policies](./concurrency.md): what `reject` does to a redelivery.
- [Schedules](./schedules.md): the transport that calls a flow on a clock.
