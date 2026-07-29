# Design — Conductor: the development orchestration system

**Date:** 2026-07-28
**Status:** DEFINITION — project framing and initial approach. **D1 (state ownership) and
D3 (workforce) are decided** (§7); D2 (the public name) stays open until launch.
**Type:** New package (`@flow-state-dev/conductor`) + surfaces (CLI, devtool module).
Composes `core`, `orchestration`, `claude-code`, `engine`, `scheduled`; deliberately
*not* a framework primitive change.
**Supersedes / absorbs:** FIX-832 (single-issue POC, burned), FIX-840 (choreography
reshape — its `state → action` insight is kept and generalized), and is the concrete
first surface under FIX-820 (DevTool as orchestration surface).
**Home:** Linear project *Development Workflow Orchestration*; epic **FIX-966**, milestones
**FIX-967** (M0) → **FIX-971** (M4).

---

## 1. What this is, in plain terms

Conductor is a system that runs a software development process. You give it an
objective and a set of work items; it drives each one from problem through spec,
review, implementation, PR feedback, and retrospective — dispatching the actual coding
work to a coding agent (Claude Code, Codex, or an FSD-native agent), pausing only where
a human decision is genuinely required, and showing you where everything stands.

It is built *on* FSD, and it ships *with* FSD. Any project that uses the framework can
adopt it, configure it, and rewrite its process files. For us it becomes the system we
use to build FSD itself — which makes it the most credible demonstration of the
framework we have.

**This is the dev-orchestrator growing up.** The earlier attempt (§3) was a POC that
served its purpose. The bar here is different and it should be stated plainly: a product
other people would want to use. That bar is what settles most of the design arguments
below — notably that no connector may be a prerequisite (§7/D1) and that the process
files are a configurable, documented surface rather than our prompts with our names in
them.

The process it encodes is not new. It is the process already written down in
[`docs/contributing/orchestration.md`](../../contributing/orchestration.md) and the
`epic-lifecycle` / `issue-lifecycle` / `issue-spec` / `issue-implement` skills. Conductor
does not invent it. Conductor **executes it in code instead of interpreting it in a
prompt.**

## 2. The problem with what we have now

The skills work. The harness running them does not scale.

Today a coordinator agent reads a 278-line state machine written in English and
re-derives, on every wake, what phase each issue is in and what to do next. Everything
else follows from that:

- **The coordinator's context fills up and it loses the thread.** It holds N issues'
  worth of status, gets compacted, and starts forgetting handles.
- **There is no place to look.** Understanding where five issues stand means scrolling
  agent output. The status table is in a transcript, not a view.
- **One conversation, many subjects.** Asking about issue A while the coordinator is
  mid-flight on issue B confuses both.
- **It falls off its tracks.** Phase transitions are prompt-interpreted, so they are
  probabilistic. A deterministic transition should never be probabilistic.
- **One vendor.** The whole thing is Claude Code shaped.

Each of these is a property of the *harness*, not of the process. That is the whole
argument for building this.

### Why not just use Claude Code or Codex

Not "because they're bad at coding" — they are the hands, and conductor calls them.
The claim is narrower and it holds:

| | Agent harness today | Conductor |
|---|---|---|
| Phase transitions | prompt-interpreted, probabilistic | code, deterministic and unit-tested |
| Coordinator state | a transcript that compacts | a reconciled copy of the world + an append-only workflow ledger |
| Visibility | scroll the output | a queryable board, rendered |
| Concurrency | one context holding N issues | one durable task per issue, one operator view |
| Vendor | one | a dispatcher seam; Claude, Codex, or FSD-native |
| Process customization | edit a prompt and hope | edit files against a typed contract |

## 3. Prior art in this repo — read this before starting

**This is the third run at this.** The earlier two are why the design below looks the
way it does, and one of them contains a hard-won lesson we must not pay for again.

- **FIX-820** (Backlog) — *DevTool as a development orchestration surface.* The vision:
  a codebase-aware cockpit that runs the dev loop. Still the right destination.
  Conductor is the engine underneath it; the devtool module is one of its surfaces.
- **FIX-832** (In Development, POC burned) — *drive a single Linear issue through its
  lifecycle.* A durable FSD flow plus a long-lived CLI babysitter. It worked, then
  broke: it carried **two state machines** — the Linear board and the flow's own
  suspend/checkpoint progression — encoding the same progression **with no rule for who
  wins and no path to reconcile.** They drifted. A cold restart between gate 1 and gate 2
  looped forever. No code landed in the repo. Note the lesson precisely: the defect was
  the missing authority rule, not the existence of a second copy (§7/D1).
- **FIX-840** (Backlog) — *the reshape that diagnosed it.* Conclusion: delete the
  second ledger, make the board the single state machine, express the orchestrator as
  a pure `state → action` map firing discrete idempotent actions, triggered from
  webhook / cron / CLI. That diagnosis is correct and §5 keeps it.

FIX-840's stated rule was "Linear is the single state machine, conductor stores
nothing." That rule is too strong for a product — it makes Linear a hard dependency
and leaves nowhere to put facts Linear cannot hold. §7/D1 sharpens it.

**Related, already done:** `@flow-state-dev/claude-code` CLI dispatch (FIX-672) and
in-process Agent SDK (FIX-671); webhook receivers (FIX-439); same-request
suspend/resume and crash recovery (FIX-811); the `fsdev chat` operator loop (FIX-875).

## 4. The entity model

Refining the initial sketch. Two changes do most of the simplifying work.

**Change 1 — separate phase, gate, and signal.** The sketch's lifecycle list mixed
three kinds of thing. `Drafted`/`Reviewed`/`Approved` are states of a review; `Merge
Conflict` is a condition the world reports. Splitting them makes the driver a pure
function:

- **Phase** — where the work is (`SPEC`, `IMPLEMENTATION`, …).
- **Gate** — what it is waiting on (`awaiting_spec_approval`, `awaiting_merge`).
- **Signal** — what the world reported (`review_submitted`, `ci_concluded`,
  `merge_conflict`, `base_recovered`, `merged`, `approved`), **or what reconciliation
  inferred was missed.** A signal is not necessarily live: comparing conductor's observed
  copy against fresh world state yields **synthesized** signals for events that never
  arrived — a `pr_opened` conductor never saw, backdated so the driver can process it
  before the comment that revealed the gap (§7/D1). Signals are not only external:
  `guidance_changed` fires when an objective, tenet, or lesson is added or edited (below).

**Change 2 — one review cycle, parameterized.** `drafted → in_review → revised →
in_review → approved` is the *same* cycle for a spec, an implementation, an epic-spec,
and a retrospective. `orchestration.md` already states its bar, its three dispositions,
and its two-round budget once, for all of them. So model it once. A "PR" is not an
entity — it is where an **Artifact** happens to be hosted.

```
Epic ──< Issue ──< Artifact ──< Review (round n)
            │          └──< hostedAt: PR | Linear doc | file
            └──< Dispatch (one agent run: vendor, skill, cost, outcome)

Guidance (collection)  ·  label + body, kind: objective | tenet | lesson
   └─ injected as context into decisions; reacted to on change
```

| Entity | What it is | Why it exists |
|---|---|---|
| **Project** | the repo conductor drives | scope root: config, connectors, process files |
| **Epic** | a set of related issues + their shared direction | cross-cutting decisions need somewhere to live |
| **Issue** | one unit of work; `type` is a routing key | the thing that moves through phases |
| **Artifact** | a reviewable output of a phase | unifies spec review and code review |
| **Review** | one round against an artifact | carries the round count the budget needs |
| **Dispatch** | one agent run | observability and cost; "what actually ran" |
| **Guidance** | a *collection* of `label + body` documents — objectives, tenets, lessons | they are reference material, not graph nodes (below) |

**Change 3 — objectives, tenets, and lessons are guidance documents, not entities.** All
three are the same shape (a label and a body) and serve the same *function*: they get
injected into a decision as context. That is exactly how the current Claude Code system
already uses `philosophy.md` — a reference document consulted when making a design call, not
a record something joins to. An `Objective` entity would buy graph traversal that nothing in
v1 needs, so it doesn't earn its place (tenet 3).

So: **one resource collection** whose instances carry `{ kind, label, body }`, with `kind` a
discriminator (`objective | tenet | lesson`) in the same way issue `type` is a routing key.
Objectives ground priority by being *read* during prioritization, not by being joined to
issues.

**The promotion trigger, named so the call stays revisitable:** if we need real graph
queries — every issue serving objective X, or which objectives have no work against them —
that is when a first-class entity and a link earn their place. Not before, and not
speculatively.

**Guidance changes are signals.** Because guidance lives in a collection, `reactTo` fires on
a change to it (FIX-751 for state, **FIX-843 for content writes** — both **Done**, so this
is buildable today, not a framework gap). That makes the interesting behavior configurable
rather than bespoke: *a new objective lands → re-examine every open PR and ask whether the
new objective changes the approach.* A guidance change is just another signal class the
driver reduces over, which is why separating signal from phase and gate paid off here.

**Issue `type` is a routing key, not a state machine.** `Feature | Improvement | Bug |
Spike | Prototype | Refactor` selects the discipline (`tdd` vs `diagnose`) and the
review lenses. `issue-implement` already routes this way. Six types, one state machine.

**Phases differ by entity.** Issue: `DISCOVERY? → SPEC → IMPLEMENTATION →
RETROSPECTIVE`. Epic: `FRAMING → CROSS_SPEC_REVIEW → (issues run) → WRAP`. Stating this
explicitly avoids forcing one phase list onto both.

`DISCOVERY` carries a question mark in the sketch and it should stay open — see §9.

## 5. The deterministic spine

One function, no model in the loop:

```ts
decide(entity, signal, world) → Action[]
```

**It is a reducer, not a planner.** Given an entity, the one thing that just happened, and
the world, it returns the actions that follow — the `(state, event) → effects` shape, not
"work out an approach" and not "choose which tasks to do next." It is deliberately **not**
called `plan`: in FSD, *plan* already means agentic planning (plan-and-execute, True Plan
Mode, plan mode), and this function never involves a model. Naming it `plan` invited exactly
the wrong reading.

The signal is an explicit parameter rather than something dug out of `world`, because
conductor is an event loop: **one signal in, actions out.** That also makes the reconciler
(§7/D1) compose cleanly — it produces signals, and each one is fed through `decide` in
order:

```
observed + fresh ──reconcile()──▶ Signal[] ──decide() per signal──▶ Action[] ──▶ execute
```

Pure, synchronous, exhaustively unit-testable over the phase × gate × signal matrix. This is
FIX-840's `state → action` map generalized past a single issue. Actions (`draftSpec`,
`reviseSpec`, `recordApproval`, `implement`, `addressFeedback`, `resolveConflict`,
`runGoalCheck`, `retrospect`) are discrete and idempotent — a duplicate or out-of-order
signal is harmless. **Only actions dispatch agents.** The decision of *what to do next* never
involves a generator.

That single property is what kills four of the five pains in §2.

### The loop: a tick, not a daemon

"Where does the loop live" has a deliberately boring answer, and the boringness is the
feature: **there is no resident loop.** There is an idempotent **tick** — a short request
that reconciles, decides, and mutates tasks, then returns.

```
trigger (webhook | cron | CLI | chat)
  └─▶ tick  = one request:  read world → reconcile → decide per signal → mutate/enqueue tasks → return
        └─▶ phase work = a separate, detached task execution (its own cycle, minutes to an hour)
```

- **A tick is a request.** Short, no model calls, no long-held anything. It is safe to fire
  redundantly — three triggers can all fire it and the result is the same, because actions
  are idempotent and state is re-derived. That is what makes restart free: nothing is
  resident, so nothing is lost.
- **Phase work is not in the tick.** Authoring a spec or implementing a PR runs as its own
  detached task execution (§5, FIX-939). The tick starts it and returns; it does not wait.
  Conflating the two is what would force a long-lived process back into the design.
- **Triggers are interchangeable.** Webhook (an event arrived), cron (the backstop and
  new-work discovery), CLI, or chat all call the same tick. None of them is privileged, and
  losing any one of them costs latency, not correctness — the cron backstop plus
  reconciliation recovers whatever the webhooks missed.

**Altitude: one board per epic, one state machine, many instances.** There is not a loop per
entity — there is one state machine *definition* and N entity instances that a tick advances.
Concurrency comes from the board: a resource-backed `TaskCollection` per epic, one task per
issue, the drain advancing them in parallel. The epic itself is a task too, with its issues
as **nested** sub-tasks, so dependency gating expresses "issues hold until the epic objective
gate passes" natively rather than as a special case.

**Not settled — validate in M2:** whether the epic-task-with-nested-issue-subtasks shape holds
up, or whether epics want a separate board from the project-level one. Both work on paper; the
nesting is more elegant and less proven.

### Gates are derived, not parked runs

A spec-approval gate can stay open for days. Parking a durable run on `ctx.suspend()`
for days means holding a lease across restarts, and FIX-765 (*suspension inside
detached durable execution — no path to surface the approval*, **Todo**) is exactly
that path being missing. So:

- **Long gates** (spec approval, PR approval, merge) are **re-derived** from world state on
  every tick, and GitHub wins on the answer (§7/D1). Nothing is parked, no lease is held,
  restart is free. Conductor still keeps its observed copy — that's what lets it notice a
  gate that opened while it was down — but the copy never overrides a fresh read. This is
  FIX-840's insight kept intact, and it means conductor does **not** block on FIX-765.
- **Short in-phase human input** (a question mid-implementation) uses `ctx.suspend()`,
  which FIX-811 made solid.

Approval detection reuses the rules already written in `orchestration.md` → Gates:
latest review per human reviewer, fresh against the current head, bots excluded.

### The task board is the substrate — detach the task, not the coordinator

Workers cannot be background work threads inside one run. Each issue needs its own
durable work record and its own execution cycle. The **task board is exactly that
primitive** — it is not a sibling of the queue conductor needs, it *is* the queue:

- **Each issue is a durable task** on a **resource-backed** `TaskCollection`. Resource-backed
  boards **survive across turns today**; that capability ships and works when the board is
  built by hand in code, which is what conductor does. (The *delegation* board is
  sequencer-backed and does **not** survive a checkpoint resume — FIX-958 corrected the docs
  that claimed otherwise, and FIX-957 is what lets the delegation path ask for the durable
  flavor. Conductor asks for it directly.)
- **Gates are `awaiting_review`** — already in the task status enum, and cross-turn human
  review works precisely *because* the board is resource-backed. Same for `blockTask` on an
  external condition.
- **Dependency gating, leases, CAS claim, attempts, per-task worker routing** all come with
  the board. Conductor does not reimplement any of it.
- **Observability** is `TaskHandle.items()` (a running task's emissions) plus `task-change`
  events — that is the board view's data source, not something new.

The governing principle comes from FIX-939 and it is the right one: **detach the TASK (the
work), not the coordinator.** The board is the durable rendezvous. Conductor's `plan` stays
request-bound, reads the board plus the world, and mutates tasks; each issue's phase work
executes in its own cycle. That is also what gives per-issue isolation — one task, one
execution, one stream — so "talking about A while it works on B" is settled structurally
rather than by convention, and over the Chat SDK it maps to one thread per issue.

### What the framework must gain (FIX-939)

Conductor does not need a new primitive; it needs the board's execution model extended.
This is the honest dependency list, and FIX-939 already names all of it:

| Framework gap | Why conductor needs it | Gates |
|---|---|---|
| **Out-of-request executor** — a claimer that runs a leased task outside the originating request. The drain runs in-request today (via `.forEach`). | A phase — authoring a spec, implementing a PR — runs for many minutes to an hour. It cannot be bound to the tick's request. | M2, and unattended M1 |
| **Progress decoupled from `ctx.emit`** — session-scoped resource + task-level observability | A detached task can't stream through the originating request's emitter. FIX-939 calls this its hardest change and a breaking one for existing sidechain callers. | a live board view |
| **Lease heartbeat + automated reclaim sweeper** — `reclaim()` exists but no drain or dispatcher ever calls it | A crashed worker's issue has to return to the queue without a human intervening. | M2's crash-recovery criterion |
| **Blocking / background flag on tasks** — no such distinction today | Conductor needs both "await this" and "let it run." | M2 |
| **Task events as dispatch triggers**, not just a UI notification channel (FIX-825) | The board should *drive* work, not only display it. Note `reactTo` already covers *resource* changes (FIX-751/FIX-843, Done) — the gap is specifically **task** events. | M3 |

**Sequencing — this does not block the fast path.** M0 and M1 ship **before** FIX-939: one
issue, a per-tick drain, phase work in-request. That is what the POC did and it worked
locally; M1's restart survival comes from gates being derived and the ledger living in
conductor's own resources, re-seeding the board each tick. What FIX-939 genuinely gates is
**M2 onward** — many issues, long-running detached phases, unattended operation.

FIX-939 is currently **Todo / Low priority** and says explicitly "NOT to be specced or built
yet." Conductor is the forcing function that changes that: it should be specced against
these five gaps, in this order, and its priority raised to match.

## 6. What we already have (the reason this isn't a multi-month project)

| Conductor needs | Already shipped |
|---|---|
| The durable work record per issue, dependency-gated, leased, CAS-claimed, retried | `taskBoard` + resource-backed `TaskCollection` (`@flow-state-dev/orchestration`) — durable across turns today |
| A cross-turn human gate on a work unit | task status `awaiting_review` + `blockTask` on a resource-backed board |
| Per-task observability | `TaskHandle.items()` + `task-change` events |
| React to a guidance document being added or edited | `reactTo` on a resource collection — state (FIX-751) **and content writes** (FIX-843), both Done |
| Off-request execution machinery to build the FIX-939 executor on | `enqueueAction({…, sessionId })` + `jobId` dedup; `@flow-state-dev/bullmq` for durable / separated workers |
| Short-lived human input gate | `ctx.suspend()` + suspension records (FIX-811) |
| GitHub events waking the right session | webhook transport, `flow.webhooks` + `sessionId(event)` (FIX-439) |
| Chat as an inbound trigger and operator surface | `@flow-state-dev/chat-sdk` (Slack / Teams / Discord, same `InboundTransportAdapter` contract) |
| Reconcile backstop + new-work discovery | `@flow-state-dev/scheduled` |
| The hands | `@flow-state-dev/claude-code` (`/cli` and `/sdk`) |
| Entity store, project-scoped, local → cloud unchanged | resource collections + `store-sqlite` / `store-postgres` |
| User-editable process files | the skills runtime (`SKILL.md` folders, `agents:` delegation) |
| Live view of activity | SSE item stream + `@flow-state-dev/react` renderers + devtool |
| Operator CLI loop | `fsdev chat` (FIX-875) |
| Proving the real path | the `goals/` harness |
| Vendor #2 | Codex integration, specced (FIX-797) |

**Genuinely new:** the entity/phase model and driver (§4–5), the board view, and the
process-file template. Everything else is composition — which is the point (tenet 2), and
is why a first payoff is weeks not months.

Two things that look like new layers and are not:

- **There is no "connector layer" to build.** Inbound is the existing
  `InboundTransportAdapter` contract, already implemented twice (webhook transport, Chat
  SDK). Outbound is handler blocks that call GitHub's and Linear's APIs. Neither half
  needs a new abstraction on top, and inventing one would be exactly the bloat tenet 3
  guards against. "Connector" in this doc names a *set of blocks plus a transport*, not a
  layer.
- **The entity model is blocks and resources, not an ORM.** Entities are resources
  (collections keyed by id); phases are blocks; the ledger is resource state. No
  data-access layer, no mapping layer, no repository pattern. If a sub-issue starts
  building one, that's the signal to stop.

## 7. The three framing decisions (two called, one open)

### D1 — Who owns state? **(DECIDED: authority per fact class; conductor keeps copies)**

The sketch says conductor's own resource system is the truth, with hooks to sync outward.
FIX-840 says the board is the only state machine and conductor stores nothing. Both
framings miss the same distinction, and getting it right is the load-bearing call.

**"Source of truth" means who wins when there is disagreement.** It does *not* mean who is
allowed to hold data. Conductor is a **highly evented system** — it reacts to things
happening in the world — and an evented system needs its own last-known copy to diff an
incoming event against. So conductor keeps copies where they help, and the question is only
ever *who wins on a conflict.*

**Authority per fact class:**

| Fact class | Who wins | Conductor's copy |
|---|---|---|
| **PR facts** — open / closed / merged, feedback, review states, CI conclusion, head SHA, mergeability | **GitHub**, always | kept, as an observed projection with provenance (what we saw, when, from where) |
| **Workflow progress** — which phases completed, review-round counts, gate records, dispatch history and cost, lessons | **Conductor** | it *is* the record; nothing else has anywhere to put `spec_review_rounds: 2` |
| **Linear issue status** | Linear, for its own field | kept if the connector is configured; see below |

### The local copy is an asset, not a liability

This is the part the earlier framing got backwards. A copy that can disagree with the world
is exactly what makes **missed events recoverable**:

> A PR comment arrives for a PR conductor never saw opened — because the `PR opened`
> notification was dropped, or arrived while the process was down. Conductor's copy is out
> of sync, and *that is how it knows*: it can backdate and fire the missed `PR opened`
> transition, then process the comment in the right order.

Without a local copy there is nothing to diff against, so a dropped event is simply lost.
With one, **a divergence is a signal** — including a signal about a signal that never
arrived. Reconciliation is therefore a first-class path, not an error handler: each tick
compares observed against fresh, and any gap becomes one or more **synthesized signals**
the driver reduces over in order.

**So what was FIX-832's bug, precisely?** Not "conductor kept a copy." It was a copy that
was *authoritative* — a second state machine whose phase claim competed with the board's,
with **no rule for who wins and no path to reconcile.** A copy with a designated winner and
a reconcile path is a cache. A copy without one is a second authority. That is the whole
distinction, and it is the lesson worth carrying.

**Decided, with three consequences that are part of the decision:**

1. **Copies are kept and reconciled, never trusted over their owner.** Every observed fact
   carries provenance so a conflict is resolvable rather than ambiguous, and GitHub wins on
   every PR fact. Conductor wins on what workflow has and has not completed — that is its
   own domain and nothing else models it.
2. **GitHub is essential to the workflow; Linear is configuration.** GitHub is where the
   artifacts live and where the gates are read, so it is a substrate dependency. Linear is
   not, and the config decides: whether it is connected at all, whether progress is mirrored
   outbound, and whether inbound status changes are reacted to as signals. Conductor runs
   fully with no Linear connected.
3. **The connector layer is an interface, not two integrations.** GitHub and Linear are its
   first two implementations. A third is a v2 question — define the seam now, don't build
   past it (tenet 3).

### D2 — The name **(OPEN — internal name is `conductor`; public name deferred)**

`conductor` fits the metaphor and the pitch ("the harness that conducts your work").
Two cautions: **Netflix Conductor** is a well-known workflow-orchestration engine, which
is a direct collision in this exact category; and `dev-engine` collides with our own
`@flow-state-dev/engine`, which is worse — it would be incoherent inside the repo.
**Recommendation: use `conductor` internally now and treat the public name as an open
question for launch.** The internal name is cheap to change; the package name is less so.

### D3 — Relationship to `workforce` **(DECIDED: bypass, keep the `Dispatcher` seam)**

Conductor's workers are mostly *external* coding agents, not FSD generators with
personas. The right seam is a vendor-neutral `Dispatcher` (given a phase brief plus a
skill, run it, return a typed result), with `claude-code` as the first implementation
and `codex` as the second. `workforce` becomes relevant when we add **FSD-native review
agents** that don't need a full coding harness. **Decided: bypass `workforce` for v1 and
keep the `Dispatcher` seam clean so it drops in later.** Workforce Layer 2 is still in
flight; taking a dependency on it now couples two moving things.

## 8. Initial approach — four milestones, payoff at M1

Sequenced so the first milestone is the one that changes the daily experience.

### M0 — the model, as a pure module (days)

`decide(entity, signal, world) → Action[]`, the entity schemas, the phase/gate/signal types,
**and the reconciler** — a pure `reconcile(observed, fresh) → Signal[]` that turns a divergence
between conductor's copy and the world into ordered signals, including backdated ones for
events that never arrived (§7/D1). No I/O, no agents, no connectors.
**Verify:** unit tests covering the full phase × gate × signal matrix, including the paths
§2 says the current harness drops (restart mid-gate, duplicate signal, out-of-order signal,
backwards phase move) **and the reconciliation paths D1 exists for**: a comment observed on
a PR whose `pr_opened` was never seen (synthesizes the missed transition, ordered ahead of
the comment); observed state ahead of fresh (stale read — no signal, no regression); and a
conflict where the copy disagrees with GitHub on a PR fact (GitHub wins, divergence is
recorded).

### M1 — one issue, end to end, driven by code (the payoff)

The tracer bullet: hand conductor one issue; it drives spec → approval gate →
implementation → PR feedback → ready-to-merge as one durable task. Driver from M0,
`claude-code` as the hands, GitHub read + PR-ops blocks, phases and dispatches emitted as
stream items, a minimal CLI board view.

**Both artifact kinds carry multi-round feedback.** A spec PR and an implementation PR
each accumulate reviewer feedback that may need incorporating over several rounds, and
today **all of it is hosted on GitHub** — comments, review threads, review states. So the
parameterized review cycle (§4) must handle rounds on *both* from the start, reading
GitHub each round and applying the two-round convergence budget from
`orchestration.md`. This is not deferrable to M2: it is most of what M1's PR-feedback
phase does.
**Ships before FIX-939.** One issue, a per-tick drain, phase work in-request — that is
what the POC did and it worked locally. Restart survival comes from gates being derived
(§5) and the ledger living in conductor's own resources, re-seeding the board each tick.
**Verify:** a real FIX issue reaches a real merge-ready PR with **zero coordinator
model calls**, and the run survives a process restart mid-gate.
This is FIX-832's goal on the substrate that doesn't drift. Pains 1, 2, 4 and the
vendor pain are gone at this point.

### M2 — many issues, under an epic

One durable task per issue on a resource-backed board (§5), each phase executing in its
own cycle via **FIX-939's out-of-request executor** — dependency gating, leases, and
reclaim come from the board. Plus the epic-spec and cross-spec-review phases, and nested
tasks for a multi-PR issue's sub-PRs.
**Blocked on FIX-939** (the executor, the lease sweeper, the `ctx.emit` decoupling, and the
blocking/background flag). This is the milestone that forces that epic to be specced.
**Verify:** three issues in parallel from one operator conversation, each with its own
execution and stream; asking about issue A never disturbs issue B; killing a worker returns
its issue to the queue unattended. Pain 3 is gone.

### M3 — event-driven, and a surface worth looking at

Webhook transport replaces polling; `scheduled` provides the reconcile backstop and
new-work discovery; the board becomes a devtool module. **Plus the Chat SDK
integration** (`@flow-state-dev/chat-sdk`) — chat as both an inbound trigger and an
operator surface, on the same `InboundTransportAdapter` contract the webhook transport
uses. One thread per issue-session is the natural mapping, and it's what makes conductor
supervisable from Slack rather than only from a terminal.
**Verify:** a GitHub review event advances the right issue with no session running, a cold
reconcile re-derives the whole board from the world, and an issue can be driven and
questioned from a chat thread.

### M4 — Linear sync, guidance, and the loop that improves itself

Linear sync as a projection (outbound blocks, plus optional inbound status signals — no new
layer, per §6). The **guidance collection** (§4): objectives, tenets, and lessons as
`label + body` documents injected into decisions, with `reactTo` on the collection so a
guidance change is a signal. Retrospective phase writes lessons *into* that collection, and
the `distill-lessons` pass proposes the smallest upstream fix to the process files.
**Verify:** two goal checks. (1) A completed epic produces a lesson that lands as a concrete
process-file change. (2) **Adding a new objective triggers a configured re-examination of
every open PR** and reports which ones the new objective changes the approach for — the
reactive path, proven on the real collection rather than asserted.

**M1 is the fast path.** M0+M1 are the milestone worth committing to; M2–M4 are ordered
but re-decidable once we've lived on M1.

## 9. Out of scope (and open questions)

**The one hard framework dependency: FIX-939** (*Durable jobs & detached-task substrate*).
M0 and M1 clear it; M2 onward does not. §5 lists the five gaps it has to close, in the
order conductor needs them. Related and worth reading alongside it: FIX-930 (delegation
substrate, designing a detach-ready task contract), FIX-957 (letting a delegation board ask
for the durable flavor), FIX-958 (what board durability actually is today), FIX-825 (task
events as dispatch triggers — the one still open), and FIX-922 (what task-board + delegation
+ goalSeekLoop already subsume — worth answering before conductor adds anything).

**Already shipped, so not a dependency:** `reactTo` on resource and collection changes
(FIX-751) including **content** writes (FIX-843) — both Done. The guidance-change reactions
in §4 and M4 build on these as-is.

**Explicitly not in v1:** cloud hosting (local first; the store swap is the only
difference), codebase-awareness / structural index (FIX-820's other half), auto-merge in
any form, replacing Linear as the human-facing board, and general-purpose workflow
orchestration for non-development work.

**Open:**

1. **`DISCOVERY` as a phase.** The sketch flags it with a question mark. A problem
   arriving already articulated needs no discovery phase; a vague one does. Is that a
   phase, or is it a *type* of issue (`Spike`) that happens to produce an issue set?
   Leaning towards the latter — it needs no new machinery.
2. **Retrospective altitude.** Per issue, per epic, or both? `distill-lessons` currently
   runs per-PR *and* periodically. Two altitudes may be right; two implementations are not.
3. **Does guidance need lifecycle?** An objective can be achieved or abandoned; a lesson can
   be promoted into a tenet or retired. If that turns out to need real states, the guidance
   collection grows a status field — but only once a behavior depends on it, not upfront.
4. **Public name** (D2).
5. **Where the process files live** so they are editable per project but versioned with
   the repo — `.conductor/` alongside `.agents/skills/`, or inside it?

## 10. Immediate next step

**D1 and D3 are called.** The epic and the milestone issues are filed under the
*Development Workflow Orchestration* project. First spec to write: **M0 + M1 as a single
spec**, so the model is validated by a real run rather than by tests alone. Everything
after that is a normal issue under the epic.
