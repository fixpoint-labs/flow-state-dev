# FIX-1639 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Two calls. The epic already made the big ones (one page, a new page rather than a nav entry,
only shipped doors in the event row); this spec inherits them and doesn't reopen them. D1 is
what the page tells a queue-host builder, corrected by running it. D2 is where the page lives
and what shape it takes.

## The tree

```mermaid
flowchart TD
  I["FIX-1639"] --> D1["D1 · a reply is refused from a process that enqueues · in process on a worker-only worker · steer to key plus shared data"]
  D1 -.->|"rejected · a colocated reply is refused"| X1["the epic draft's two rows and run dispatch in process for that flow"]
  I --> D2["D2 · one page · top-level guide above Webhooks"]
  D2 -.->|"rejected · webhooks and schedules start work"| X2["first item under Background work"]
  D2 -.->|"rejected · a second page to keep true"| X2b["the table as its own page"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · On a queue-backed host, the page says a reply is refused when the run sending it is on a process that enqueues, goes in process on a `worker-only` worker, and steers hand-offs to a key plus data both sides read

| | |
|---|---|
| **Instead of** | The epic's draft: a two-row table (`{ key }` works, `{ id }` refused) and *"run dispatch in process for that flow, or design the hand-off so the receiving side starts from a key"*, which the epic asked this issue to confirm before publishing |
| **Because** | Confirming it found two gaps. A `{ from: true }` reply is a delivery into an existing session. It is refused `external-dispatcher` when the process running the queued run has an external dispatcher (a `colocated` worker, or a custom dispatcher without `dispatchLocal`; [poc F3](poc/page-facts/README.md)), and goes in process, unretried, from a `worker-only` worker, which installs none (F5). So a builder following the draft on a colocated host would start work with a key and then fail reporting back. And there is no per-flow way to "run dispatch in process": the queue is set on the whole host. What works on every host is a `{ key }` hand-off whose result lands in state both sides read (a user- or org-scoped resource, a board), which the conversation reads, or which the builder's app lists with the client SDK's `listChildSessions`. Goal 4 says state a limitation plainly; stated one row short, or wider than the runtime, it isn't |
| **Locks in** | The page publicly names three session choices and says where two are refused. Builders on a colocated BullMQ host will design hand-offs as fire-and-collect rather than call-and-reply until FIX-1634 ships; when it does, its own docs work rewrites the page's fence rows (epic ER-14), with [FIX-1656](https://linear.app/fixpoint-labs/issue/FIX-1656) as the backstop when FIX-1635 closes. The reference refusal table gets the same wording (one row) so the two pages agree |

![D1, what a queue-host builder is told to do instead: a reply refused from a process that enqueues and in process on a worker-only worker, and a key plus shared data, chosen, beside the epic draft's two rows and run in process for that flow. Decides it: a builder who plans to report back by reply, who is warned up front instead of failing on the queue host. Price: the page names a wider limitation. Locks in fire-and-collect hand-offs on queue hosts until FIX-1634. Flips if a reply were not a delivery into an existing session](figures/d1-reply-refused.svg)

It comes down to the reply: under the draft, a builder's report-back from a colocated worker fails on the very host it warns about.

**What would change my mind:** a reply taking a different path from `{ id }` in the same
process. F3 and F5 say it doesn't: both follow the process the sending run is in. The closure
re-checks it on a real Redis.

<a name="d2"></a>
## D2 · One page, a top-level guide above *Webhooks*; the table and the terms are sections of it

| | |
|---|---|
| **Instead of** | The epic draft's placement, first item under *Background work* · the table as its own linkable page, which D1 of the epic allowed |
| **Because** | The page starts with webhooks and schedules, which *start* work rather than outlive it; the epic's own D2 used that argument to keep them out of *Work that outlives the turn*, and filing the page under *Background work* would undo it. Above *Webhooks* it sits over the three sections it links. One page is one URL to share, one place for the closure to start from, and one place to keep true; the table reads against the steps above it, and a linkable anchor (`#where-each-setting-lives`) gives it an address without a second page |
| **Locks in** | A new top-level entry in the guides nav, and a page of about 1,500 words. If the table later needs a life of its own (FIX-453's architecture work, say), splitting it out is a move plus a redirect |

![D2, where the page lives: one top-level guide above Webhooks, chosen, beside first item under Background work. Decides it: webhooks and schedules start work rather than outlive it. Price: one more top-level guides entry. Locks in one URL and a long page; flips if the guides nav moves to categories only](figures/d2-one-page-top-level.svg)

It comes down to what the page opens with: filed under *Background work*, webhooks and schedules sit where they don't belong.

## Decided, not asked

- **One `billing` flow in every example**, the flow the webhook and schedule reference pages
  use, so a reader who clicks through meets the same names.
- **A verified caller in every sample** (PR-1): a webhook verifier on the host, a bearer secret
  for the scheduler. Body `userId` appears once, as the named local-development default.
- **"Later" is a stored schedule** (`schedules.resolve`); no delay on a dispatch (ER-11).
- **`worker-only` is described, not recommended**: its runs aren't durable.
- **No wake-exploration example is linked**: none is merged, and the owner parked them.
- **`epic-wake` gets one line in `docs/contributing/orchestration.md`**, never `apps/docs`.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Publish the epic's draft unchanged | It passes the names check and fails the fence: the reply row is missing |
| Offer a `worker-only` process as the way into an existing session | True, and a trap: no retries, and the web tier must run `dispatch-only` |
| Re-teach each reference page on this one | ER-9: they are right; the page gives the smallest working code and links |

## Settled

- **A `{ from: true }` reply is refused `external-dispatcher` when the process running the
  queued run has an external dispatcher, like `{ id }`** — **CONFIRMED** on the shipped
  runtime, with an in-process control that delivers it. [poc/page-facts F3](poc/page-facts/README.md).
- **The same reply from a `worker-only` worker goes in process and is not refused** —
  **CONFIRMED**, F5: the same queued job, consumed by a second runtime with no dispatcher.
  Raised in Codex review of #2403; the epic's ER-4 (#2394) carries the same condition.
- **A webhook whose `sessionId` names an existing session still runs on a queue host** —
  **CONFIRMED**, F4. The refusal is a flow-to-flow delivery rule, not a transport one.
- **A webhook or schedule route names the flow by its id, never its key in `flows`** —
  **CONFIRMED** on the runtime for both shapes of id. A singleton's id is its `kind`: a
  `kind: "billing"` flow registered as `payments` answers at `/api/flows/billing/…` and 404s at
  `/api/flows/payments/…`. A collection member's id is its instance id: `tenant-billing`
  registered as `acme` with id `acme-billing` answers at `/api/flows/acme-billing/…` and 404s at
  both `/api/flows/tenant-billing/…` and `/api/flows/acme/…`. Codex review of #2410 caught the
  first wording, which said `kind`. `names.mts` re-proves it each run.
- **Every name the draft uses resolves on `main`, and every code fence compiles** —
  **CONFIRMED**, with a control each that fails on what it plants.
  [poc/page-facts](poc/page-facts/README.md).

## How it got here

- **Draft** — framed as the epic's whole path on one page (D1 fold); reconciled the epic's
  `DOCS.md` against `main` with two checkers, which confirmed every name and found the reply
  row the draft lacked; placed the page above *Webhooks*; one docs PR.
- **Merged** — the owner merged #2403 at `0561e79` before the restraint pass and the Codex
  round below had landed; both arrive as this post-merge amendment.
- **Restraint pass (coordinator, 2026-09-29)** — S7 dropped (the closure proves the page), D2
  figure cut to its two required rows, restating rules and rows trimmed.
- **Amendment** — Codex review of #2403: D1 narrowed to the process that runs the reply (F5);
  the samples fixed to compile (`actions`, an instantiated flow, an `orgId`, a typed key) and a
  compile check added; `onBackgroundWork` for serverless hosts; the architecture doc's
  `notification` row added to S3; V1 for S3/S4 made a targeted row check; the route segment
  proved to be the flow's id (a singleton's `kind`, a collection member's instance id). The
  fence rows describe today's behavior: FIX-1634 (under the hard-gates epic FIX-1635) owns
  rewriting them in its own docs work (epic ER-14), and
  [FIX-1656](https://linear.app/fixpoint-labs/issue/FIX-1656) is the backstop when FIX-1635
  closes.

**Open: none.**
