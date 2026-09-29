# FIX-1639 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases the page must get right, as rules. A reader does something with the page; *then* is
what the page must have told them. *Proved by* names the check in [PLAN.md](PLAN.md#checks).
The epic's rules ([ER-n](../../epics/FIX-1637/BUSINESS-RULES.md)) bind too; each is cited where
this issue discharges it.

## What the page teaches

| # | When a reader… | Then the page | Proved by |
|---|---|---|---|
| BR-1 | Opens the guides nav | Finds *Keeping a flow running* as a top-level entry above *Webhooks*, and its steps in order: webhook, schedule, work that keeps going, new session or existing, channel or board (ER-1) | V4 |
| BR-2 | Copies the webhook and schedule samples into a fixture | Gets a host that answers the webhook `202` and the schedule dispatch `202` with the secret, `401` without it, with no name the page didn't give | VG |
| BR-3 | Hands work off from a run | Is shown `dispatcher()` into `internal.actions`, told it returns before the work finishes, and told `.sideChain()` is not this: the request stays open until it settles | VG · V1 |
| BR-4 | Wants something done *later* | Is told there is no delay on a dispatch, and that a stored schedule (`schedules.resolve`) is the way (ER-11) | V1 |
| BR-5 | Reads the table | Every cell names a shipped export, a config key or "your infrastructure", across webhook, schedule, another flow, another system and work that continues (ER-2) | V1 |
| BR-6 | Reads the event rows | Sees `dispatcher({ flowKind, … })` into `internal.actions` for another flow and a custom inbound adapter for another system. No topic bus, no `.notify`, no `NotificationFlow` (ER-5, epic D3) | V1 |
| BR-7 | Meets *wake*, *dispatch*, *schedule tick* | Finds each defined once, in words the linked reference pages agree with, and *heartbeat* marked as a different thing (ER-3) | review |

## On a queue-backed host

| # | When a builder on a host whose dispatcher hands work to an external queue… | Then the page says | Proved by |
|---|---|---|---|
| BR-8 | Dispatches with `{ key }` | It runs | V2 · F1 |
| BR-9 | Delivers with `{ id }` | Refused before anything starts: `DispatchRefusedError`, `refused: "external-dispatcher"`, nothing enqueued (ER-4) | V2 · F2 |
| BR-10 | Replies with `{ from: true }` from a dispatched run | Refused the same way ([D1](DECISIONS.md#d1)) | V2 · F3 |
| BR-11 | Takes a webhook whose `sessionId` names an existing session, or a schedule tick | Runs normally: the refusal is a flow-to-flow rule | V2 · F4 |
| BR-12 | Runs a `worker-only` process | That process isn't refused, because it installs no dispatcher, and its runs aren't durable. Stated, not recommended | review |
| BR-13 | Uses a Workforce channel | A client's post is written but wakes nobody, and a post from another flow is refused | review, against *Channels* |
| BR-14 | Needs a hand-off's result back in the conversation | Is steered to a `{ key }` hand-off writing to state both sides read, read from the conversation or found with `listChildSessions`; or to a host with no queue worker, whose runs aren't retried. No workaround noun | V1 · review |

The fence paragraph, the table's third column and the reference refusal row all say the same
thing, in the same words where they overlap. When FIX-1634 ships, it changes all three (ER-14).

## What the page never teaches

| # | The page never | Because |
|---|---|---|
| BR-15 | Names `epic-wake`, Conductor, DevForce, Relay vocabulary, or an issue or PR number | The outsider rule (ER-8). The one `epic-wake` line is in `docs/contributing/` |
| BR-16 | Mints Heartbeats, a wake inbox, or Channel, Board, Agent, Team or Outbox as a new concept | ER-7. Channels and boards are Workforce, taught as they ship |
| BR-17 | Teaches `route:`, `subscribe`, `wakes:`, a folder wake convention, or a trust lane, or links an unmerged example | The wake explorations are parked and not framework surface (ER-6) |
| BR-18 | Teaches body `userId` except as the named local-development default | Project rule PR-1: every host-mount sample shows a verified caller |
| BR-19 | Rewrites a reference page | ER-9. Two drift rows and three link lines are the only edits |

## Where the other pages change

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A reader opens *Inbound transports → Known sources* | The `notification` row says no built-in transport sends it and the DevTool labels it; the value stays listed | V1 · V5 |
| BR-21 | A reader opens *Dispatched work*'s refusal table | The `external-dispatcher` row names `id` and a `{ from: true }` reply | V5 |
| BR-22 | A reader of *Work that outlives the turn*, *Webhook receivers* or *Scheduled actions* | Finds one link to the new page, and nothing else changed | V5 |

## Failure taxonomy

A page that is wrong fails quietly, which is why every rule here has a check. A name that
doesn't resolve is fatal to the page: it blocks the merge (V1). A fence sentence that
disagrees with the runtime is fatal the same way (V2). A missing link is a review finding,
not a blocker. Nothing retries; the checks run on every edit of the page.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): the published page, followed as
written, builds a fixture woken by a webhook and a schedule whose hand-off finishes after the
request returns; every name resolves; the fence matches the runtime; and the same run fails
with one false option planted on the page. ER-16 is discharged in [SPEC.md](SPEC.md): the
kill line doesn't fire.
