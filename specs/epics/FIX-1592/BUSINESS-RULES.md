# FIX-1592 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who
owns it and where it's checked. Numbers restart with the re-scope. The first version's ER-n are
in [#2265](https://github.com/fixpoint-labs/flow-state-dev/pull/2265), superseded as a set
([EVOLUTION.md](EVOLUTION.md)); none carries over by number. ER-20 was added when FIX-1589
joined, at the end, so the numbers FIX-1585's spec cites hold.

## What a person gets

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A message to an agent seat is kept on the seat's run. The message and the reply both sit in that seat's conversation and survive a reload | FIX-1585 | FIX-1585's browser check |
| ER-2 | A post with no seat author runs each member **agent** seat of that channel once, through an internal receiver the agent kind declares. `desk-clerk` and `followup-runner` members are not run | FIX-1590 | FIX-1590's browser check |
| ER-3 | A post whose author is a seat wakes no seat ([D2](DECISIONS.md#d2)) | FIX-1590 decides · FIX-1594 consumes | FIX-1590's package test · FIX-1594's browser check |
| ER-4 | An agent seat posts only to a channel it belongs to, through that channel's own `post`. The line's author is the seat's id, set on the server, never by the model or a caller | FIX-1594 | FIX-1594's spec review · its browser check |
| ER-5 | A seat's line shows in the channel panel under the seat's name, read from the posts as FIX-1585 D1 leaves them, and survives a reload | FIX-1594 | FIX-1594's browser check |
| ER-6 | One kind→action map, FIX-1585 D3's. Any per-kind lookup the wake needs is a column in it | FIX-1585 decides · FIX-1590 consumes | FIX-1590's spec review · FIX-1585's drift test |
| ER-7 | One scripted model. FIX-1585 maps the agent kind's generator in kitchen-sink's test resolver, FIX-1589 its clerk generator; each child adds its own scenario to `apps/kitchen-sink/lib/e2e-mock-script.ts` ([D3](DECISIONS.md#d3)) | FIX-1585 decides · FIX-1589, FIX-1590, FIX-1594 consume | Each child's browser check, run keyless |
| ER-20 | A note to a `desk-clerk` seat gets a reply a model wrote, never the note handed back. The clerk may instead file the note onto `followups` or `escalations` through the channel's own `fileTask`; the row shows on that board | FIX-1589 | FIX-1589's browser check · its spec review |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-8 | Change `packages/workforce` only where a path needs it. No Workforce concept in core, engine, client or react; no new Layer 1 channel, notify or dispatch piece | The owner's layer rule. Replaces the first version's "one package line" fence ([D1](DECISIONS.md#d1)) |
| ER-9 | No kitchen-sink-only route or messaging API. Every browser verb calls an action a flow declares | A reference app with a private API teaches the private API |
| ER-10 | No second kind→action map and no invented Dispatcher | Architect fence |
| ER-11 | No edit to `packages/workforce/src/agent-worker-flow.ts` until FIX-1459 lands | Another thread is implementing FIX-1459 there. Two children edit it: FIX-1585 adds the kept message to the agent kind's `run` (ER-1), FIX-1590 adds the internal receiver (ER-2). Wired in Linear as FIX-1459 blocks both |
| ER-12 | A seat's reply in a channel is a peer post. Not an assistant item on the channel's session, not a channel-side responder | Architect fence. A channel is a log of posts |
| ER-13 | Nothing from the neighbours: no board UI, no drain of either board, no person as a drain seat, and no change to who attends `escalations` or to its boot warning (FIX-1591, held); no Assistant tool that posts or asks; no channel admin (FIX-1415); no verified identity (FIX-1493). FIX-1589 filing a row through `fileTask` is allowed; everything past the row is FIX-1591's | Not doing. Each is its own decision |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | Implementation runs 1585 → 1589 → 1590 → 1594 → 1602: FIX-1589's starts when FIX-1585's merges, FIX-1590's when FIX-1589's does, FIX-1594's when FIX-1590's does, FIX-1602's when FIX-1590's and FIX-1594's do. This is blocked-by, wired in Linear; "soft-after" in the Linear Manager's stamp means the same thing here. Each child's spec may be written earlier, so a cross-spec review sees them together. FIX-1591 is held and on no chain | D1. A spec merge is not a start signal for the next implementation. Blocked-by holds implementation only, never spec work (AGENTS.md) |
| ER-15 | A child that finds it needs a core or engine change, or a live key to pass its browser check, stops and comments up on this epic. FIX-1589 included: a clerk that can't be scripted is the Kill line, not a reason to go live | The Kill line. Deciding it locally hides the one fact that ends the epic |
| ER-16 | FIX-1585's spec (#2258) folds ER-1 before its approval. This amendment is its authority to widen | The owner's re-scope moves "keep the message" into FIX-1585's proof |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-17 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met, on a production build, keyless, all four checks run on one `main` commit: a message to `support.otto` and its reply survive a reload; a note to `support.ada` gets a model's reply, not the note; one post to `support.desk` runs `support.iris` and `support.otto` once each; a member agent's reply shows in `support.desk` under its name, survives a reload, and runs no seat. The post runs through Workforce's stock fan-out, with kitchen-sink moved onto it (FIX-1602). Each check's named control has been seen to FAIL | FIX-1601's QA plan ([#2288](https://github.com/fixpoint-labs/flow-state-dev/pull/2288)), per [the closure issue](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa) |
| ER-18 | The workforce-shell checks and the `a-channel-holds-the-work-a-seat-drains` goal stay green. Leg V14, nobody told about their own post, is untouched | Each child's PR · CI |
| ER-19 | Kitchen-sink's README tells a reader the three ways of talking | [DOCS.md](DOCS.md) · FIX-1594 publishes last |
