# FIX-1639 · Keeping a flow running: one guide page from an outside event to work that keeps going

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Docs only · `apps/docs` + one contributor line · small · 1 PR · epic
[FIX-1637](https://linear.app/fixpoint-labs/issue/FIX-1637) ([spec](../../epics/FIX-1637/SPEC.md),
[#2368](https://github.com/fixpoint-labs/flow-state-dev/pull/2368); D1 fold recorded in
[#2394](https://github.com/fixpoint-labs/flow-state-dev/pull/2394)) · blocks the closure
[FIX-1642](https://linear.app/fixpoint-labs/issue/FIX-1642)

## Five builders, before and after

| A builder who… | Today | After |
|---|---|---|
| **wants a flow to react to an outside service** | Finds *Webhook receivers*. Nothing joins it to schedules or to work that keeps going | One guide walks webhook, schedule, hand-off: the smallest working code for each, then a link |
| **wants a flow to run on a clock** | Reads six pages to learn which parts are theirs | One table: what goes in the flow, what goes on the host, what their scheduler calls |
| **runs on a queue-backed host (BullMQ)** | Meets the refusal as one table row naming only `id`, or as a channel that never answers | Reads before building: `{ key }` works, `{ id }` is refused by name, **so is a reply from a run on a process that enqueues** (a `worker-only` worker's reply goes in process), and what to do instead |
| **meets *wake*, *dispatch*, *tick*** | Sees the words everywhere, defined nowhere. *Heartbeat* here means a live stream's liveness | Each defined once, in a sentence |
| **uses Workforce channels and boards** | Reads an 800-line channels page to tell the conversation from the work list | One paragraph: a channel holds the talk, a board holds the work |

**The kill line doesn't fire.** Of the page's five steps, four are "here is how" with shipped
code. The fifth is mostly how too (`{ key }` works on every host); its "not yet" is one
paragraph about delivering into a session that already exists from a process that enqueues
([BR-8 to BR-14](BUSINESS-RULES.md#on-a-queue-backed-host)). A nav entry alone can't carry the table, the
fence or the terms (epic [D2](../../epics/FIX-1637/DECISIONS.md#d2)).

## The goal, and how we'll know it's met

**A builder who wants a flow to start from a webhook or a clock, and to hand work off past the
request that started it, can do it from one guide page: which shipped door to use, what goes in
the flow, on the host and in their own infrastructure, and what a queue-backed host refuses,
with every name on the page real.**

| Is it the right goal? | |
|---|---|
| **The real need** | The epic's: *"one coherent published path so builders know how a flow stays alive 24/7 without inventing product nouns"* ([FIX-1637](../../epics/FIX-1637/SPEC.md#the-goal-and-how-well-know-its-met)). After the D1 fold, this issue carries all of it |
| **Smaller, and rejected** | "Publish the epic's draft as written." It would teach a two-row session table and let a reader plan to report back with a reply, which is refused when the queued run is on a process that enqueues ([poc F3, F5](poc/page-facts/README.md)) |
| **Bigger, and not this issue's** | `{ id }` working on BullMQ (FIX-1634, under FIX-1635) · the QA run from the nav on a real Redis (the closure, FIX-1642) · per-cloud deploy how-tos |
| **Not done if** | A name on the page doesn't resolve on `main` · a code fence doesn't compile · the fence paragraph disagrees with the runtime · `epic-wake`, a Heartbeats noun or an issue number reaches `apps/docs` · a wake-POC shape is taught as a framework feature |

**No goal check: docs only.** Names and fence are proven by page-facts (V1 `names.mts` with
its false-option control and `compile.mts` with its unminted-flow control, V2 `fence.mts`
F1–F5 with the in-process control) plus the docs build (V4); the page is followed as written
by the closure FIX-1642.

## What changes

![What changes: one new guide page at the top of the webhooks, background work and schedules sections of the guides nav, in order webhook, schedule, work that keeps going, new session or existing, channel or board, where each setting lives, terms. It links, not rewrites, the eight reference pages and the scheduler guides. Five one-line edits: the notification source row in the guide and the architecture doc, the external-dispatcher refusal row, three link lines, and the epic-wake contributor line. Below a fence, not built: the id fix, a Heartbeats noun, new nouns, the wake-POC shapes, a per-cloud guide](figures/what-changes.svg)

One page in the nav, five one-line edits beside it, and everything below the fence left alone.

**What a builder on a queue host reads, against the epic's draft:**

```diff
  | `session` | Runs in | On a host that hands work to a queue |
  | `{ key: (input) => string }` | a session derived from the key | Works |
  | `{ id: (input) => string }` | a session that already exists | Refused before anything starts |
+ | `{ from: true }` | the session that dispatched this run, as a reply | Refused when the run is on a process that hands work to the queue |

- If your work has to reach a session that already exists, run dispatch in process for that
- flow, or design the hand-off so the receiving side starts from a key.
+ A reply works from a separate `worker-only` worker, unretried, and is refused on a
+ `colocated` one. What works on every host: start the work with a `{ key }`, have it write
+ what it found somewhere both sides can read, and read it from the conversation.
```

## What stays as it is

- **The refusal.** The page states it; FIX-1634, under the worker-queue epic FIX-1635, owns
  changing it, and [FIX-1656](https://linear.app/fixpoint-labs/issue/FIX-1656) tracks the
  page's rewrite when it lands.
- **The reference pages and guides** it links: linked, and fixed only where they disagree with
  `main` (three rows).
- ***Work that outlives the turn*** stays the map for side chains, queues and dispatch.
- **The wake explorations** (FIX-1641, 1643, 1644, 1645): parked; nothing from them is taught
  or linked.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** the whole epic path on one
page, with every name and sample checked against `main`, and the queue-host gap stated one
row wider than the epic drafted it, scoped to the process that runs the reply. If wrong: a page nobody can build from, or one that tells queue-host builders a
route that fails.

1. **[D1](DECISIONS.md#d1) · On a queue host, the page says a reply is refused when the run
   sending it is on a process that enqueues, goes in process on a `worker-only` worker, and
   steers hand-offs to a key plus data both sides read.** If wrong: builders on queue hosts plan
   around a limitation stated wider than it is, or narrower and hit it in production.
2. **[D2](DECISIONS.md#d2) · One page, a top-level guide above *Webhooks*; the table and the
   terms are its sections.** If wrong: a long page, or a guide filed where readers of
   webhooks and schedules don't look.

**Open: none.** D1 is the one to weigh. Reasoning: [DECISIONS.md](DECISIONS.md). Cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md). Order: [PLAN.md](PLAN.md). The page itself:
[DOCS.md](DOCS.md).
