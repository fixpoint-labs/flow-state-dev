# FIX-1639 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The page, drafted in full, plus four small edits elsewhere. It reconciles the epic's shared
draft ([`specs/epics/FIX-1637/DOCS.md`](../../epics/FIX-1637/DOCS.md)) rather than copying it:
the sections the epic drafted are corrected here, and the ones it left to this issue are
written. After this spec merges, this file is the one draft; the epic's copy is history.

Every name in the quoted prose and code was checked against `main` at `c63ee231c` by
[`poc/page-facts/names.mts`](poc/page-facts/README.md). The fence paragraph was run against the
shipped runtime by [`poc/page-facts/fence.mts`](poc/page-facts/README.md). The implementer
re-runs both before publishing ([PLAN V1, V2](PLAN.md#checks)).

## CREATE · `apps/docs/guides/keeping-a-flow-running.md`

Placement: a top-level item of `guidesSidebar` in `apps/docs/sidebarsGuides.ts`, directly
above the *Webhooks* category, so *Webhooks*, *Background work* and *Scheduled actions* below
it read as its detail ([D2](DECISIONS.md#d2)).
Frontmatter: `title: Keeping a flow running`, `sidebar_label: Keeping a flow running`.

> ---
> title: Keeping a flow running
> sidebar_label: Keeping a flow running
> description: "How a flow starts without a person typing, and keeps working after the request that started it returns: webhooks, schedules, hand-offs, and what a queue-backed host refuses."
> ---
>
> # Keeping a flow running
>
> Most flows run because someone typed something. This page is for the other kind: a flow that
> starts because something happened somewhere else, like a payment clearing, a clock reaching
> nine, or another flow finishing its part, and that keeps working after the request that
> started it has returned.
>
> Every piece here already ships and has its own reference page. This one puts them in the
> order you'll meet them, says which part goes in your flow, which goes on your host, and which
> you set up outside FSD, and says plainly what doesn't work yet on a queue-backed host.
>
> ## Waking a flow from outside
>
> A flow can't start itself. Something outside it has to call your server, and your host turns
> that call into a run. Two kinds of caller ship: a service that sends webhooks, and a
> scheduler that fires on a clock.
>
> ### A webhook
>
> The flow says which event runs which block. The host says how to check that the event is
> real. Secrets stay on the host.
>
> ```ts title="flows/billing.ts"
> import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
>
> export const billing = defineFlow({
>   kind: "billing",
>   authentication: { defaultUserId: "system", requireUser: false },
>   webhooks: {
>     stripe: {
>       on: {
>         "invoice.paid": defineWebhookBinding<StripeEvent>({
>           block: recordPayment,
>           input: (e) => ({ invoiceId: e.payload.data.object.id }),
>           sessionId: (e) => `customer-${e.payload.data.object.customer}`,
>         }),
>       },
>     },
>   },
> });
> ```
>
> ```ts title="lib/flowstate.ts"
> import {
>   createFlowState,
>   createWebhookTransportAdapter,
>   stripeWebhookVerifier,
> } from "@flow-state-dev/engine";
>
> export const flowstate = createFlowState({
>   flows: { billing },
>   stores: { /* ... */ },
>   adapters: [
>     createWebhookTransportAdapter({
>       providers: {
>         stripe: {
>           verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!),
>           eventType: (payload) => (payload as StripeEvent).type,
>         },
>       },
>     }),
>   ],
> });
> ```
>
> Point Stripe at `POST /api/flows/billing/webhooks/stripe`. A delivery with a bad signature is
> refused before any block runs. A good one gets a `202` straight away, and the run carries on
> after the response has gone, so a slow block never makes the provider retry.
>
> `sessionId` is optional. Leave it out and every event runs in a fresh session. Derive it from
> something stable in the payload, as above, and every event for that customer lands in the
> same session, so its state builds up. `when` narrows a coarse event type to the ones you want.
>
> Read next: [Webhook receivers](/docs/server/webhooks) for provider definitions, retries and
> idempotency, and the [Stripe](/guides/webhooks-stripe), [GitHub](/guides/webhooks-github) and
> [Slack](/guides/webhooks-slack-events) guides.
>
> ### A schedule
>
> FSD doesn't run a clock. A schedule is a named entry on the flow with a cron string, and
> your scheduler calls that entry's dispatch endpoint when the time comes. The call is
> checked like any other request, usually with a shared secret.
>
> ```ts title="flows/billing.ts"
> import {
>   defineFlow,
>   defineScheduleBinding,
> } from "@flow-state-dev/core";
> import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
>
> export const billing = defineFlow({
>   kind: "billing",
>   authentication: {
>     resolvePrincipal: createBearerSecretPrincipalResolver({
>       secret: process.env.FSDEV_SCHEDULER_SECRET!,
>       principal: { userId: "system" },
>     }),
>   },
>   schedules: {
>     static: {
>       "monthly-invoices": defineScheduleBinding({
>         cron: "0 0 1 * *",
>         block: generateMonthlyInvoices,
>       }),
>     },
>   },
> });
> ```
>
> On the host, add `createScheduledTransportAdapter()` from `@flow-state-dev/scheduled` to
> `adapters`. Then point your scheduler at
> `POST /api/flows/billing/schedules/monthly-invoices/dispatch` with
> `Authorization: Bearer <the same secret>`. The endpoint answers `202` and the run continues
> after it. If one flow takes both webhooks and schedules, branch on `ctx.source` inside one
> `resolvePrincipal` rather than replacing it.
>
> Schedules you create while the app runs, like a reminder a user sets, come from
> `schedules.resolve` instead of `schedules.static`. That is also how you do something later:
> store a schedule for the time you want, and the tick runs it. There is no delay option on a
> dispatch.
>
> Read next: [Scheduled actions](/docs/server/scheduled), then the guide for your scheduler:
> [Vercel Cron](/guides/scheduled-vercel-cron), [Cloud Scheduler](/guides/scheduled-cloud-scheduler),
> [EventBridge](/guides/scheduled-eventbridge), or BullMQ's own repeatable jobs in
> [Background jobs with BullMQ](/guides/background-jobs-bullmq). For stored schedules, see
> [Dynamic scheduled actions](/guides/scheduled-dynamic).
>
> ## Work that keeps going
>
> A webhook run and a scheduled run already outlive the call that started them. What's left is
> handing a piece of work off from inside a run, so it carries on in its own session while the
> run that started it finishes.
>
> That is a `dispatcher()` block. It sends one unit of work to an entry the flow declares under
> `internal.actions`, returns as soon as the work is accepted, and doesn't wait for it.
>
> ```ts
> import { dispatcher } from "@flow-state-dev/core";
> import { z } from "zod";
>
> const reconcileLater = dispatcher({
>   name: "reconcile-later",
>   action: "reconcile", // billing's internal.actions.reconcile
>   inputSchema: z.object({ invoiceId: z.string() }),
>   session: { key: (input) => input.invoiceId },
> });
> ```
>
> Add `flowKind` and the same block sends the work to another flow registered on the same
> server. That's how one flow wakes another.
>
> A `.sideChain()` looks similar and isn't. It runs beside the request, and the request stays
> open until it settles.
>
> To move the work off your web process entirely, give `createFlowState` a queue:
> `worker: bullmqWorker({ connection })` from `@flow-state-dev/bullmq`. Actions and dispatched
> runs then go through Redis to a worker, and a worker that dies mid-run retries the job.
>
> Read next: [Work that outlives the turn](/guides/background-work) compares side chains,
> queue-backed runs and dispatches side by side. [Dispatched work](/docs/server/background-work)
> has every option and refusal.
>
> ## Into a new session or an existing one
>
> A dispatcher's `session` option decides where the work runs.
>
> | `session` | Runs in | On a host that hands work to a queue |
> |---|---|---|
> | `{ key: (input) => string }` | a session derived from the key, created on first use | Works |
> | `{ id: (input) => string }` | a session that already exists | Refused before anything starts |
> | `{ from: true }` | the session that dispatched this run, as a reply | Refused before anything starts |
>
> On a host whose dispatcher hands work to an external queue, such as `bullmqWorker` in
> `colocated` or `dispatch-only` mode, a delivery into a session that already exists throws
> `DispatchRefusedError` with `refused: "external-dispatcher"`. Nothing is enqueued. The queue
> can't apply the receiving session's concurrency rules, so FSD refuses rather than deliver
> work it can't order.
>
> The refusal is narrow. A `{ key }` dispatch, a webhook delivery (with or without a
> `sessionId`) and a schedule tick all run normally on that host. The refusal follows the
> process the sending run is in: a `worker-only` process installs no dispatcher, so a run it
> executes dispatches in process and isn't refused, and also isn't durable.
>
> A Workforce channel inherits the refusal on such a host. A client's post is written, but no
> member is woken, and posting into the channel from another flow is refused the same way.
>
> If you're on a queue-backed host and need the result of a hand-off back in the conversation
> that started it, don't send it back. Start the work with a `{ key }`, have it write what it
> found somewhere both sides can read, such as a user- or org-scoped resource or a task board,
> and read it from the conversation. The conversation can also list the runs it started with
> `listChildSessions`. If the flow really has to deliver into an existing session, serve it from
> a host with no queue worker, and accept that its runs aren't retried.
>
> ## A channel or a board
>
> If you use Workforce, two of its shapes look alike and do different jobs. A **channel** holds
> a conversation: posts, in order, that its members can be woken by. A **board** holds work:
> rows a worker claims, runs and settles. A channel can hold boards. Use the channel for what
> people and agents say, and a board for what has to get done. Posting in a channel hands
> nobody the work; filing a row does.
>
> Read next: [Channels](/docs/workforce/channels), [Holding a board](/docs/workforce/channels#holding-a-board),
> and [Task board](/docs/orchestration/task-board).
>
> ## Where each setting lives
>
> | You want | In the flow definition | On the host | In your infrastructure |
> |---|---|---|---|
> | **A webhook** to start a run | `webhooks.<provider>.on.<event>`: a `defineWebhookBinding` with `block`, `input`, and optionally `sessionId` and `when` | `createWebhookTransportAdapter({ providers })` in `adapters`, with each provider's `verify` and signing secret | The provider pointed at `POST /api/flows/:flowKind/webhooks/:provider`; the secret in your environment |
> | **A schedule** to start a run | `schedules.static.<id>`: a `defineScheduleBinding` with `cron` and `block`; or `schedules.resolve` for schedules stored at runtime; `authentication.resolvePrincipal`, for example `createBearerSecretPrincipalResolver` | `createScheduledTransportAdapter()` in `adapters`; a schedule index when one tick fans out to many stored schedules | A scheduler that calls `POST /api/flows/:flowKind/schedules/:scheduleId/dispatch` on time, with the secret |
> | **Another flow** to start a run | On the sender, `dispatcher({ flowKind, action, session })`; on the receiver, `internal.actions.<action>` | Both flows registered on the same `createFlowState` | Nothing |
> | **Another system**, like a queue or an event bus, to start a run | The entry it should run | A custom inbound transport adapter in `adapters` | Whatever delivers to your adapter |
> | **Work to continue** after the request returns | `dispatcher()` into `internal.actions` | `worker: bullmqWorker({ connection })` for queue-backed runs, and its `mode` | Redis, and a worker process when the web tier runs `dispatch-only` |
>
> Your infrastructure decides *when* something fires. FSD decides what runs once it does. The
> [deployment guides](/guides/deployment) cover the infrastructure column per platform.
>
> Every row assumes a verified caller: the provider's signature for a webhook, a shared secret
> for your scheduler, your own authentication for everything else. With no resolver configured,
> FSD reads a `userId` from the request body. That is for local development only; see
> [Authentication](/docs/server/authentication#without-a-resolver).
>
> ## Terms
>
> **Wake.** Something outside the flow, a webhook delivery or a schedule tick, starts a run
> through your host.
>
> **Dispatch.** A flow sends one unit of work to an entry, to run in a session of its own or
> in one that already exists.
>
> **Schedule tick.** Your scheduler calling a schedule's dispatch endpoint. FSD doesn't run a
> clock; it answers the call.
>
> *Heartbeat* on these pages means something else: the signals that keep a live stream open
> and show that a running request is still going. It never starts a run. See
> [Connection resilience](/docs/server/connection-resilience).

## UPDATE · `apps/docs/sidebarsGuides.ts`

Insert `"keeping-a-flow-running"` as a top-level item directly before the `Webhooks` category.
No other sidebar change.

## UPDATE · `apps/docs/docs/advanced/inbound-transports.md` · *Known sources*

Reword the `notification` row; keep the value in the list above the table. The row says
cross-flow event subscribers, which don't ship ([epic D3](../../epics/FIX-1637/DECISIONS.md#d3)),
while core's `InboundSource` still lists the value and the DevTool labels it.

> | `notification` | No built-in transport sends it. A custom transport may use it, and the DevTool labels those requests *Notification* |

## UPDATE · `apps/docs/docs/server/background-work.md` · the refusal table, `external-dispatcher` row

Drift fix: the row names only an `id` delivery, and a `{ from: true }` reply is refused the
same way ([poc/page-facts](poc/page-facts/README.md), check F3).

> | `external-dispatcher` | A delivery into an existing session, by `id` or a `{ from: true }` reply, on a deployment that hands work to an external queue. A `key` dispatch is unaffected |

## UPDATE · link lines, nothing else

- `apps/docs/guides/background-work.md` · *Nearby, and often confused*: one paragraph at the
  end.

  > **Starting a flow from outside it** — a webhook, a schedule, another flow — and where each
  > setting lives are on [Keeping a flow running](/guides/keeping-a-flow-running).

- `apps/docs/docs/server/webhooks.md` · *Guides*, and `apps/docs/docs/server/scheduled.md` ·
  the host-side wiring list under *What v1 doesn't do*: one bullet each.

  > - [Keeping a flow running](/guides/keeping-a-flow-running) — webhooks, schedules and
  >   hand-offs on one page, with where each setting lives.

## UPDATE · `docs/contributing/orchestration.md` · *The pieces at a glance*, the `epic-wake` bullet

Contributor docs, not published. Append one sentence to the bullet:

> Not the product's *wake*: published docs use that word for a webhook or schedule tick
> starting a flow, and `epic-wake` never appears there.

## Unchanged, deliberately

- *Channels → Where posting from another flow works* already states the fence correctly.
- *Work that outlives the turn* stays the map for side chains, queues and dispatch; the new
  page links it and does not repeat its table.
- No per-cloud deployment page, no page for the table on its own, no glossary page.
- No example from the wake authoring explorations is linked: none is merged
  ([BR-17](BUSINESS-RULES.md#what-the-page-never-teaches)).

## Ownership

FIX-1639 publishes everything above. When a queue-backed host accepts `{ id }`, FIX-1634 owns
changing the fence paragraph, the table's third column and the refusal row.
