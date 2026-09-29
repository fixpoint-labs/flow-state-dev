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
| BR-2 | Copies the webhook and schedule samples | Gets code that compiles against `main`, a host that answers the webhook `202` and the schedule dispatch `202` with the secret, and no name the page didn't give | V1 · the closure |
| BR-3 | Hands work off from a run | Is shown `dispatcher()` into `internal.actions`, told it returns before the work finishes, and told `.sideChain()` is not this: the request stays open until it settles. On a serverless host that freezes after the response, is told to pass `onBackgroundWork` | V1 |
| BR-4 | Wants something done *later* | Is told there is no delay on a dispatch, and that a stored schedule (`schedules.resolve`) is the way (ER-11) | V1 |
| BR-5 | Reads the table | Every cell names a shipped export, a config key or "your infrastructure", across webhook, schedule, another flow, another system and work that continues (ER-2) | V1 |
| BR-6 | Reads the event rows | Sees `dispatcher({ flowKind, … })` into `internal.actions` for another flow and a custom inbound adapter for another system. No topic bus, no `.notify`, no `NotificationFlow` (ER-5, epic D3) | V1 |
| BR-7 | Meets *wake*, *dispatch*, *schedule tick* | Finds each defined once, in words the linked reference pages agree with, and *heartbeat* marked as a different thing (ER-3) | review |

## On a queue-backed host

| # | When a builder on a host whose dispatcher hands work to an external queue… | Then the page says | Proved by |
|---|---|---|---|
| BR-8 | Dispatches with `{ key }` | It runs | V2 · F1 |
| BR-9 | Delivers with `{ id }` | Refused before anything starts: `DispatchRefusedError`, `refused: "external-dispatcher"`, nothing enqueued (ER-4) | V2 · F2 |
| BR-10 | Replies with `{ from: true }` from a dispatched run | Refused the same way when the process running that run has an external dispatcher (a `colocated` worker, or a custom dispatcher without `dispatchLocal`); from a `worker-only` worker it goes in process, unretried ([D1](DECISIONS.md#d1)) | V2 · F3 · F5 |
| BR-11 | Takes a webhook whose `sessionId` names an existing session, or a schedule tick | Runs normally: the refusal is a flow-to-flow rule | V2 · F4 |
| BR-12 | Runs a `worker-only` process | That process isn't refused, because it installs no dispatcher, and its runs aren't durable. Stated, not recommended | review |
| BR-13 | Uses a Workforce channel | A client's post is written but wakes nobody, and a post from another flow is refused | review, against *Channels* |
| BR-14 | Needs a hand-off's result back in the conversation | Is told a reply works from a `worker-only` worker, unretried, and is refused on a `colocated` one; and steered to a `{ key }` hand-off writing to state both sides read, which works on every host, read from the conversation or listed by the app with the client SDK's `listChildSessions`; or to a host with no queue worker, whose runs aren't retried. No workaround noun | V1 · review |

The fence paragraph, the table's third column and the reference refusal row all say the same
thing, in the same words where they overlap. They describe today's behavior. When FIX-1634
(under the hard-gates epic FIX-1635) ships, its own docs work rewrites or removes all three
(epic ER-14). [FIX-1656](https://linear.app/fixpoint-labs/issue/FIX-1656) is the backstop: when
FIX-1635 closes, it confirms the three match shipped behavior, rewrites any FIX-1634 missed, and
re-reads FIX-1642's claims.

## What the page never teaches

| # | The page never | Because |
|---|---|---|
| BR-18 | Teaches body `userId` except as the named local-development default | Project rule PR-1: every host-mount sample shows a verified caller |

ER-6–9 bind as written; the edits outside the page are PLAN S3–S6.

## Failure taxonomy

A page that is wrong fails quietly, which is why every rule here has a check. A name that
doesn't resolve is fatal to the page: it blocks the merge (V1). A fence sentence that
disagrees with the runtime is fatal the same way (V2), and so is a code fence that doesn't
compile (V1). A missing link is a review finding, not a blocker. Nothing retries; V0, V1 and V2
run once, on the final page, in the implementation PR.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): every name on the published page
resolves and every code fence compiles, each with a control that fails on what it plants; the
fence matches the runtime (F1–F5); and the docs build. The page followed as written is the
closure's (FIX-1642). ER-16 is discharged in [SPEC.md](SPEC.md): the
kill line doesn't fire.
