---
title: Keeping a flow running
sidebar_label: Keeping a flow running
description: "How a flow starts without a person typing, and keeps working after the request that started it returns: webhooks, schedules, hand-offs, and what a queue-backed host refuses."
---

# Keeping a flow running

Most flows run because someone typed something. This page is for the other kind: a flow that
starts because something happened somewhere else, like a payment clearing, a clock reaching
nine, or another flow finishing its part, and that keeps working after the request that
started it has returned.

## Waking a flow from outside

A flow can't start itself. Something outside it has to call your server, and your host turns
that call into a run. That call is a *wake*, and it comes from a service sending a webhook or a
scheduler firing on a clock.

### A webhook

The flow says which event runs which block. The host says how to check that the event is
real, so the signing secret stays on the host.

```ts title="flows/billing.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";

export const billing = defineFlow({
  kind: "billing",
  actions: {},
  authentication: { defaultUserId: "system", requireUser: false },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding<StripeEvent>({
          block: recordPayment,
          input: (e) => ({ invoiceId: e.payload.data.object.id }),
          sessionId: (e) => `customer-${e.payload.data.object.customer}`,
        }),
      },
    },
  },
});
```

```ts title="lib/flowstate.ts"
import {
  createFlowState,
  createWebhookTransportAdapter,
  stripeWebhookVerifier,
} from "@flow-state-dev/engine";
import { billing } from "../flows/billing";

export const flowstate = createFlowState({
  flows: { billing: billing() },
  stores: { /* ... */ },
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

Point Stripe at `POST /api/flows/billing/webhooks/stripe`. The path names the flow by its
id: for a single flow that's its `kind`, for a
[collection member](/docs/fundamentals/flows#how-an-instance-is-addressed) (one of several
configured copies of the same flow) its instance id, never its key in `flows`. A delivery
with a bad signature is refused before any block runs. A good one gets a `202`
straight away, and the run carries on after the response has gone, so a slow block never
makes the provider retry.

That holds on a server that stays up. A serverless host such as Vercel freezes the function
once the response is sent, so give `createFlowState` a keep-alive:
`onBackgroundWork: (p) => after(() => p)`, with `after` from `next/server`. The same option
keeps schedule ticks and hand-offs running there. See
[Deploying to Vercel](/guides/deploying-to-vercel#4-choose-a-persistence-store).

`sessionId` is optional. Leave it out and every event runs in a fresh session. Derive it from
something stable in the payload, as above, and every event for that customer lands in the
same session, so its state builds up. `when` is an optional predicate on the event: return
`false` and that delivery runs nothing, which narrows a coarse event type to the ones you want.

The example's `authentication` is the standard one for a webhook. The provider's signature is
what authenticates a delivery, so the flow needs no resolver, and every event runs as the
`system` user. With no resolver, those runs belong to the reserved default organization,
`DEFAULT_ORG_ID`; an app that serves several organizations adds a `resolvePrincipal` that
returns one.

Read next: [Webhook receivers](/docs/server/webhooks) for provider definitions, retries and
idempotency, and the [Stripe](/guides/webhooks-stripe), [GitHub](/guides/webhooks-github) and
[Slack](/guides/webhooks-slack-events) guides.

### A schedule

FSD doesn't run a clock. A schedule is a named entry on the flow with a cron string, and
your scheduler calls that entry's dispatch endpoint when the time comes. The call is
checked like any other request, usually with a shared secret that the flow's
`authentication` compares against the request.

Below is the same `billing` flow, shown with its schedule. Its `authentication` uses a shared
bearer secret.

```ts title="flows/billing.ts"
import {
  defineFlow,
  defineScheduleBinding,
} from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";

export const billing = defineFlow({
  kind: "billing",
  actions: {},
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.FSDEV_SCHEDULER_SECRET!,
      principal: { userId: "system", orgId: "acme" },
    }),
  },
  schedules: {
    static: {
      "monthly-invoices": defineScheduleBinding({
        cron: "0 0 1 * *",
        block: generateMonthlyInvoices,
      }),
    },
  },
});
```

On the host, add `createScheduledTransportAdapter()` from `@flow-state-dev/scheduled` to
`adapters`. Then point your scheduler at
`POST /api/flows/billing/schedules/monthly-invoices/dispatch` with
`Authorization: Bearer <the same secret>`. The endpoint answers `202` and the run continues
after it.

A flow that takes both webhooks and schedules keeps one `resolvePrincipal` and branches on
`ctx.source`. The bearer resolver on its own refuses a webhook delivery with a `401`, because
the delivery carries no bearer header. So when `ctx.source` is `"webhook"`, return your system
principal: the adapter has already checked the provider's signature before the resolver runs.

Schedules you create while the app runs, like a reminder a user sets, come from
`schedules.resolve` instead of `schedules.static`. That is also how you do something later:
store a schedule for the time you want, and the tick runs it. `dispatcher()` has no delay
option.

Read next: [Scheduled actions](/docs/server/scheduled), then the guide for your scheduler:
[Vercel Cron](/guides/scheduled-vercel-cron), [Cloud Scheduler](/guides/scheduled-cloud-scheduler),
[EventBridge](/guides/scheduled-eventbridge), or BullMQ's own repeatable jobs in
[Background jobs with BullMQ](/guides/background-jobs-bullmq). For stored schedules, see
[Dynamic scheduled actions](/guides/scheduled-dynamic).

## Work that keeps going

A webhook run and a scheduled run outlive the call that started them. What's left is handing
a piece of work off from inside a run, so it carries on in its own session while the run that
started it finishes.

That is a `dispatcher()` block. It sends one unit of work to an entry the flow declares under
`internal.actions`, returns as soon as the work is accepted, and doesn't wait for it.

```ts
import { dispatcher } from "@flow-state-dev/core";
import { z } from "zod";

const reconcileLater = dispatcher({
  name: "reconcile-later",
  action: "reconcile", // billing's internal.actions.reconcile
  inputSchema: z.object({ invoiceId: z.string() }),
  session: { key: (input: { invoiceId: string }) => input.invoiceId },
});
```

Add `flowKind` and the same block sends the work to another flow registered on the same
server. That's how one flow wakes another.

A `.sideChain()` looks similar and isn't. It runs beside the request, and the request stays
open until it settles.

To move the work off your web process entirely, give `createFlowState` a queue:
`worker: bullmqWorker({ connection })` from `@flow-state-dev/bullmq`. Actions and dispatched
runs then go through Redis to a worker, and a worker that dies mid-run retries the job.

Read next: [Work that outlives the turn](/guides/background-work) compares side chains,
queue-backed runs and dispatches side by side. [Dispatched work](/docs/server/background-work)
has every option and refusal.

## Into a new session or an existing one

A dispatcher's `session` option decides where the work runs.

What's allowed depends on whether the process hands work to a queue. With `bullmqWorker`, its
`mode` sets that: `colocated`, the default, enqueues work and runs it in the same process;
`dispatch-only` enqueues and leaves the running to a separate worker; `worker-only` is that
separate worker, which runs queued jobs and enqueues nothing. See
[Separated workers](/guides/background-jobs-bullmq#4-separated-workers).

| `session` | Runs in | On a host that hands work to a queue |
|---|---|---|
| `{ key: (input) => string }` | a session derived from the key, created on first use | Works |
| `{ id: (input) => string }` | a session that already exists | Refused before anything starts |
| `{ from: true }` | the session that dispatched this run, as a reply | Refused from a process that hands work to the queue. From a `worker-only` worker it runs in process, without retries |

Refused means the dispatch throws `DispatchRefusedError` with `refused: "external-dispatcher"`
in `colocated` or `dispatch-only` mode, before anything is enqueued. A `{ key }` dispatch, a
webhook delivery (with or without a `sessionId`) and a schedule tick run normally there.

If you use Workforce, its channels are sessions that already exist, so the same rule reaches
them. A client's post into a channel succeeds and its line appears, but no member is woken
and nothing answers. A post into the channel from another flow is refused with
`external-dispatcher`. See [Channels](/docs/workforce/channels#where-posting-from-another-flow-works-and-where-it-doesnt).

To get a hand-off's result back into the conversation that started it on any host, with
retries, start the work with a `{ key }`, have it write what it found somewhere both sides can
read, such as a user- or org-scoped resource or a task board, and read it from the
conversation. Your app can also list the runs a session started with the client SDK's
`listChildSessions`. If the flow has to deliver into an existing session, serve it from a
host with no queue worker, and accept that its runs aren't retried.

## A channel or a board

If you use Workforce, two of its shapes look alike and do different jobs. A **channel** holds
a conversation: posts, in order, that its members can be woken by. A **board** holds work:
rows a worker claims, runs and settles. A channel can hold boards. Use the channel for what
people and agents say, and a board for what has to get done. Posting in a channel hands
nobody the work; filing a row does.

Read next: [Channels](/docs/workforce/channels), [Holding a board](/docs/workforce/channels#holding-a-board),
and [Task board](/docs/orchestration/task-board).

## Where each setting lives

| You want | In the flow definition | On the host | In your infrastructure |
|---|---|---|---|
| **A webhook** to start a run | `webhooks.<provider>.on.<event>`: a `defineWebhookBinding` with `block`, `input`, and optionally `sessionId` and `when` | `createWebhookTransportAdapter({ providers })` in `adapters`, with each provider's `verify` and signing secret | The provider pointed at `POST /api/flows/:flowKind/webhooks/:provider`; the secret in your environment |
| **A schedule** to start a run | `schedules.static.<id>`: a `defineScheduleBinding` with `cron` and `block`; or `schedules.resolve` for schedules stored at runtime; `authentication.resolvePrincipal`, for example `createBearerSecretPrincipalResolver` | `createScheduledTransportAdapter()` in `adapters`; a schedule index when one tick fans out to many stored schedules | A scheduler that calls `POST /api/flows/:flowKind/schedules/:scheduleId/dispatch` on time, with the secret |
| **Another flow** to start a run | On the sender, `dispatcher({ flowKind, action, session })`; on the receiver, `internal.actions.<action>` | Both flows registered on the same `createFlowState` | Nothing |
| **Another system**, like a queue or an event bus, to start a run | The entry it should run | A custom inbound transport adapter in `adapters` | Whatever delivers to your adapter |
| **Work to continue** after the request returns | `dispatcher()` into `internal.actions` | `worker: bullmqWorker({ connection })` for queue-backed runs, and its `mode` | Redis, and a worker process when the web tier runs `dispatch-only` |

Your infrastructure decides *when* something fires. FSD decides what runs once it does. The
[deployment guides](/guides/deployment) cover the infrastructure column per platform.

Every row assumes a verified caller: the provider's signature for a webhook, a shared secret
for your scheduler, your own authentication for everything else. An action call to a flow with
no resolver takes its `userId` from the request body, which is for local development only; see
[Authentication](/docs/server/authentication#without-a-resolver).

## Terms

**Wake.** Something outside the flow, a webhook delivery or a schedule tick, starts a run
through your host.

**Dispatch.** A flow sends one unit of work to an entry through a `dispatcher()` block, to run
in a session of its own or in one that already exists. A schedule's dispatch endpoint,
`POST /api/flows/:flowKind/schedules/:scheduleId/dispatch`, is a different thing: your
scheduler calling it is a wake.

**Schedule tick.** Your scheduler calling a schedule's dispatch endpoint. FSD doesn't run a
clock; it answers the call.

*Heartbeat*, on the pages linked here, means the signals that keep a live stream open while a
request runs. It never starts a run. See
[Connection resilience](/docs/server/connection-resilience).
