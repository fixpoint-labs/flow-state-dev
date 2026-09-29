# FIX-1637 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared narrative, drafted once. FIX-1639 reconciles it against `main` and publishes it
through the `docs-writer` and `docs-editor` pass; nothing here is published because this spec
merged. Names below were checked against exports on `main` at 466143f. The publisher re-checks
each before publishing.

## CREATE · `apps/docs/guides/keeping-a-flow-running.md`

Placement: the first item of the guides sidebar's *Background work* category, so the closure
run can reach it from the nav. Sections, in order: the opening, *Waking a flow from outside*
(webhooks, then schedules), *Work that keeps going*, *Into a new session or an existing one*,
*A channel or a board*, *Where each setting lives*, *Terms*. The drafts below are the shared
parts; FIX-1639's own spec drafts the rest.

### Opening

> Most flows run because someone typed something. This page is for the other kind: a flow that
> starts because something happened somewhere else, like a payment clearing, a clock reaching
> nine, or another flow finishing its part, and that keeps working after the request that
> started it has returned.
>
> Every piece here already ships and has its own reference page. This one puts them in the
> order you'll meet them and says which part goes in your flow, which goes on your host, and
> which you set up outside FSD.

### Into a new session or an existing one

> A `dispatcher()` block sends one unit of work to an entry your flow declares. Its `session`
> option decides where the work runs.
>
> | `session` | Runs in | On a host that hands work to a queue |
> |---|---|---|
> | `{ key: (input) => string }` | a session derived from the key, created on first use | Works |
> | `{ id: (input) => string }` | a session that already exists | Refused before anything starts |
>
> On a queue-backed host, such as one using `bullmqWorker`, a delivery into an existing session
> throws `DispatchRefusedError` with `refused: "external-dispatcher"`. Nothing is enqueued. A
> `{ key }` dispatch, a webhook delivery and a schedule tick all run normally there. The
> refusal applies only to a running flow sending work into a session that already exists.
>
> On a queue-backed host, a Workforce channel inherits the refusal: a client's post is written,
> but no member is woken, and posting into the channel from another flow is refused the same way.
>
> If your work has to reach a session that already exists, run dispatch in process for that
> flow, or design the hand-off so the receiving side starts from a key.

The last paragraph is a proposal. FIX-1639 confirms both routes work on `main` before
publishing it. If either doesn't, the paragraph says only what does, and the page says
plainly that there is no queue-host route yet (ER-4).

### Where each setting lives

> | You want | In the flow definition | On the host | In your infrastructure |
> |---|---|---|---|
> | **A webhook** to start a run | `webhooks.<provider>.on.<event>`, a `defineWebhookBinding` with `block`, `input`, and optionally `sessionId` and `when` | `createWebhookTransportAdapter({ providers })` in `adapters` on `createFlowState`, with each provider's `verify` and its signing secret | The provider pointed at `POST /api/flows/:flowKind/webhooks/:provider`; the secret in your environment |
> | **A schedule** to start a run | `schedules.static.<id>`, a `defineScheduleBinding` with `cron` and `block`; or `schedules.resolve` for schedules stored at runtime; `authentication.resolvePrincipal`, for example `createBearerSecretPrincipalResolver` | `createScheduledTransportAdapter()` in `adapters`; a schedule index when one tick fans out to many stored schedules | A scheduler that calls `POST /api/flows/:flowKind/schedules/:scheduleId/dispatch` on time: Vercel Cron, Cloud Scheduler, EventBridge, or BullMQ's repeatable jobs through `@flow-state-dev/bullmq/schedules` |
> | **Another flow** to start a run | On the sender, `dispatcher({ flowKind, action, session })`; on the receiver, `internal.actions.<action>` | Both flows registered on the same `createFlowState` | Nothing |
> | **Another system** (a queue, an event bus) to start a run | The entry it should run | A custom inbound transport adapter in `adapters` | Whatever delivers to your adapter |
> | **Work to continue** after the request returns | `dispatcher()` into `internal.actions`, or `.sideChain()` in a sequencer | `worker: bullmqWorker({ connection })` for queue-backed runs, and its mode | Redis, and a worker process when the web tier runs `dispatch-only` |
>
> Your infrastructure decides *when* something fires. FSD decides what runs once it does. The
> scheduler and deployment guides cover the infrastructure column for each platform.
>
> Every row assumes a verified caller: the provider's signature for a webhook, a shared secret
> for your scheduler, your own authentication for everything else. A user id read from the
> request body is for local development only; see [Authentication](/docs/server/authentication).

The last paragraph carries project rule PR-1 ([BUSINESS-RULES.md](BUSINESS-RULES.md#inherited-from-the-project)).
FIX-1639 names the local-development escape as the Authentication page names it, and teaches
no example that relies on it.

### Terms

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
> and show that a running request is still going. It never starts a run. See [Connection resilience](/docs/server/connection-resilience).

### A channel or a board

> A Workforce **channel** holds a conversation: posts, in order, that its members can be woken
> by. A **board** holds work: rows that a worker claims, runs and settles. A channel can hold
> boards. Use the channel for what people and agents say, and the board for what has to get
> done. See [Channels](/docs/workforce/channels) and [Task board](/docs/orchestration/task-board).

## UPDATE · `apps/docs/docs/advanced/inbound-transports.md` · *Known sources*

Remove the `notification` row, and `notification` from the list of known values above it.
It names cross-flow event subscribers, which don't ship (D3). Drift fix only.

## UPDATE · link lines, nothing else

- `apps/docs/guides/background-work.md` · *Nearby, and often confused* — one line: waking a
  flow from outside, and where each setting lives, are on *Keeping a flow running*.
- `apps/docs/docs/server/webhooks.md` · *Guides* and `apps/docs/docs/server/scheduled.md` ·
  after *What v1 doesn't do* — one link each to the new page.

## UPDATE · `docs/contributing/orchestration.md` · *The pieces at a glance*, the `epic-wake` bullet

Contributor docs, not published. Append one sentence:

> Not the product's *wake*: published docs use that word for a webhook or schedule tick
> starting a flow, and `epic-wake` never appears there.

## Unchanged, deliberately

*Dispatched work*'s refusal table and the channels page's *Where posting from another flow
works* already state the fence correctly and stay as they are. No per-cloud page is written.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The page, its opening, the fence, the table, the terms, the channel-or-board section | FIX-1639 | This document, then FIX-1639's `DOCS.md` |
| The table, as its own page, if D1 re-splits | FIX-1638 | Its own `DOCS.md`, reusing the table above |
| The terms and the contributor line, if D1 re-splits | FIX-1640 | Its own `DOCS.md`, reusing the terms above |
| Drift fix and link lines | FIX-1639 | This document |
| The fence sentence, once `{ id }` works on a queue | FIX-1634 | Its own docs work |
