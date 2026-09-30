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

Each piece here has its own reference page. This one puts them in the order you'll meet them,
says which part goes in your flow, which goes on your host, and which you set up outside FSD,
and says plainly what a queue-backed host refuses.

## Waking a flow from outside

A flow can't start itself. Something outside it has to call your server, and your host turns
that call into a run. Two kinds of caller ship: a service that sends webhooks, and a
scheduler that fires on a clock.

### A webhook

The flow says which event runs which block. The host says how to check that the event is
real. Secrets stay on the host.

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
id: for a single flow that's its `kind`, for a collection member its instance id, never its
key in `flows`. A delivery with a bad signature is refused before any block runs. A good one
gets a `202` straight away, and the run carries on after the response has gone, so a slow
block never makes the provider retry.

That holds on a server that stays up. A serverless host such as Vercel freezes the function
once the response is sent, so give `createFlowState` a keep-alive:
`onBackgroundWork: (p) => after(() => p)`, with `after` from `next/server`. The same option
keeps schedule ticks and hand-offs running there. See
[Deploying to Vercel](/guides/deploying-to-vercel#4-choose-a-persistence-store).

`sessionId` is optional. Leave it out and every event runs in a fresh session. Derive it from
something stable in the payload, as above, and every event for that customer lands in the
same session, so its state builds up. `when` narrows a coarse event type to the ones you want.

Read next: [Webhook receivers](/docs/server/webhooks) for provider definitions, retries and
idempotency, and the [Stripe](/guides/webhooks-stripe), [GitHub](/guides/webhooks-github) and
[Slack](/guides/webhooks-slack-events) guides.

### A schedule

FSD doesn't run a clock. A schedule is a named entry on the flow with a cron string, and
your scheduler calls that entry's dispatch endpoint when the time comes. The call is
checked like any other request, usually with a shared secret.

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
after it. If one flow takes both webhooks and schedules, branch on `ctx.source` inside one
`resolvePrincipal` rather than replacing it.

Schedules you create while the app runs, like a reminder a user sets, come from
`schedules.resolve` instead of `schedules.static`. That is also how you do something later:
store a schedule for the time you want, and the tick runs it. There is no delay option on a
dispatch.

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

| `session` | Runs in | On a host that hands work to a queue |
|---|---|---|
| `{ key: (input) => string }` | a session derived from the key, created on first use | Works |
| `{ id: (input) => string }` | a session that already exists | Refused before anything starts |
| `{ from: true }` | the session that dispatched this run, as a reply | Refused when the run sending it is on a process that hands work to the queue; in process from a `worker-only` worker |

On a host whose dispatcher hands work to an external queue, such as `bullmqWorker` in
`colocated` or `dispatch-only` mode, or a custom dispatcher without `dispatchLocal`, a
delivery into a session that already exists throws `DispatchRefusedError` with
`refused: "external-dispatcher"`. Nothing is enqueued. The queue can't apply the receiving
session's concurrency rules, so FSD refuses rather than deliver work it can't order.

The refusal is narrow. A `{ key }` dispatch, a webhook delivery (with or without a
`sessionId`) and a schedule tick all run normally on that host. The refusal follows the
process the sending run is in. A reply from a run on a `colocated` worker is refused. A
`worker-only` worker installs no dispatcher, so a reply from a run it executes goes in
process and isn't refused. It also isn't retried: it runs outside the queue.

A Workforce channel inherits the refusal on such a host. A client's post is written, but no
member is woken, and posting into the channel from another flow is refused the same way.

If you need a hand-off's result back in the conversation that started it, a reply works when
your queued runs execute on a separate `worker-only` worker, and isn't retried. On a
`colocated` worker it's refused. The route that works on every host, and keeps its retries,
is to start the work with a `{ key }`, have it write what it found somewhere both sides can
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
for your scheduler, your own authentication for everything else. With no resolver configured,
FSD reads a `userId` from the request body. That is for local development only; see
[Authentication](/docs/server/authentication#without-a-resolver).

## Terms

**Wake.** Something outside the flow, a webhook delivery or a schedule tick, starts a run
through your host.

**Dispatch.** A flow sends one unit of work to an entry, to run in a session of its own or
in one that already exists.

**Schedule tick.** Your scheduler calling a schedule's dispatch endpoint. FSD doesn't run a
clock; it answers the call.

*Heartbeat* on these pages means something else: the signals that keep a live stream open
and show that a running request is still going. It never starts a run. See
[Connection resilience](/docs/server/connection-resilience).
