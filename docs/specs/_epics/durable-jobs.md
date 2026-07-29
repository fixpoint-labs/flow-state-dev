# Epic: Durable jobs & detached-task substrate

**Epic issue:** [FIX-939](https://linear.app/fixpoint-labs/issue/FIX-939) · **Epic PR:** *(pending)* · **Project:** Orchestration Primitives · **Branch:** `epic/durable-jobs`

> **What this document is.** A coordination artifact for a set of related issues, not an
> implementing spec. Issues under this epic do **not** derive from it — they reference and
> align to it. It exists so the decisions that cut across the set aren't made four times in
> four specs, each in a vacuum. Reviewed at the same altitude as a spec: fold what changes
> the objective or a cross-cutting decision, route everything else to the issue it belongs
> to. See [`orchestration.md`](../../contributing/orchestration.md).

---

## 1. Purpose & objective

### The objective (the gated statement)

**A unit of work can outlive the request that created it — and still be claimed exactly once,
still report what it is doing, and still be steered — on the task board we already have.**

Three clauses, each falsifiable, and the order matters because each one is worthless without
the one before it:

1. **Claimed exactly once.** Two executions racing over one durable board cannot both win a
   task, and cannot both admit past a cap. Today they can — measured, not inferred (§1, the
   premise correction).
2. **Reports what it is doing.** A task running outside its originating request has a live,
   persisted progress surface. Not `ctx.emit`, which dies with the request.
3. **Steered.** A coordinator that is alive can read the board and act on it; a coordinator
   that is gone does not strand the work.

### What this epic is explicitly **not** doing

Stated up front because the epic's own description had to correct itself once already, and
because the tempting shape here is the wrong one:

- **No sibling job queue.** The task board **is** the queue. Tasks are already durable
  resource-backed envelopes with a full mutation lifecycle and mid-flight observability
  (`TaskHandle.items()`). A second queue primitive beside it would be two sources of truth
  for one question.
- **No new durable store.** Nothing here adds a persistence backend. Conductor's own
  requirement list says this outright: it puts one durable task per issue on a
  **resource-backed** `TaskCollection` and needs no store that doesn't exist.
- **Not replacing the in-request sidechain.** `.work` / `.waitForWork` stays as the
  lightweight, ephemeral, in-request flavour. **Two flavours coexist by design** — in-request
  background work (request-state access, ephemeral) and durable session jobs (session-state
  only, recoverable). This epic builds the second; it does not fold the first into it.
- **Not task-events-as-dispatch-triggers.** The board emits `task-change` events as a UI
  notification channel. Turning them into a dispatch trigger is net-new wiring, belongs to
  Conductor M3, and is deliberately outside this decomposition (see FIX-825 in §3).

### The forcing function — why this stopped being a placeholder

This epic's description used to open with "**NOT** to be specced or built yet." It existed to
keep the delegation epic (FIX-930) designing a task contract that would survive this
substrate's arrival. That changed on 2026-07-28:

**[Conductor](https://linear.app/fixpoint-labs/issue/FIX-966) M2**
([FIX-969](https://linear.app/fixpoint-labs/issue/FIX-969) — run many issues in parallel under
an epic via the task board) **is blocked on this substrate.** Priority went Low → **High**.
A conductor phase — authoring a spec, implementing a PR — runs many minutes to an hour and
cannot be bound to a tick's request.

**This gates scale, not the fast path.** Conductor M0/M1 ship *before* this epic: one issue,
per-tick drain, phase work in-request. So nothing in the orchestration work is stalled waiting
here — what is stalled is running *many* issues at once. Worth holding while reading the
necessity check below, because it sets the bar an individual milestone has to clear: not "is
this useful" but "does parallel-at-scale fail without it."

### Membership — the sets this document counts by

Defined once here; every count elsewhere in this doc uses these labels rather than a raw
number.

| Set | Size | Members |
|---|---|---|
| **Sub-issues** — parented under FIX-939 | 6 | FIX-981, FIX-982, FIX-983, FIX-984, FIX-957, FIX-825 |
| **Active set** — gets an `issue-lifecycle` now | 1 | FIX-981 (M1) |
| **Filed, held as blocked** | 3 | FIX-982 (M3), FIX-983 (M4), FIX-984 (M5) |
| **Parented, out of the active set** | 2 | FIX-957, FIX-825 |
| **External dependency** — owned by FIX-980, blocks FIX-982 | 1 | FIX-978 (*In Spec Review* under FIX-980) |
| **Indexed rows** (§3) = sub-issues + external dependency | 7 | — |

**The milestone numbering is the description's, and it has a hole in it.** M1–M5 below are the
epic description's milestones. **M2 has no issue in this epic on purpose** — see §2 Decision 0.

| Milestone | Issue | Size | Sequence |
|---|---|---|---|
| **M1** — cross-execution claim safety | FIX-981 | Large | first; everything assumes it |
| **M2** — automated reclamation joined to execution liveness | *(none — FIX-978, under FIX-980)* | Small–Medium | elsewhere |
| **M3** — out-of-request executor, the board→queue bridge | FIX-982 | Medium | after M1 **and** FIX-978 |
| **M4** — blocking / background disposition | FIX-983 | Small–Medium | after M3, ∥ M5 |
| **M5** — progress across the request boundary | FIX-984 | Medium–Large | after M3, ∥ M4 |

Sequence: **FIX-981 → (FIX-978, elsewhere) → FIX-982, then FIX-983 ∥ FIX-984.**

### Why this is one body of work

Because the pieces are not four independent gaps that happen to be adjacent. They are one
boundary — **the edge of the request** — crossed four times:

> A task's lifetime is currently pinned to the execution that created it. Every item here is
> something that breaks the moment the task's lifetime and the request's lifetime stop being
> the same interval.

| | What is pinned to the request today | What breaks when the task outlives it |
|---|---|---|
| **M1** | one execution per board, so "who owns this task" never contends | two executions both claim the task; caps admit past their limit |
| **M3** | the drain runs in-request via `.forEach` | nothing exists to run a leased task after the request ends |
| **M4** | a caller awaits the drain, so "await" is the only disposition | no way to say "let it run" and mean it durably |
| **M5** | progress streams via `ctx.emit`, a request-scoped emitter | a detached task's progress has nowhere to go |

That shared shape is what makes the cross-cutting decisions in §2 real: the board-lifetime
enum (Decision 2), the `ResourceStateStore` question (Decision 1), and the allocation of
FIX-957's moved-in scope (Decision 3) each land on more than one of these rows. Deciding them
inside any one issue's spec would be deciding them for the others by accident.

### The premise correction this epic rests on — there is **no** CAS claim

The single most important fact in this document, and it is a correction to the epic's *own*
earlier premise. The description previously asserted the board has a "CAS claim" and that
Conductor could take "leases, CAS claim, attempts … as-is." **It cannot.** The error was
load-bearing: it is the reason the epic originally concluded no new work was needed here.

**Consequence:** parallel issue execution on a resource-backed board is **not** protected by
the substrate today. This does not invalidate "the board is the queue" — it means
**cross-execution claim safety is net-new work in this epic**, not an inherited property. That
is M1 (FIX-981), and it is why M1 is `Large` while the reclaim milestone is `Small–Medium`.

The measured evidence is carried in §5 — deliberately in this document rather than only in a
Linear description, for the reason Decision 4 states.

### Holistic necessity check

The `issue-spec` Step 3.5 lens at epic altitude: **each milestone can earn its place while the
set overbuilds.** Applied honestly, against the bar the forcing function sets — *does
parallel-at-scale fail without it* — the set is not uniformly strong:

- **M1 (FIX-981) is unavoidable and correctly sized.** It is not a nice-to-have: without it,
  two conductor executions can both claim one issue and both run a spec-authoring agent on it.
  That is duplicate model spend and duplicate PRs, which is a worse failure than the hang it
  replaces. Nothing else in the set is safe to build first. **No necessity doubt.**
- **M3 (FIX-982) is the milestone Conductor M2 actually asks for.** "A claimer that runs a
  leased task outside the originating request" *is* the blocked capability, stated in those
  words. **No necessity doubt.**
- **M4 (FIX-983) is the weakest member, and the doubt is specific.** "Await this" vs "let it
  run" may not need to be a *field on the task at all* — a caller that has a `TaskHandle` can
  already choose whether to await it. The open question is whether the disposition must be
  **durable** (survives the request, so a re-hydrating coordinator knows whether someone is
  waiting) or is merely **caller-side** (a local choice about whether to block). If it is
  caller-side, M4 is close to zero work and does not deserve a milestone. **Whoever specs
  FIX-983 must answer that before designing a field.** Recorded as OQ-B.
- **M5 (FIX-984) is necessary but its *urgency* is overstated by the description.** The
  description justifies it as: without it "a detached phase has no live stream, so the
  conductor board view can't be live." A live board **view** is an observability nicety, not a
  correctness property — M2's parallel execution is *correct* without it, just opaque. Set
  against M5's cost (the epic's self-declared hardest change, and **breaking for existing
  `.work` / `.waitForWork` callers**), that justification does not carry a Medium–Large
  breaking change on its own. The real necessity argument is narrower and should be the one
  its spec makes: **a detached task that reports nothing cannot be distinguished from a
  detached task that died**, which is a correctness problem, not a UI one. Recorded as OQ-C.

**Set-level verdict: the set does not overbuild, but it is not flat.** M1 and M3 are the epic;
M4 and M5 are the epic's tail and each carries a live necessity question that its own spec must
answer rather than inherit. Nothing here is redundant with anything else — the four touch four
distinct surfaces (claim/CAS, dispatch topology, task schema, progress transport) and none
subsumes another.

### What "done" looks like

Not "durable jobs work." Specifically:

1. Two concurrent executions over one resource-backed board cannot both settle one task, and
   cannot both admit past a creation cap — demonstrated by a check that **fails** against
   today's code (the §5 numbers are the falsification baseline).
2. A leased task continues to execute after the request that created it has ended, and the
   thing running it is not the originating request's drain.
3. A stranded claim returns to the queue with no human intervening — via FIX-978's mechanism,
   consumed here, not rebuilt here.
4. A detached task's progress is readable from a **persisted** surface, not from a
   `transient: true` trace item and not from the originating request's emitter (Decision 4).
5. The in-request `.work` / `.waitForWork` flavour still works, and any break to it is a
   declared, versioned break with a migration note — not a silent behavior change.
6. No new persistence backend and no second queue primitive were introduced (the §1
   not-doing list holds at the end, not just at the start).

---

## 2. Themes & cross-cutting decisions

### Decision 0 — M2 stays with FIX-980; this epic **consumes** reclamation, it does not build it

**DECIDED by the repo owner.** The epic description's **M2** ("automated reclamation, joined to
execution liveness") has no issue in this epic. That work is
**[FIX-978](https://linear.app/fixpoint-labs/issue/FIX-978)**, parented under epic
**[FIX-980](https://linear.app/fixpoint-labs/issue/FIX-980)** ("Honest task substrate", *In
Development*, epic PR [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983)), where
it is currently *In Spec Review*.

**The reasoning, which is the part worth keeping.** FIX-980's epic-spec already establishes —
against the code, in its Decision 3 — that **an expired lease is the *normal* state of a
healthy worker**: nothing renews a lease during execution, and `DEFAULT_LEASE_DURATION_MS` is
30s while a generator's model call routinely exceeds it. So any fix that infers abandonment
from lease expiry alone **trades a hang for silent duplicate execution** of a model call and
its side effects — strictly worse than the hang, and directly counter to *this* epic's
objective too.

That reasoning is already written down, already reviewed, and already binding on FIX-978. Two
epics both owning it would produce two mechanisms for one question, and the second one would be
derived by someone who had not read the first one's evidence. **One owner.**

**What that makes this epic's relationship to it:** FIX-978's outcome is a **dependency of
FIX-982**, not a deliverable of FIX-939. FIX-982 blocks on it in Linear. Concretely:

- FIX-939 **does not** design a lease-renewal or heartbeat mechanism.
- FIX-939 **does not** wire a reclaim sweeper.
- FIX-939 **does** assume, as a precondition of M3, that a stranded claim has a recovery path
  — and if FIX-978 lands a mechanism whose shape constrains the out-of-request executor,
  FIX-982's spec aligns to it rather than negotiating with it.
- **Binding on every issue here:** no issue under FIX-939 may infer "abandoned" from lease
  expiry alone. This is FIX-980's Decision 3 restated as a constraint on *this* set, because
  the temptation is local — an out-of-request executor is exactly where someone reaches for
  "the lease expired, so take it."

### Decision 1 — does this epic change `ResourceStateStore`?

*Pending — this section is the subject of the Decision-1 code research and is written in the
next commit on this branch. It is the decision the objective gate turns on.*

### Decision 2 — the board-lifetime enum is **extended**, never forked

**DECIDED.** [FIX-957](https://linear.app/fixpoint-labs/issue/FIX-957) ships board lifetimes
`block | request`. Whoever lands the durable rungs here **widens that same option** with
`session` / `user` / `org` — they do **not** introduce a second lifetime mechanism beside it.

**Why this is epic-level and not FIX-957's.** Board lifetime and task detachment are one axis,
in the repo owner's words: *"You cannot delegate out of a `block`- or `request`-scoped board,
so board lifetime and task detachment are one axis."* The durable rungs of that enum are
therefore this epic's, while the in-request rungs are FIX-957's — one enum, two owners, which
is exactly the situation that produces two enums if nobody writes it down.

**Why it creates no dependency in either direction.** **Widening an enum is additive and
non-breaking.** So:

- **Nothing here waits on FIX-957.** An issue under this epic may add `session` to the option
  before FIX-957 has shipped `block | request`, and vice versa.
- **FIX-957 does not wait on this.**
- What both owe is *the same option*, not a coordinated release.

**Binding on every issue under this epic:** an issue that needs a durable board lifetime adds a
rung to the existing option. An issue that finds itself introducing a parallel
`durableLifetime` / `scope` / `persistence` knob beside it has found a **conflict to surface**,
not a design choice to make — bring it back here.

### Decision 3 — allocating the scope that moved in from FIX-957

**DECIDED, and this allocation is the reason this section exists.** On 2026-07-29 the durable
half of FIX-957 was factored into this epic; FIX-957 now covers `block` and `request` board
lifetimes only. **Seven items moved.** The filed issues each carry a *"to be confirmed in the
epic-spec"* marker pointing here — so leaving any row unallocated re-creates the vacuum this
document exists to remove.

The cut FIX-957 was split along: **every concurrency consequence it had accumulated needs two
executions over one board, and in-request there is only ever one.** That is the test applied
below.

| # | Moved-in item | Owner | Why |
|---|---|---|---|
| 1 | `session` / `user` / `org` board lifetimes | **FIX-981 (M1)** | The durable rungs are what *create* the two-execution case; they cannot land before the claim safety that makes them safe. Widened per Decision 2. |
| 2 | FIX-957's former **Decision 3** (cap enforcement on durable storage) **+ its five consequences** | **FIX-981 (M1)** | Measured directly in §5: **8 rows written against `maxInstances: 4`**. Cap admission across concurrent executions is the *same* atomic-write question as claim safety — one mechanism answers both, and splitting them would produce two. |
| 3 | The unresolved **(a)/(b) claim-recovery mechanism** | **Decision 1, this document** | Not deferred to a spec — it *is* Decision 1, settled below rather than inside one issue, because option (b) is FIX-982's territory and option (a) is FIX-981's. |
| 4 | The **durable collection-identity seam** | **FIX-981 (M1)** | A durable board must be re-findable across executions before anything can contend for it. It is a precondition of M1's own tests, not separable work. |
| 5 | The **mandatory hydration memo** | **FIX-981 (M1)** | Same reason: hydrating a durable board is how the second execution reaches the first one's task. M1 needs it to exist in order to demonstrate the race at all. |
| 6 | The **pre-drain `reclaim()`** | **FIX-978 / FIX-980 — not this epic** | *Resolved below.* |
| 7 | **`flowIsolation` forwarding** | **FIX-982 (M3)** | *Resolved below.* |

#### 3.a — the pre-drain `reclaim()` belongs to FIX-978, not here (**the filing agent's guess was right**)

The filing agent could not place it and suspected FIX-978/FIX-980. **Confirmed.** A pre-drain
`reclaim()` is a *reclamation* mechanism, and reclamation is M2, which Decision 0 assigns to
FIX-978 under FIX-980. Placing it here would put the sweeper's trigger in one epic and its
liveness notion in another — the exact split Decision 0 exists to prevent.

It also fails on the merits independently, and this is the part worth recording: **a `reclaim()`
call sited pre-drain is precisely the "infer abandonment from lease expiry" shape** that
FIX-980's Decision 3 forbids. A drain that reclaims on the way in has, at that moment, no
evidence about whether the previous claimant is dead or merely slow. So the *placement* is not
a neutral detail to be forwarded along with the item — it is a design position that the
receiving epic has already ruled out. **Forwarded to FIX-978 as an input, explicitly flagged as
a shape that epic has already rejected**, so it is not adopted by inheritance.

#### 3.b — `flowIsolation` forwarding belongs to FIX-982 (**M3**)

The filing agent found no obvious owner and guessed possibly FIX-982. **Confirmed — FIX-982,
and the reason is structural rather than a best fit.** `flowIsolation` is a property of *how an
execution is set up*. Forwarding it matters exactly when something creates an execution that
the original caller did not: that is the out-of-request executor and nothing else in this set.

- Not FIX-981 — M1 is about two executions contending over one board. It does not *create* an
  execution, so it has nothing to forward.
- Not FIX-983 / FIX-984 — a disposition flag and a progress surface do not stand up executions.
- FIX-982 **is** the thing that stands up an execution outside the originating request. The
  isolation settings of the request that enqueued the work either travel to it or are lost, and
  "are lost" is a silent behavior change.

**No new issue is needed for either 3.a or 3.b.** Both have owners.

### Decision 4 — the evidence branch is gone; the numbers live here now

**The `spike/durable-board-claims` branch is not on `origin`.** Verified: 253 remote heads, no
`spike/*` ref of any kind. FIX-939's description cites it as *"do not delete"* and rests the
premise correction (there is **no** CAS claim) on it.

**What survives and what does not**, stated plainly because the difference decides a cost:

- **The measured numbers survive as text.** They are carried into §5 of this document. The
  epic's instruction to treat them as established stands — *"re-deriving these is exactly the
  cost four wrong readings already paid."*
- **The re-runnable harness does not survive.** Real `runAction` executions, real
  per-execution resource registries, the real resource-backed collection, a real SQLite file
  on disk, falsification conditions fixed before each run, a control per harness — all of that
  was branch-local and is gone.

**Consequence, and this is the part that needs to be read before FIX-981 is specced:** any spec
that wants to **re-run** these experiments — rather than cite them — must **rebuild the
harness**, and that cost belongs in **FIX-981's spec** as declared work, not discovered work.
FIX-981 is the issue most likely to need it, because "demonstrated by a check that fails
against today's code" (§1, done-condition 1) is a re-run, not a citation.

**Why the numbers moved into this document.** A Linear issue description is not a durable home
for the evidence a whole epic's premise rests on: it is unversioned, has no review surface, and
its history is not diffable. Putting them in §5 gives them a home that is reviewed, versioned,
and reachable from every issue under the epic. This is Decision 4's own principle applied to
Decision 4 — see also the persisted-surface rule that this epic inherits from FIX-980's
Decision 4, which binds here too: **any issue in this set claiming it made progress or failure
visible states which persisted surface carries it.** A `transient: true` trace item is not
observability.

---

## 3. Running index

Durable audit log of every PR under this epic. Refreshed from the coordinator's status table
each time this doc is updated. Empty columns mean not yet reached.

**Epic PR:** *(pending)* · never merged, open for the life of the epic.

**Active set** — parented under FIX-939, runs an `issue-lifecycle` now:

| Issue | M | Title (short) | Linear state | Spec PR | Impl PR |
|---|---|---|---|---|---|
| **FIX-981** | M1 | Two executions over one durable board can both claim a task | Backlog | — | — |

**Filed, held as blocked** — parented under FIX-939, no lifecycle until their dependency lands:

| Issue | M | Title (short) | Blocked by | Linear state | Spec PR | Impl PR |
|---|---|---|---|---|---|---|
| **FIX-982** | M3 | No out-of-request executor — a leased task can't run outside its request | FIX-981 **+** FIX-978 | Backlog | — | — |
| **FIX-983** | M4 | Tasks have no blocking/background disposition | FIX-982 | Backlog | — | — |
| **FIX-984** | M5 | A detached task can't stream progress — `ctx.emit` doesn't survive | FIX-982 | Backlog | — | — |

**Tracked, not active** — parented here (or depended on) but running no lifecycle under this
epic:

| Issue | Relationship | Linear state | Why it is not in the active set |
|---|---|---|---|
| **FIX-957** | sub-issue of FIX-939 | Backlog | Retains only the **in-request** half (`block` \| `request` board lifetimes) after the 2026-07-29 split. Its durable half is Decision 3's seven rows. Coordinates via Decision 2's enum; blocks nothing here and is blocked by nothing here. |
| **FIX-825** | sub-issue of FIX-939 | Backlog | Topic notification subscribers that bubble up into the flow — the **reactive-dispatch** concern. Belongs to this substrate (hence parented) but sits in the task-events-as-dispatch-triggers gap, which §1 puts **out** of this decomposition (Conductor M3). |
| **FIX-978** | **not** a sub-issue — owned by epic **FIX-980**, blocks **FIX-982** | In Spec Review | The M2 hole. Reclamation joined to execution liveness stays with FIX-980 per Decision 0; this epic consumes its outcome as FIX-982's dependency. Its spec activity is on FIX-980's epic PR [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983), not here. |

---

## 4. Open cross-cutting questions

**OQ-A — Decision 1: does this epic change `ResourceStateStore`?** *Filled in with Decision 1
in the next commit on this branch.*

**OQ-B — Must the blocking/background disposition be durable, or is it caller-side?** From the
necessity check: a caller holding a `TaskHandle` can already choose whether to await it, so
M4's value depends entirely on whether the disposition must **survive the request** — so a
re-hydrating coordinator can tell whether anything is waiting on a task — or is merely a local
choice about whether to block. If it is caller-side, **M4 is close to zero work and should not
be a milestone.** Routed as a **precondition to speccing FIX-983**, not a human blocker.
Whoever picks it up answers it before designing a field.

**OQ-C — What is M5's real necessity argument?** The description justifies FIX-984 by the
conductor board view not being live. That is observability, and it does not carry a
Medium–Large **breaking** change to `.work` / `.waitForWork` callers on its own. The stronger
argument — **a detached task that reports nothing is indistinguishable from a detached task
that died** — is a correctness claim, and it is the one FIX-984's spec should make and size
against. Routed as a **framing precondition to speccing FIX-984**. Not a human blocker, but it
may change M5's scope substantially: "distinguish alive from dead" is a much smaller surface
than "stream live progress."

---

## 5. Evidence on record

Measured findings this epic's premise rests on. **The harness that produced them is gone** —
see Decision 4 — so these are carried here as the durable record.

### The `spike/durable-board-claims` measurements

A throwaway harness, carried over from FIX-957 as the record these decisions rest on: real
`runAction` executions, real per-execution resource registries, the real resource-backed
collection, a real SQLite file on disk; only the worker body was stubbed (a plain handler, no
model). Every experiment had a falsification condition fixed **before** the run, and each
harness carried a control that could produce the disproving result.

| Finding | Measurement |
|---|---|
| Creation caps do not hold across concurrent executions | **8 rows** written against `maxInstances: 4` |
| Two drains both settle one task | both report `completed`; the stored row still reads `attempts: 1` |
| Recovery writes lose updates | `attempts` rolls **1 → 0** — a later write reverts an earlier one |
| A stranded lease has no reclaim path | **~13.9 hours** before a later drain proceeds (extrapolated) — see [FIX-978](https://linear.app/fixpoint-labs/issue/FIX-978) |

**Treat these as established.** Re-deriving them is exactly the cost four wrong readings
already paid. What is *not* established is anything these numbers don't cover — a spec needing
a new measurement rebuilds the harness (Decision 4), and that is declared work.

**The third row is the one to read twice.** "Recovery writes lose updates — `attempts` rolls
1 → 0" is a **lost update**, not a lock-contention symptom. It means the store's write path is
read-modify-write with no conditional, which is the fact Decision 1 has to price.

---

## Epic evolution

- **Epic created (this document).** Previously a placeholder whose stated purpose was to keep
  FIX-930 designing a detach-ready task contract. Promoted to active work by the Conductor M2
  forcing function, with membership decided with the repo owner: FIX-981 active, FIX-982/983/984
  filed-and-blocked, FIX-957 and FIX-825 parented but out of the active set, FIX-978 consumed as
  an external dependency. The description's **M2 hole** is recorded as Decision 0 with its
  reasoning, so it is not re-derived as an oversight.
