# FIX-2085 · Decisions

[Spec](SPEC.md) · **Decisions**

Three calls shape the outcome. The concept already decided that recurring work is a schedule that
files an ordinary task ([`workforce-coordination-concept.md`](../../../docs/internal/design/workforce-coordination-concept.md));
these carry it out.

## The tree

```mermaid
flowchart TD
  I["FIX-2085"] --> D1["D1 · a fire files the task itself, as Alice, on the named board"]
  D1 -.->|"rejected · a model turn decides what lands"| X1["the fire messages launch, whose model files"]
  I --> D2["D2 · one firing per time, every scheduled action, at the endpoint"]
  D2 -.->|"rejected · apps outside Workforce still double-fire"| X2["a task id made from schedule and time"]
  I --> D3["D3 · next run worked out from the cron at read"]
  D3 -.->|"rejected · empty on most hosts"| X3["read the host index's next time"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A fire files the task itself, as Alice, on the named worker's board; no model turn decides

| | |
|---|---|
| **Instead of** | The fire sends launch a message ("refresh the adoption numbers"), and launch's model files the task, or doesn't |
| **Because** | S-01 asks for recurring work that *arrives* as an ordinary task. A model turn in between is a second chance to file nothing, or something else, and the concept says a schedule files the task. Filing through the board's own filing, as Alice in her conversation with launch, means the task is launch's like any it filed: launch's delegates only (FIX-2081), the filing settings (FIX-2080), its ending to launch (FIX-2078). Tenet 2: no new kind of task |
| **Locks in** | The schedule row's public shape: `kind: "task"`, `input.filer` naming the worker whose board it lands on, and the rest of `input` as `createTask` takes it. A schedule can't skip or reshape a week's work; to change it, the schedule is edited |

![D1: a fire files the task itself, chosen, beside the fire messaging launch. Decides it: what Alice can count on each Monday, a task in her list before any model runs. Price: launch can't adapt the work week by week. Locks in the row's kind task and input filer; flips if users want the coordinator to judge each firing](figures/d1-files-the-task.svg)

It comes down to Monday morning: a message can file nothing, and a filing always lands.

**What would change my mind:** users asking for a coordinator that judges each firing ("skip it if
nothing changed"). Then a schedule files a held task the coordinator releases or cancels, still
through the same filing.

<a name="d2"></a>
## D2 · At most once per scheduled time, for every scheduled action, at the dispatch endpoint

| | |
|---|---|
| **Instead of** | A Workforce-only guarantee: the task's id made from the schedule and its time, so a second filing finds the first |
| **Because** | S-03 is a flow author's story: "a restart or a second host never files the same work twice", for any scheduled action. Every cron path, a host's own cron, a polling tick and BullMQ, meets at the dispatch endpoint, and the per-process cache there is what fails: each host and each restart has its own. One stored time per schedule, claimed with a compare-and-set in the host's store before any handler runs, holds across hosts and restarts. It is one record per schedule, not one per firing, so it never grows |
| **Locks in** | Every app using `scheduled` changes at upgrade. A fire for a time already fired, or earlier than one, is answered `200` with status `duplicate`, as today's duplicate is, so a host scheduler stops retrying it: a late retry of a missed time, or one delivered after the next time fired, never runs, and a manual POST runs only if the latest due time hasn't fired. `idempotencyWindowMs` and the body's `idempotencyKey` go. The guarantee needs a store with compare-and-set across processes, SQLite or Postgres. On the memory store, and on the filesystem store, whose lock is per store instance (`engine/src/stores/types.ts:1275-1280`), it holds per process only |

![D2: one firing per time at the endpoint, chosen, beside a task id made from schedule and time. Decides it: a flow outside Workforce, such as monthly invoices, also fires once on two hosts. Price: a late retry of a missed time is refused. Locks in two knobs removed; flips if no app runs scheduled actions outside Workforce on more than one host](figures/d2-once-at-the-endpoint.svg)

It comes down to apps outside Workforce: a task id protects only tasks, and invoices still go out twice.

**What would change my mind:** no app runs scheduled actions outside Workforce on more than one
process. Then the task id alone meets S-03, and `scheduled` is left as it is.

<a name="d3"></a>
## D3 · A schedule's next run is worked out from its cron and time zone when the list is read

| | |
|---|---|
| **Instead of** | Showing the next time the host's schedule index holds |
| **Because** | S-02 asks for the next run on Alice's list. An index is optional, and the BullMQ index keeps no times, so on most hosts that column is empty. A time stored on the row goes stale. The cron and zone are on every row |
| **Locks in** | The list says when the schedule is *due*, not when the host *will* fire it: on a host whose cron isn't running, it still shows a time |

![D3: next run from the cron at read, chosen, beside the host index's time. Decides it: whether the list shows a time on every host. Price: it shows a time even when the host's cron is down. Locks in due, not will fire; flips if every host kept an index with times](figures/d3-next-run-at-read.svg)

It comes down to hosts without an index: the index's time leaves the list empty there.

## Decided, not asked

- **The convergence point for "one firing per time" is the dispatch endpoint**, after the
  schedule resolves and passes its checks, before its handler runs. Every writer of a firing
  passes through it: the Vercel GET shim, the polling tick, BullMQ's dispatch worker and a host's
  own cron all POST there. No index or worker keeps a second check of its own; each index's
  claim stays only as the index's way of finding due rows.
- **A fire's time is a scheduled time, never one not yet due.** A fire carrying a time counts
  against that scheduled time, within a small tolerance so a clock a second early lands on it; a
  carried time that is no scheduled time is refused with 400. A fire carrying none counts against
  the latest time already due, never the next, so an early or manual POST can't claim a time
  that hasn't arrived and swallow its real fire.
- **A concurrency refusal gives its time back only if nothing later claimed it.** The time is
  claimed before the handler; when the engine then refuses the fire as in flight, the endpoint
  writes the previous time back, version-checked against its own claim. If a later time was
  claimed in between, that write fails and the refused time stays spent, which is what the
  earlier-is-refused rule would do to its retry anyway.
- **The record lives in the host's store,** beside the schedule's own data, and goes when the
  schedule goes; not in the index or a new store method. Store adapters change nothing; the
  filesystem store's limit is D2's.
- **A fire files even if last week's task is still open.** `onOverlap` covers the filing request,
  not the task. Each firing is its own task, as the concept says.
- **The row names a worker, never a session.** The fire resolves Alice's conversation with that
  worker on the server, as her own message would reach it (BP-031). A worker not on her roster, or
  an assignee not among its delegates, refuses the filing, and the fire is dropped like any failed
  filing. The write itself is not checked: a roster changes after a row is written.
- **A schedule whose assignee is its own `input.filer` is refused at fire,** dropped like any
  failed filing. A filing naming the worker itself is a step on its plan ledger (FIX-2076), which
  only that worker's own request drains, so a fired one would sit there unworked and its ending
  would owe launch no notice.
- **One filing path.** Before FIX-2081, the fire uses the start-now filing beneath
  `dispatchTask_tasks`'s goal form: filed ready, the board woken, as Alice. Not `addTask_tasks`'s,
  which records the row without starting it. Whichever of FIX-2081 and this issue lands second
  moves the fire onto `createTask`'s block, so removing `dispatchTask` never touches schedules. No
  filing code is this issue's own.
- **A body `idempotencyKey` is refused with 400 naming the change**, not ignored (BP-030), so a host
  relying on it learns at upgrade. The routes file's header comment is rewritten with it, which
  closes [FIX-1219](https://linear.app/fixpoint-labs/issue/FIX-1219).
- **The `scheduled` changeset carries the three migration rows.** All three removals,
  `idempotencyWindowMs`, the cache's `idempotencyOptions` test seam, and the body's `idempotencyKey`,
  have rows in the epic's [migration lines](../../epics/FIX-2056/migration.md)
  with this issue as owner. Under epic [(e)](../../epics/FIX-2056/DECISIONS.md#e) this PR's
  changeset carries those lines and says teams outside the repo rewrite at upgrade.
- **No POC and no checker.** The compare-and-set is the store contract's create-if-absent and
  version check (`engine/src/stores/types.ts:1294-1320`); nothing rests on a count.

## Considered and dropped

| Option | Why it lost |
|---|---|
| A schedule-owned board, its own filer | A second kind of filer; the ending would reach no worker, and S-01 says launch hears it |
| A durable record per firing | Grows by one row per fire, forever, for the same guarantee |
| Keep the cache and document the host's idempotency | Already the docs' answer. Vercel Cron and `node-cron` send no dedupe key, and a restart empties the cache |
| Both D2 and the task id | Two places to keep one guarantee in step (tenet 5) |

## How it got here

- **Draft** — framed as three stories meeting at two seams: the dispatch endpoint for "once",
  the board's filing for "an ordinary task"; builds on the scheduled transport and the task tools.
- **Review round 1** — D2's time rule tightened from "nearest scheduled time" to "a scheduled
  time already due", because an early or untimed POST could claim the next time and its real
  fire would then be refused; a concurrency refusal gives its time back only by a version check;
  the guarantee is scoped to stores with compare-and-set across processes.

## Notes from review

- "A short “authoritative guarantee lives only at the endpoint; index claim is discovery” paragraph here would simplify the implementer mental model (today `routes.ts` still dedupes in memory *after* auth but *before* resolve; D2 adds store I/O at that convergence point)." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3601#discussion_r4333168161))
- "A one-line pointer in the `scheduled` README that the index claim finds due rows and the endpoint claim decides firing would head that off. Doc wording is the implementer's call." — jhoffner, second-look pass ([comment](https://github.com/fixpoint-labs/flow-state-dev/pull/3601#issuecomment-6308341179))
- "One sentence on what this option owns (wiring index/cron only vs also exposing list/read APIs for Shift Manager) would avoid two host-configuration surfaces drifting apart in implementation." — cursor, on `hireWorkforce({ schedules: { index } })` ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3601#discussion_r4333168177))
- "One schedule **collection list** + in-memory `parseNextFireAt` per row (avoid per-row resource GET + avoid polling re-parse without memoization)." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3601#discussion_r4333168179))
- "Name whether `lastFired*` lives on the schedule collection row (schema + version) vs a sibling resource key — both reuse CAS." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3601#discussion_r4333168190))
- "The record carries the cron+tz it was written under, and a mismatch resets it." — jhoffner, second-look pass ([comment](https://github.com/fixpoint-labs/flow-state-dev/pull/3601#issuecomment-6308341179))
- "Have the memory store share a process-level singleton across adapters, so tests and single-host dev behave like the real thing." — jhoffner, second-look pass ([comment](https://github.com/fixpoint-labs/flow-state-dev/pull/3601#issuecomment-6308341179))

These are inputs, not instructions. Adopt, adapt, or discard; you owe no justification for
discarding one. A note that turns out to reveal a design problem is a spec blind spot:
surface it and fold it back.

**Open: none.**
