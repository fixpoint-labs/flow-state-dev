# FIX-1637 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child's spec and published prose must satisfy, and the place a
cross-spec review checks. Owners are as D1 recommends; where a re-split would move one, the
column says so.

## What a builder gets, and what they don't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | One page, reachable from the docs site nav, carries the path in order: webhooks → schedules → outliving a turn → `{ id }` vs `{ key }` with the queue-host fence → channels vs boards | FIX-1639 | The closure run starts from the nav |
| ER-2 | A flow / host / ops table covers a webhook, a schedule, and an event from another flow or system. Every cell names a shipped export, a config key, or "your infrastructure" | FIX-1639 (FIX-1638 if D1 re-splits) | The closure's export check |
| ER-3 | *Wake*, *dispatch* and *schedule tick* are defined once, one sentence each, in words the linked reference pages agree with | FIX-1639 (FIX-1640 if D1 re-splits) | FIX-1639's review · the closure's gap sweep |
| ER-4 | The queue-host fence is stated plainly on the page: on a host that hands work to an external queue, `session: { id }` is refused with `external-dispatcher` before anything starts; `{ key }` and every transport dispatch run. It names what a builder can do instead, and invents no workaround noun | FIX-1639 | The closure, against the runtime on a BullMQ host |
| ER-5 | The event row names only doors that ship (D3) | FIX-1639 (FIX-1638 if re-split) | The closure's export check |

## Inherited from the project

| # | Rule | Owner here | Checked at |
|---|---|---|---|
| PR-1 | When host-mount docs are written, they teach a verified caller, and body `userId` appears only as the named escape for local development. Binds the flow / host / ops table's webhook, schedule and event rows. Project rule, owned at project altitude by FIX-1503: [project spec PR #2367](https://github.com/fixpoint-labs/flow-state-dev/pull/2367), [`BUSINESS-RULES.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/project/framework-simplification-and-cleanup/spec/_projects/framework-simplification-and-cleanup/BUSINESS-RULES.md) | FIX-1639, as owner of the table (FIX-1638 if D1 re-splits) | FIX-1639's review · the closure's gap sweep |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | Change runtime code or a public API, or soften or remove the `external-dispatcher` refusal in prose. An example's user-land helper (FIX-1641) is not a framework API and is never taught as one | Docs epic. The fix is FIX-1634's, under FIX-1635 |
| ER-7 | Mint a product noun: Heartbeats, a Paperclip clone page, a wake inbox, or Channel, Board, Agent, Team or Outbox as a Layer 1 concept | The PRD's invent-kills. Channels and boards are Workforce, taught as they ship |
| ER-8 | Put `epic-wake`, Conductor, DevForce, an internal issue number, or Relay vocabulary in `apps/docs` | The outsider rule. The one `epic-wake` line lives in `docs/contributing/` |
| ER-9 | Rewrite an existing reference page. Allowed: a drift fix where the page disagrees with `main`, and a link to the new page | Their substance is right; the path between them is what's missing |
| ER-10 | Write a per-cloud deploy how-to. The ops column says what fires the wake and links the existing guides | The objectives' non-goal |
| ER-11 | Teach live UI, multi-viewer fan-out, or send-later on `dispatcher()` | FIX-1506 and FIX-1622 are elsewhere. Deferred work is a schedule row claimed by a tick, through the same dispatch door |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-12 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear |
| ER-13 | FIX-1638 and FIX-1640 are not canceled or re-parented until the owner answers D1. A cross-cutting question goes to the epic, never decided in a child | D1 is the owner's call |
| ER-14 | FIX-1634 stays under FIX-1635. This epic files no Workforce adopt for it. When FIX-1634 ships, updating the page's fence sentence is FIX-1634's own docs work | A pointer, not a dependency |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-15 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: the page followed as written builds the fixture, every key resolves, the fence matches the runtime, and the planted false claim fails the run | FIX-1642 on one `main` commit |
| ER-16 | The kill line did not fire: the page is mostly "here is how", not "not yet" | FIX-1639's spec states which, before the page is written |
