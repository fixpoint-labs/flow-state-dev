# Epic: Durable jobs & detached-task substrate

**Epic issue:** [FIX-939](https://linear.app/fixpoint-labs/issue/FIX-939) · **Epic PR:** [#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993) · **Project:** Orchestration Primitives · **Branch:** `epic/durable-jobs`

> **What this document is.** A coordination artifact for a set of related issues, not an
> implementing spec. Issues under this epic do **not** derive from it — they reference and
> align to it. It exists so the decisions that cut across the set aren't made four times in
> four specs, each in a vacuum. Reviewed at the same altitude as a spec: fold what changes
> the objective or a cross-cutting decision, route everything else to the issue it belongs
> to. See [`orchestration.md`](../../contributing/orchestration.md).

---

## 1. Purpose & objective

### The objective (the gated statement)

**A unit of work can outlive the request that created it — with exactly one owner at a time,
a progress surface that survives the request, and no way to strand it — on the task board we
already have.**

> **Read the conditionality block below before treating any clause as a promise.** §1 was
> **audited as a whole against the full open-question set (OQ-A, OQ-B, OQ-C, OQ-D)** — clause by
> clause and criterion by criterion — so the conditionality here is deliberate and complete, not
> patched where a reviewer happened to look. Several open questions permit outcomes that do
> **not** satisfy the headline sentence above.

Three clauses, each falsifiable, and the order matters because each one is worthless without
the one before it:

1. **Exclusive ownership per attempt, and at-least-once execution.** Two parts hold **wherever
   the guarantee applies at all** (see C1 below for where that is): at any moment a task has at
   most one *current* owner — **only one execution may successfully claim it** — and a **stale**
   owner's settlement is rejected rather than applied. Today neither holds across executions —
   measured, not inferred (the premise correction below).

   **A third part, cap admission, is *conditional* and may not be delivered at all.** It is
   **not** promised by this clause. What the epic delivers depends on **OQ-A** (which guarantee)
   and **OQ-D** (whether cap work lives here at all — it may be FIX-957's). **If OQ-A selects
   narrowed-but-unbounded overshoot, or OQ-D defers the work, this epic makes no cap guarantee** —
   see the table below and Decision 1 → 1b. Stated this way so the objective cannot be approved
   against a promise its selected implementation will not keep.

   | Guarantee | Meaning | Requires |
   |---|---|---|
   | **Exact arbitration** | Concurrent executions can *never* admit past the cap | a **named mechanism that enforces a hard maximum on concurrent admitters** — none is identified yet |
   | **Narrowed, unbounded overshoot** | The race window shrinks; the overshoot **still grows with concurrency** | an authoritative read before the decision |

   **The second row is deliberately not called "bounded".** An authoritative read followed by a
   distinct-key write narrows *when* the race happens and bounds *nothing about how much*: any
   number of executions can each observe remaining capacity before any of them writes, so
   overshoot scales with the number of concurrent admitters. Calling that "bounded" would be a
   guarantee this epic cannot honour — see Decision 1 → 1b, and the cross-issue finding there.

   Whichever the gate picks — including "no cap guarantee at all" — the two ownership parts above
   still hold wherever the guarantee applies (C1).
2. **Reports what it is doing — *conditional on OQ-C* (C2).** A task running outside its
   originating request has a **persisted progress surface**. Not `ctx.emit`, which dies with the
   request. **If OQ-C narrows M5 to liveness-only, this clause is not delivered** — a heartbeat
   says a worker is *alive*, not what the task is *doing*, and those are different guarantees.
3. **Steered — second half depends on FIX-978, which this epic does not build (C3).** A
   coordinator that is alive can read the board and act on it; a coordinator that is gone does not
   strand the work. **The non-stranding half is FIX-978's mechanism, consumed here** (Decision 0),
   so this epic can satisfy it only if FIX-978 lands.

#### Conditionality of this objective — the complete set

Stated once, in one convention, so no clause reads as a promise the epic may not keep. **This is
the output of the whole-§1 audit against OQ-A/B/C/D**; anything not listed here is unconditional.

| | Clause / criterion | Conditional on | If the permitted outcome is taken |
|---|---|---|---|
| **C1** | clause 1 ownership · criterion 1 | **OQ-A** (whether the store change is adopted) · the adapter · the backing | Ownership holds only on a board the framework can actually fence: **(i)** if the gate **refuses** the conditional write, the guarantee falls to queue-level dedup, which this document shows is **bypassed by `taskTools` and `reclaim`** — so it is *not* delivered generally; **(ii)** on a store without the verb (e.g. **filesystem**, Decision 1 → feasibility) the durable board is refused rather than guaranteed; **(iii)** a **`factory`**-backed board is unverifiable and out of scope by default (Decision 2 → 2.b). |
| **C1b** | clause 1 cap · criterion 1b | **OQ-A** (which guarantee) · **OQ-D** (whether cap work is here at all) | May be **narrowed-but-unbounded overshoot**, or **no cap guarantee at all**. Already conditional above. |
| **C2** | clause 2 progress · criterion 4 | **OQ-C** | If M5 narrows to **liveness-only**, there is no persisted *progress* surface — only an alive/dead signal. Clause 2 and criterion 4 are then **not** delivered, and the epic should not claim them. |
| **C3** | clause 3 non-stranding · criterion 3 | **FIX-978** (external — not an OQ) | This epic **consumes** reclamation and does not build it (Decision 0). If FIX-978 does not land, work can still strand and this half is undelivered. Recorded because a reader would otherwise read it as this epic's promise. |

**OQ-B is the one open question that changes no clause.** Whether the blocking/background
disposition is durable (M4) affects *how a caller waits*, not any guarantee in §1 — verified
clause by clause during the audit rather than assumed.

> **Why clause 1 says "per attempt" and not "exactly once" — folded from round 1 (Codex,
> PR #993), and it corrected the gated statement itself.** An earlier draft claimed work is
> *"claimed exactly once."* **That is not achievable and this epic must not promise it.**
> `reclaim()` exists precisely to return an expired `in_progress` task to `pending`
> (`resource-backed.ts:406-450`), so a second worker can and will repeat any side effect the
> first performed before dying. Conditional writes can guarantee **one current owner** and can
> **reject a stale settlement**; they cannot make execution exactly-once without side-effect
> fencing (idempotency keys, or an owner token checked at every external write) — which is a
> much larger mechanism, is not in any milestone, and is **not** being adopted here.
>
> So the honest contract is **exclusive ownership per attempt + at-least-once execution**, and
> a task body under this epic must be **safe to run more than once**. Note the deliberate
> contrast with the scheduled-actions substrate, which chose the other side: `ScheduleIndex`'s
> documented contract is **at-most-once** (`packages/scheduled/src/scheduleIndex.ts:14-17`) —
> a dispatch that fails after its row advances is dropped. Tasks want the opposite trade,
> because a retried spec-authoring phase is recoverable and a silently dropped one is not.
>
> **An earlier version of this note claimed the completion criteria "were already consistent" with
> the weaker property, so only the claim had been wrong. That was itself wrong**, and the audit
> withdraws it: criterion 1's settlement-only assertion was **not** consistent — it could pass while
> exclusive ownership was violated, which is the defect the criterion now fixes by asserting *claim*
> exclusivity first. Recorded because "the criteria are fine, only the prose drifted" is the
> assumption that let it survive five rounds.

### What this epic is explicitly **not** doing

Stated up front because the epic's own description had to correct itself once already, and
because the tempting shape here is the wrong one:

- **No sibling job *registry*.** The task board **is** the queue: tasks are already durable
  resource-backed envelopes with a full mutation lifecycle and mid-flight observability
  (`TaskHandle.items()`). A second place that **defines what work exists** would be two sources of
  truth for one question. **A queue used purely as M3 *transport* is not that** — Decision 5 offers
  exactly that option (BullMQ delivery), and it is permitted precisely because the board stays the
  registry. The line is registry vs transport, not "no queue anywhere."
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
| **Active set** — gets an `issue-lifecycle` **once the objective gate passes** | 1 | FIX-981 (M1) |
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
- **M4 (FIX-983) is the weakest member — but no longer for the reason first given.** The earlier
  claim that its durable half "may be as small as one predicate helper" is **withdrawn**:
  `.waitForCondition` ships in-request blocking only, since it requires the *current* request's
  response emitter, so it cannot receive a detached execution's completion. **Cross-request waiting
  does not exist today**, so M4's durable half is new work rather than a helper. Whether it deserves
  a milestone still turns on whether the disposition must survive the request — **stated once in
  OQ-B**, along with the (now precondition-bearing) "collapse M4 into M3" option.
- **M5 (FIX-984) is necessary but its *urgency* is overstated by the description**, which
  justifies it by the conductor board view not being live. A live board **view** is
  observability, not correctness — M2's parallel execution is *correct* without it, just opaque —
  and that does not obviously carry a Medium–Large change that **breaks existing `.work` /
  `.waitForWork` callers**. **Stated once in OQ-C**, including the corrected framing and the
  "narrow M5 to liveness-only" option.

**Set-level verdict: the set does not overbuild, but it is not flat.** M1 and M3 are the epic;
M4 and M5 are the epic's tail and each carries a live necessity question that its own spec must
answer rather than inherit. Nothing here is redundant with anything else — the four touch four
distinct surfaces (claim/CAS, dispatch topology, task schema, progress transport) and none
subsumes another.

### What "done" looks like

Not "durable jobs work." Specifically:

1. **Ownership — *conditional on C1*. The check asserts *claim* exclusivity first — settlement
   second.**

   > **The round-9 audit missed this item, and the miss is recorded rather than quietly fixed.**
   > That pass made clause 1 conditional on C1 and **left this criterion unconditional** — so the
   > permitted outcomes C1 names could never satisfy the documented definition of done. It is the
   > identical defect the audit existed to sweep, one line away from where it swept. **An unmarked
   > miss would make the whole pass less trustworthy than a marked one**, since the audit's value
   > to a later reader rests on its having been exhaustive.

   **Where the guarantee is fenced** (the store supports the conditional write, and the board is
   not `factory`-backed), under contention over one resource-backed board:

   1. **Only one `claim()` succeeds — equivalently, only one worker starts.** This is the primary
      assertion, because **the claim is the exclusivity boundary.**
   2. **And** a **stale** owner's settlement is rejected rather than applied.

   Both demonstrated by checks that **fail** against today's code (§5 is the falsification
   baseline).

   > **Why assertion 1 is stated first and cannot be dropped.** An earlier version of this
   > criterion asserted only that two executions *"cannot both settle."* **That is passable by an
   > implementation that violates the guarantee.** Convert settlement to a conditional write but
   > leave `claim` on the unsafe path and: both claims return, **two workers launch and run to
   > completion**, and only one settlement lands. The criterion passes. Exclusive ownership is
   > broken, and the cost lands in full — **duplicate model execution, minutes to an hour of spend
   > per duplicated Conductor phase**, which is the specific failure this epic exists to prevent.
   >
   > **How it slipped, recorded because FIX-981 should not inherit the habit:** the criterion was
   > written when clause 1 still said "cannot both settle." Round 3 strengthened the clause to
   > per-attempt ownership and added the stale-settlement half to the criterion, but never
   > revisited the first half to make *claim* exclusivity assertable. **A criterion that cannot
   > fail when its guarantee breaks is the failure mode our own grounding names** — a test that
   > can't fail when the logic changes is wrong.

   **Where the guarantee is *not* fenced, "done" is defined differently — no outcome is left
   without a check.** C1 permits three such outcomes, and each gets its own definition of done
   rather than inheriting one it cannot meet:

   | Permitted outcome | What "done" means instead |
   |---|---|
   | **OQ-A refuses the conditional write** → guarantee is **topological** (queue dedup) | Assert that **exactly one execution can reach the board for a given task** — i.e. the dedup invariant at the queue, not exclusivity at the store. **And assert the escape hatches explicitly**: a `taskTools` call and a `reclaim` from outside the queue **must be shown either to be impossible by construction or to be fenced some other way.** Without that second half the check would certify a guarantee this document already shows is bypassed. |
   | **Store lacks the verb** (e.g. filesystem) | Assert the durable board is **refused at construction**, loudly and by name — not that it is safe. A silent degrade fails this criterion. |
   | **`factory`-backed board** | Assert it is **refused or explicitly unsupported** for detached jobs (Decision 2 → 2.b), unless it satisfied the advertisement contract there. |
1b. **Cap admission (conditional on OQ-A — state which was chosen):**

   | If OQ-A chooses | The distinct-ID goal check asserts |
   |---|---|
   | **Exact arbitration** | final row count **never exceeds** the cap — available only once a mechanism enforcing a hard maximum is named |
   | **Narrowed, unbounded overshoot** | that the window narrowed; it **cannot** assert a maximum, because the mechanism enforces none |

   Under the second, the check must *not* assert "never exceeds" nor "exceeds by at most N" — a
   correct implementation would fail either. **If 1b is deferred entirely (see OQ-D), this
   criterion is relaxed to criterion 1 alone** and the epic claims no cap guarantee at all.
2. A leased task continues to execute after the request that created it has ended, and the
   thing running it is not the originating request's drain.
3. **(Conditional — C3.)** A stranded claim returns to the queue with no human intervening — **via
   FIX-978's mechanism, consumed here, not rebuilt here.** So this criterion is satisfiable only
   once FIX-978 lands; it is not this epic's to demonstrate alone.
4. **(Conditional on OQ-C — C2.)** A detached task's progress is readable from a **persisted**
   surface, not from a `transient: true` trace item and not from the originating request's emitter
   (Decision 4). **If OQ-C selects liveness-only, this criterion is replaced** by the weaker one it
   actually delivers — an alive/dead signal on a persisted surface — and the epic states that it
   ships no progress surface. **Do not assert the progress form against a liveness-only
   implementation**; it would fail a correct build, the same defect as the old criterion 1.
5. The in-request `.work` / `.waitForWork` flavour still works, and any break to it is a
   declared, versioned break with a migration note — not a silent behavior change.
6. **No new persistence backend, and no second *work registry*.** The board remains the single
   source of truth for what work exists. **Stated as "work registry", not "queue primitive"** —
   Decision 5 explicitly permits a **queue as M3 transport** (e.g. BullMQ delivery), and the
   earlier wording ("no second queue primitive") would have been violated on its face by an option
   this document offers. A transport that carries wake-ups is fine; a second place that *defines*
   the work is not.

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

### Decision 1 — does this epic change `ResourceStateStore`? **(RECOMMENDATION in two parts — 1a and 1b. Awaiting the objective gate.)**

**Settled here, in this document, before the gate — deliberately not deferred to FIX-981's
spec.** Option (b) *is* FIX-982's territory (dispatch topology), so this decision picks the
shape of **two** milestones, not one. Framing it here and leaving it open would re-create
exactly the vacuum this epic-spec exists to remove.

Everything below is priced against the tree at `epic/durable-jobs`, not restated from the
description. **Two of the description's own claims about option (a) turn out to be wrong**, and
they are the two that make (a) look expensive.

#### First — the precedent. This is not greenfield, and that changes the whole question

Cursor asserted in round 1 that **CAS precedent already exists in this repo**. **Verified in the
tree — CONFIRMED, and it is stronger than the claim.** This is the single most important input
to this decision, so it goes before the options: option (a) has a **shipped mirror to follow**,
not a shape to invent.

**What exists, one layer down, on the *scope* stores:**

| Precedent | Where | What it does |
|---|---|---|
| `runWithCAS` | `packages/engine/src/stores/cas.ts:119-175` | A full load → mutate → persist CAS loop: `expectedVersion`, conflict detection, **container refresh on conflict** so the retry sees real current state, exponential backoff, and `ConcurrentModificationError` after `maxRetries` (default 3). |
| `set(id, value, expectedVersion)` | `packages/engine/src/stores/types.ts:258-272` (`SessionStore`), `:274-281` (`RequestStore`), and the user/org stores | **Version-gated conditional write.** "Write `value` when the stored record's version matches `expectedVersion`. Returns the new version on success or the current stored value/version on conflict." `ExpectedVersion` also admits `"any"` for a deliberate unconditional write. |
| `DeltaStoreOps` | `packages/engine/src/stores/types.ts:181-256` | **Optional** CAS-aware delta verbs (`patchField`, `incField`, `pushToArray`, `deleteField`), each version-gated. |
| `ScheduleIndex.claimDue` | `packages/scheduled/src/scheduleIndex.ts:48-61` | **Atomic read-and-advance across executions** — claims all rows with `nextFireAt <= now` *and* advances them in a single transaction. An **opt-in** store-adapter interface implemented by the Postgres and SQLite store packages. |

**The `DeltaStoreOps` header is the decisive sentence**, because it describes the exact
mechanism this decision was independently reaching for:

> *"Adapters MAY implement none, some, or all of these. The CAS persist callback
> **feature-detects per call and falls back to `set`** with the full record when a verb is
> absent (**capability advertisement**). … the optional-in-v1 stance is a migration concession
> to existing SQLite and filesystem adapters."*

**So "optional verb + feature-detect + fall back" is the established house pattern for exactly
this problem, adopted for exactly this reason — an existing SQLite and filesystem adapter that
shouldn't be forced to migrate at once.** The recommendation below is therefore not a novel
design and should not be reviewed as one; it is **applying a shipped pattern to the one store
that was left out of it.**

##### The gap, in one finding: resource state has **tier 1 of a two-tier design and no tier 2**

`scope-lock.ts:1-5` states the architecture outright — *"Per-`StateContainer` async FIFO mutation
queue. The two-tier dispatch lives in `applyMutation`; **CAS retries still apply at the durable
boundary in `runWithCAS`**."*

| Tier | Scope state | Resource state (**the task board**) |
|---|---|---|
| **1 — in-process serialization** | per-container FIFO queue (`scope-lock.ts`) | ✅ `serializeResourceWrite` promise chain (`resource-registry.ts:540-546`) |
| **2 — cross-execution, at the durable boundary** | ✅ `runWithCAS` + version-gated `set` | ❌ **absent** — `ResourceStateStore.set` is an unconditional upsert (`stores/types.ts:550-551`) |

**Why tier 1 doesn't reach:** that promise chain lives in a `Map` on the `ResourceRegistry`, and
a registry is built **per execution** (`createExecutionContext.ts:1649`, `:1664`, `:1682`). Two
writers in one execution share a chain and serialize correctly; two writers in two executions
share nothing, both read `pending`, and both write `in_progress`. `claim` inherits this because
its whole guard runs inside `candidateRef.updateState` (`resource-backed.ts:270-308`).

That is not a hypothesis — it is precisely §5's measurements ("two drains both settle one task";
"`attempts` rolls 1 → 0", a textbook lost update). **So Decision 1 is not "should we add CAS to a
store." It is "should we finish the two-tier pattern scope state already implements"** — which
makes the blast radius a known quantity rather than an estimate.

**Three code comments assert the opposite, and they are how the wrong reading keeps recurring**
(the description notes "four wrong readings already paid"). All three are stale and all three must
be corrected by whoever lands FIX-981 — leaving them is how a fifth reading happens:

- `task-board/blocks/claim-task.ts:12-14` — *"The substrate's CAS retry inside `collection.claim`
  guarantees exactly-once dispatch under contention."* **There is no CAS and no retry anywhere in
  that path.** False, full stop.
- `tasks/collection/resource-backed.ts:6-7, 22-26` — *"Per-task CAS rides the underlying
  ResourceRef.updateState contract"* … *"Result: at most one worker claims any given task."*
  **True within one execution, false across two** — and the sentence does not say which.
- **`TaskDispatcher`'s header** — same false substrate-CAS claim, found in review. A third site in
  one doc-debt class.

#### The contract as it stands

`ResourceStateStore` (`packages/engine/src/stores/types.ts:546-570`) has **six** methods —
`get`, `set`, `delete`, `getAll`, `getByPrefix`, `deleteAll`. **No conditional verb, no version,
no ETag, no compare.** `set` is documented "Creates or overwrites."

It is a **published** interface (exported from `packages/engine/src/index.ts`), and both external
store packages consume it as `import type { ResourceStateStore } from "@flow-state-dev/engine"`.
So a **required** new method is a breaking change across a package boundary for any third-party
adapter. An **optional** one is not.

#### Option (a) — feasibility · **the filesystem adapter cannot do this today (corrected)**

**Exactly four adapters** — the description's count is correct — in-memory, filesystem, SQLite,
Postgres.

> **⚠ This reverses a conclusion this document previously chose to keep.** An earlier draft said
> *"none of them is incapable of a conditional write… filesystem is the cost centre, not a
> blocker,"* reasoning that its atomic `link()`/`EEXIST` primitive made CAS buildable. **That was
> wrong, and it is the fourth mechanism claim in this document to fail on contact with the code** —
> a pattern worth carrying into FIX-981's spec, not just a correction to absorb. Having an atomic
> *create-if-absent* primitive is not the same as having a cross-process protocol for a
> *conditional update*.

**Verified — the filesystem adapter's concurrency safety is per-handle and per-process by design,
and its own docs say so:**

- `stores/filesystem/shared.ts:247-273` — the write lock is an in-memory `Map` created **per store
  handle**, and the comment is explicit: *"Per-id serialization so the read-check-write sequence
  below is atomic **within one process**."*
- `stores/filesystem/request-store.ts:86-91` — *"There is **NO inter-process locking** — running
  multiple processes against the same `rootDir` for the same request is not a supported topology.
  **Use SQLite or Postgres for any multi-process or production deployment.**"*
- The `ResourceStateStore` filesystem adapter is weaker still: write-temp-then-`rename` with **no
  lock at all** (`filesystem-resource-store.ts:376-382`). Atomic `rename` prevents **torn files**,
  not **lost updates** — two handles can both pass the same read/version check and overwrite each
  other.

**Note the shape: per-handle safety degrading to nothing across handles is the *same bug* as this
epic's central finding** — a third instance after `serializeResourceWrite` and the claim path. That
recurrence is itself the argument for fixing it at the durable boundary rather than adding another
local lock.

**Consequence, stated honestly: (a)'s feasibility and cost are not settled until one of these is
chosen** —

| Option for filesystem | Cost |
|---|---|
| A **named cross-process locking / transaction protocol** | Real design work, and in tension with the adapter's documented positioning (it explicitly points multi-process users at SQLite/Postgres) |
| **Exclude filesystem from durable boards** | No new protocol; durable boards require SQLite/Postgres |

**This sharpens (a); it does not change its direction.** The recommended shape *already* refuses
durable-board construction on an adapter lacking the verb, with a declared migration — **filesystem
simply becomes the first concrete member of that excluded set instead of a hypothetical one.**
Conditional writes remain addable, additively, reusing the precedent; what changes is that the
guarantee is general across *supporting* adapters rather than all four.

**One consequence the gate should price:** the filesystem store is positioned as the
single-process/dev store (its own disclaimer sends production and multi-process users to SQLite or
Postgres). If durable boards exclude it, **durable boards require SQLite or Postgres — including
locally.** That is a developer-experience cost, not a correctness one, but it is a real one and it
belongs in the gate's decision rather than in FIX-981's discovery.

**Two further epic-level consequences:**

- The **conformance suite** builds one store handle per test, so a contention case needs a
  "two handles, one backing" shape it does not have — and that shape is *meaningless* for
  in-memory, where two handles are two different stores. **A shape change, not a new case.**
- `ResourceStateStore` is **published** (exported from `packages/engine/src/index.ts`, consumed as
  a type by both external store packages), so a **required** new method breaks third-party
  adapters and an **optional** one does not — which is what the compatibility path turns on.

*Per-adapter mechanics and the suite's new shape are FIX-981's design work, routed to its
implementer notes rather than decided here.*

#### The two corrections that change the decision

**Correction 1 — (a)'s blast radius is in the wrong place in the description, and it is wider
than four adapters.** The store change is the small, mechanical part. The part that actually
delivers the guarantee is `updateState`, and **`updateState` returns `Promise<void>`** —
`packages/core/src/types/resource.ts:249` (`ResourceContext`) and `:309` (`ResourceRef`). It
**cannot report that an update did not apply.** A correct `claim` needs exactly that signal. And
`updateState` is referenced by **47 non-test references across 13 source files in 6 packages**
(`core`, `engine`, `orchestration`, `patterns`, `memory`, `thought-fabric-core`). *That* is the
honest blast radius of a signature change — not "engine store types + four adapters + the
conformance suite", which points one layer too low.

**Correction 2 — the cost is smaller than the description implies, but it is *not* "non-breaking".**
An earlier draft of this section claimed (a) "need not be breaking at *any* layer." **Round 2
(Codex) refuted that and it is corrected here.** Making the store verb optional preserves
TypeScript **source** compatibility; it does **not** preserve **behavioral** compatibility. A
third-party `ResourceStateStore` without the verb backs a durable board that *worked before the
upgrade*, and after it that board either fails at construction or runs without the guarantee.
Either way something observable changed. See "the compatibility path" below, where this is
decided rather than glossed.

What remains true — and it is still the thing that lowers the price — is that every step can be
**additive at the type level**, so no existing caller is forced to change:

- an **optional** `compareAndSet` (or `setIfMatch`) on `ResourceStateStore` — third-party
  adapters keep compiling; the engine feature-detects it;
- a **new sibling** ref method (say `tryUpdateState`, returning an applied/declined outcome)
  rather than a change to `updateState` — so all 47 references and 13 files stay untouched;
- `claim` and the cap-admission check switch to the new method; nothing else has to.

**So (a) is "largest surface touched" but not "breaking",** and those two were being conflated.
That materially changes the price.

#### Option (b) — priced honestly, and it has a structural problem

(b) is: never let two executions contend for one board, via queue-level dedup. No store change;
a guarantee that "holds only for work routed through the queue." **What that qualifier costs,
concretely — who reaches a board *without* the queue today:**

1. **`taskTools` — the model-facing tool surface.** Eight tools
   (`skills/task-tools-capability.ts:560-585`) a generator holds via `uses: [taskTools]`:
   `assignTask`, `completeTask`, `failTask`, `cancelTask`, `updateTask` and siblings. **An LLM
   calling `completeTask` is not "work routed through the queue"** — and the capability
   *explicitly* supports pointing at a **shared** board. In an agent framework this is the normal
   path, not an edge case.
2. **The default `taskTools` instance is UNCAPPED** (`:588-600`, FIX-931) — no `maxEnqueuedTasks` /
   `maxTotalTasks`. **(b) cannot fix that at all**, independent of dispatch topology.
3. **`reclaim()`** flips `in_progress → pending` (`resource-backed.ts:406-450`) outside any
   dispatcher; pattern code also calls `collection.*` directly.

**Is (b) sufficient for Conductor M2 — the concrete consumer?** *Not reliably.* M2 runs each issue
as a durable task on a **shared** board and its phases are agents, so the moment a phase agent
holding `taskTools` writes to that board, (b)'s dedup is bypassed. Its acceptance criterion that a
crashed worker's issue returns to the queue unaided runs through `reclaim`, also outside the queue.

**And (b) has a disqualifying sequencing problem: the queue it depends on is milestone 3.** So (b)
means **M1's guarantee is delivered by M3's machinery** — inverting the stated sequence or
collapsing M1 into M3. A restructuring of two milestones, which is precisely why this could not be
left inside one issue's spec.

#### Option (c) — neither

(c) blocks the epic. But **Conductor M2 is blocked on this epic**, so (c) relocates the block
upward and leaves §5's measured defects shipped. (c) is right only if the objective isn't worth
pursuing — the gate's question, not this decision's.

#### Clause 1 needs **two** mechanisms — split into 1a and 1b

**An earlier draft covered one and implied it covered both — the most consequential error in this
document**, since it would have left §5's *first measured row* unfixed while appearing to address
it. Verified in code:

| Clause | Contended thing | Per-key CAS enough? |
|---|---|---|
| **1a** — two executions cannot both **win one task** | one task's row | **Yes.** Same key, so a version guard discriminates. |
| **1b** — two executions cannot both **admit past a creation cap** | the collection's **cardinality** | **No.** Different task IDs are *different keys*; two CAS writes to different keys both succeed. |

**Verified — `ResourceCollectionRef.create()`, `packages/engine/src/context/resource-registry.ts:981-1004`:**

```ts
const resources = options.readResources();          // :981  per-execution cache
if (!exists) {
  const currentCount = countInstances(nsConfig.pattern, resources);   // :993  counted locally
  if (nsConfig.maxInstances !== undefined && currentCount >= nsConfig.maxInstances) { … }
}
```

Two compounding reasons per-key CAS cannot fix this, both confirmed:

1. **Different keys never contend.** A version guard on `tasks/t1` has nothing to say about
   `tasks/t2`, and cardinality is a property of neither row.
2. **The count comes from the per-execution cache.** `options.readResources()` is the
   in-request view, so execution B cannot see the row execution A just created — and unlike
   `set`/`patchState`/`updateState` (`:685`, `:699`, `:711`), **the `create` path is not wrapped
   in `serializeResourceWrite` at all.**

**That is exactly §5's row 1 — 8 rows against `maxInstances: 4`.** Two executions, four admits
each.

##### 1a — ownership · **direction: yes, additively, reusing existing precedent; no breaking change**

> **The direction, which is all this epic decides:** give resource state a conditional write at
> the durable boundary, added **additively** so no existing caller and no third-party adapter is
> forced to change, and reuse the scope-store precedent rather than inventing a parallel
> mechanism. **The shape is FIX-981's to design** (see the open fork below).

##### Scope — stated as a principle, because enumerating paths has failed three times

> ### Every **ownership-sensitive write** must be fenced at the durable boundary — not only `claim` and settlement.
>
> An ownership-sensitive write is any write that can change, or can overwrite, the fields that
> establish who owns a task — `attempts`, `status`, `leaseUntil`, `assignee` — **including a write
> whose *intent* is some other field but which persists the whole task.**

**Why a principle and not a longer list.** This axis has now been extended three times: round 3
added settlement, round 8 added `taskTools`, round 10 added `patchRef`. **Enumerating paths and
being wrong about the next one is the same over-reach as the mechanism claims, one axis over.** So
the epic states the invariant, and **exhaustive enumeration of the paths that carry it is a required
deliverable of FIX-981's spec**, done against the code by someone reading it.

**Known instances — *known-so-far, explicitly not exhaustive*.** Counted while verifying `patchRef`,
and the count is **higher than the four previously named**:

| # | Path | Fenced by 1a as scoped? |
|---|---|---|
| 1 | `claim` → `updateState` | yes |
| 2–4 | `complete` · `fail` (both branches) · `cancel` → `transitionRef` | yes |
| 5–8 | **`block` · `unblock` · `awaitReview` · `resumeFromReview` → `transitionRef`** | **only if 1a is read as "all of `transitionRef`", not "claim + settlement"** — each mutates `status`, and `resumeFromReview`/`unblock` also clear or reset lease state. `unblock` is additionally **FIX-957's Decision 4 surface**. |
| 9–13 | **`setAssignee` · `setPriority` · `addLabel` · `removeLabel` · `patchMetadata` → `patchRef`** | **NO — all five** |
| 14 | `reclaim` → `updateState` | **FIX-978's**, per Decision 0 |
| 15 | `addTask`/`addTasks` → `collection.create` | 1b's path, not ownership |

**Verified — `patchRef` (`resource-backed.ts:215-239`) takes no guard parameter at all** and does
`applyTransition(task, update, now())` inside `ref.updateState`, returning **the whole task**. So it
reads the stale execution mirror and **rewrites every field**: a reclaimed attempt-1 worker calling
any of those five overwrites attempt 2's `attempts` and `status`, undoing the ownership guarantee
**even when claim and settlement are fenced.**

**Two things that undercount if you only look at `assignTask`:**

- **It is all five `patchRef` methods, not just `setAssignee`.** Intent is irrelevant — the write is
  whole-task. `addLabel` matters most in practice: FIX-980's A1 identifies
  `patterns/src/supervisor/blocks/label-failed-reviews.ts` as a **live** post-drain block that
  labels terminal tasks, so it is a real caller on this path.
- **Rows 5–8 sit in the ambiguity of the phrase "claim and settlement."** They are neither, and they
  mutate `status`. Reading 1a as "route `transitionRef` through the fenced write" covers them;
  reading it as "claim + settlement" does not. **1a means the former.**

**Coordinate with FIX-976, do not collide.** FIX-976 (under FIX-980) is already *"`assignTask`
silently rewrites a terminal task's assignee"* — **the same path from the honesty angle**, and
FIX-980's A1 constrains any guard there to be **per-operation, never installed on the shared patch
helper** (a blanket guard would break the live labelling block). **FIX-981 must align with A1 rather
than install its own helper-level guard**, and whichever lands first must not leave one behind.

**So 1a is the larger half of M1, not a narrow store change.**

**Constraint — compose with FIX-951, never replace it.** `ifAllowed` / `expectAttempt` /
`TransitionDeclined` / `shouldDeclineTransition` are the shipped, merged **in-request** half of
this guard, and the logic is *correct*: `attemptOwnsTask` is
`task.attempts === expectAttempt && ATTEMPT_OWNED_STATUSES.has(task.status)`
(`internal.ts:107-109`). What fails is the *read* feeding it — `current` comes from the calling
execution's own mirror, so a displaced worker evaluates a correct guard against a stale view. **The
guard is starved of a fresh read, not wrong.** A design that removes or reimplements those rules
has misread this direction.

> **⚠ Open fork — there is no version to gate on, so "mirror `runWithCAS`" is a direction, not a
> design. This is FIX-981's first design decision.**
>
> `ResourceStateStore.get()` returns a bare `JsonObject` (`stores/types.ts:548`) and resource refs
> carry **no version at all** — `packages/core/src/types/resource.ts` contains zero occurrences of
> "version". But `runWithCAS` requires an initial `expectedVersion` and a `currentVersion` on
> conflict (`cas.ts:119-175`), supplied for scope state by `StateContainer.getVersion()`
> (`state-container.ts:54-78`) over records that *carry* a version. **Resource state has no such
> representation.**
>
> Three shapes could supply one, and **they are different public and adapter contracts** — not
> variants of one design:
>
> | Shape | Nature of the change |
> |---|---|
> | **Versioned read / envelope** | `get` returns value + version; every adapter stores and returns it |
> | **Expected-value CAS** | compare against the prior value rather than a version; no version to store |
> | **Atomic mutate verb** | the store applies a caller-supplied transform; no version crosses the boundary |
>
> **Nothing in this document picks one.** Whoever specs FIX-981 does, and states the adapter and
> public-contract consequences. Earlier wording implying the shape was settled is withdrawn.

**Constraint — the reclaim write is FIX-978's, not FIX-981's.** `reclaim()` also writes through an
unconditional `updateState` (`resource-backed.ts:406-450`), but reclamation belongs to FIX-978
under FIX-980 (Decision 0). **FIX-981 ships the primitive and converts claim + settlement; FIX-978
converts the reclaim write.** Stated because otherwise both sides assume the other did it, and the
gap is invisible until two workers race across a reclaim.

##### 1b — cap admission · **constraint only; this epic names no mechanism**

> ### ⛔ FIX-981's spec must **not** include 1b implementation until **OQ-D** is decided.
>
> FIX-981 is the only active issue, so an implementer reading this section will otherwise assume
> cap work is in scope. **It may already be FIX-957's** (OQ-D). Build 1a; leave 1b's mechanism
> unbuilt and its decision cited. **If 1b is deferred, §1's completion criterion 1b is relaxed
> away** and the epic claims no cap guarantee. This is precisely the "built twice" failure OQ-D
> exists to prevent.

**The binding constraint, and the only thing this epic decides about 1b:**

> ### No mechanism may claim a bound it does not enforce.
>
> Either **name a mechanism that enforces a hard maximum on the number of concurrent admitters**,
> or **stop calling the result bounded** and say plainly that it gives *narrowed but unbounded*
> overshoot. A guarantee row no candidate mechanism satisfies is worse than an honest
> "unbounded" — it reads as safety that isn't there.

**Why the obvious answer fails.** An authoritative read immediately before the decision narrows
*when* the race can happen; it bounds *nothing about how much*. Any number of executions can each
observe remaining capacity before any of them writes, and because the writes go to **distinct
keys** none of them conflicts. **Overshoot therefore scales with concurrency** — which is precisely
the failure mode that ruled out the weaker mirror-only check, merely with a tighter window.

**This document names no mechanism for 1b.** Doing so is what produced three rounds of
mechanism-level churn; it is FIX-981's (or FIX-957's — OQ-D) design work, under the constraint
above.

> **⚠ Cross-issue finding for the owner — FIX-957's Decision 3 carries the same defect, and
> nothing here edits FIX-957.**
>
> FIX-957's spec chose the same authoritative-re-read mechanism and described the result as *"a
> small, bounded overshoot."* By the argument above **that mechanism does not bound** — and
> FIX-957's own spec makes the case against itself, having rejected the mirror-only check because
> *"the overshoot grows with the number of concurrent writers rather than staying within a few
> tasks."* The re-read shrinks the window, not the admitter count.
>
> **Consequence: OQ-D's "inherit FIX-957's answer" is now conditional on FIX-957's bound being
> real.** If it is not, neither issue has a bounded-cap mechanism and the gate is choosing between
> exact arbitration and an honest unbounded statement. **Raised for the owner to route to FIX-957;
> not edited here.**

**Two ceilings, not one — and they are easy to conflate.** `maxInstances` is a resource-registry
**live-capacity** limit; `maxTotalTasks` / `maxEnqueuedTasks` are task-layer ceilings. FIX-957's
spec flags that confusing them *"has already cost a cycle"*, so §5's `maxInstances` row and the
task-cap work are related but not the same target.

**Required verification either way: a distinct-ID contention check** — two executions creating
*different* task IDs concurrently against one capped collection. The harness extension in Decision 4
would **not** catch this by itself, because both writes succeed; the failure shows only in the final
row count.

> **FIX-981 inherits *one* contention harness with three assertions, not two half-specified
> checks.** Same two-executions-over-one-board setup (Decision 4), asserting:
>
> | # | Assertion | Guards |
> |---|---|---|
> | 1 | **only one `claim()` succeeds / only one worker starts** — same-ID contention | 1a · the exclusivity boundary |
> | 2 | a **stale** owner's settlement is **rejected** | 1a · post-reclaim ownership |
> | 3 | the distinct-ID cap behaviour **OQ-A actually selected** — never asserting a maximum the chosen mechanism does not enforce | 1b (skipped entirely if 1b is deferred) |
>
> **Assertion 1 is the one a passing-but-broken implementation escapes without** — see §1's
> completion criterion for why settlement-only assertions do not detect the violation.

##### The compatibility path — decided, because "non-breaking" was wrong

An existing third-party adapter without the verb backs a durable board that worked before the
upgrade. Two honest options, and this document picks one:

- **(i) Refuse to construct a *durable* board on an adapter lacking the verb** — loud, named,
  at construction time. **Recommended.**
- **(ii) Degrade to today's unconditional writes with a loud named warning.** Rejected as the
  default: a durable board that *appears* to have claim safety and does not is precisely the
  "reports success for something that didn't happen" defect FIX-980's epic exists to eliminate.
  Shipping it here would inflict this epic's own defect shape with this epic's own fix.

**So: a declared, documented adapter migration**, not a silent behavior change and not a claim of
non-breakingness. In-request and non-durable boards are untouched — only the durable arm requires
the verb. State it in the changeset and the adapter docs (BP-030's "reject the removed/absent
shape loudly", BP-035's "test the off state").

##### Coarse locks are rejected — explicitly, here, not in a child spec

If M1 answers 1a or 1b with a **global board lock**, throughput collapses under parallel
Conductor — the opposite of why this epic exists. The house pattern is already the right one and
is two-tier for exactly this reason: **in-process FIFO queueing per record + per-record
version-gated CAS at the durable boundary** (`scope-lock.ts:1-5`). Per-record, not per-board.

**Binding on every issue here:** no issue may serialize a whole board to obtain claim safety. A
single-key cardinality counter (1b's first row) is a coarse lock by another name and falls under
this rejection too — a single-key counter serialises every create against one row.

##### Why (a) over (b), and what refusing costs

**Why (a) over (b), one line each:** (b)'s guarantee is bypassed by the model-facing tool surface
that is *the* normal way boards get mutated here; (b) cannot address the uncapped default board
at all; and (b) needs M3's queue to deliver M1's guarantee.

**What the gate is asked to accept:** surface area across six packages (additive at the type
level); a conformance-suite shape change; a feature-detected capability with a construction-time
failure mode for durable boards on unsupporting adapters; a **declared adapter migration** rather
than a free upgrade; and — newly concrete — **either a cross-process protocol for the filesystem
adapter or its exclusion from durable boards**, which if excluded means **durable boards require
SQLite or Postgres, including in local dev**.

**If the gate refuses the store change**, the honest consequence is not (b) — it is that **M1 and
M3 merge** and the epic's sequence is restated, because (b) can only be built where the queue is.

*Recorded in §4 as **OQ-A**, because these are recommendations and the human decides. When the
gate answers, this heading changes to **DECIDED** and the rejected options stay recorded with
their reasons, so a later reader does not re-open a settled fork.*

### Hazard — `taskTools` is the path guarantees escape through

**Promoted to a named hazard because it has now broken an assumption in this document three
separate times**, each discovered independently: it bypasses option (b)'s dedup, its default
instance is **uncapped** (`task-tools-capability.ts:588-600`, FIX-931), and — found in review —
its settlement tools carry **no ownership token at all**:

```ts
completeTask → withTask(ctx, id, (c) => c.complete(input.taskId, input.output))   // :415-423
failTask     → withTask(ctx, id, (c) => c.fail(input.taskId, input.error))        // :425-433
```

**No third argument, so no `expectAttempt` and no `ifAllowed`.** That means making `transitionRef`
conditional does **not** fence the model-facing settlement path — and CAS arguably makes it worse:
a conflicting write refreshes to the *current* row (attempt 2, `in_progress`), the guardless
transition is legal from there, and the stale attempt-1 tool call **settles the new owner's task**.
Fresh state is exactly what lets it through.

> **The constraint, stated once, for the whole set:**
> **Any guarantee not enforced on the `taskTools` path is not enforced** — that path is the normal
> way boards get mutated in an agent framework, not an edge case.
>
> **Concretely: a detached worker's tool context must carry an attempt or owner token**, so its
> settlement calls are fenced the way `dispatchAndExecuteBlock` and `recordResult` already fence
> theirs (`expectAttempt: claimed.attempts`, `dispatch-and-execute.ts:186,193`). Whoever owns the
> detached worker's context owns this; the mechanism is theirs to design.

This is worth more than the three places it was separately rediscovered, which is why those now
point here.

### Decision 2 — how board **lifetime** and collection **scope** compose (they are two axes, not one) **(rewritten — the previous version was a category error)**

**The previous version was not executable.** It said *"FIX-957 ships board lifetimes
`block | request`; widen that option with `session`/`user`/`org`."* **You cannot widen a lifetime
enum with scope values — they are orthogonal axes** — and the durable rungs are not ours to add,
because they already ship.

| Axis | Controls | Values today | Where |
|---|---|---|---|
| **Backing** — *the lifetime lever* | how long the board lives | `request` \| `resource` \| `sequencer` \| `factory` | `TaskBoardBacking`, `task-board/index.ts:442` |
| **Scope** — *the identity partition* | **which** durable partition holds it | `session` \| `user` \| `org` | required on `DefineTaskCollectionOptions` (`define-task-collection.ts:65`); `core/src/types/resource.ts:24` |

The docs say it outright — a section titled *"Backings set the lifetime"*
(`apps/docs/guides/board-lifecycle.md:122-137`) and then **"The scope lives on the collection, not
the board"** (`:172-173`). `scope` cannot express `block` vs `request` at all; those are the
`sequencer` vs `request` **backings**. And **no `lifetime` field exists** anywhere in
`packages/orchestration/src` — verified. **The durable board this epic secures is backing
`resource` + a scoped collection, and both halves already ship** — but see 2.b: `resource` is
**not** the only backing that can be durable.

**FIX-957 also *rejected* the shape the old decision assumed.** Its spec
([#954](https://github.com/fixpoint-labs/flow-state-dev/pull/954)) Decision 1 is one library
option accepting a `defineTaskCollection` result — **no lifetime enum at all** — and it explicitly
rejected a `boardScope: "turn" | "session" | "user" | "org"` enum because *"it invents a parallel
scope vocabulary beside `defineTaskCollection`'s, which means two ways to say 'a durable task
board' and two places for the definition to drift."* **That is the same objection this decision
existed to raise, already sustained — so the old wording told this epic to build what FIX-957
rejected with reasons.** Treat the spec as canonical and the description's paraphrase as stale.

**The decision.** "Extend, never fork" survives, but the axis being extended is **`backing`**, and
the durable rungs come from `scope`, which exists. Binding on every issue here:

1. **Do not add a scope vocabulary.** `session`/`user`/`org` already exist on
   `defineTaskCollection`. An issue that finds itself defining a second way to say "which
   durable partition" has found a **conflict to surface**, not a design choice — bring it here.
2. **The durable board this epic secures is backing `resource` + a scoped collection.** That is
   the shape FIX-982 and FIX-981 build on — **and per 2.b it is not the only durable shape, so do
   not write "`resource` is the durable backing" anywhere.**
3. **If a new `lifetime` option appears, it replaces or wraps `backing`** — and whoever lands it
   says what happens to the four existing backing values.
4. **Watch `FIX-960`, not FIX-957, for the collision on this axis.** FIX-960 renames the
   `sequencer` backing to `state`, and FIX-957's spec recommends landing it **first** as a
   standalone mechanical rename because it touches the same files FIX-957's cap work rewrites.
   **Any issue here that reads or writes a backing value must expect `sequencer` → `state`.**
   This is the live coordination point on the lifetime axis; the enum-widening one never was.
5. **Still no dependency in either direction.** Nothing here waits on FIX-957 and FIX-957 does
   not wait on this — but for a different reason than the old text gave: not "widening is
   additive", rather **the durable rungs are already shipped, so there is nothing to wait for.**

#### 2.b — `factory`-backed boards are a **second** durable path, and detached jobs do not cover it

**`resource` is not the only backing that can be durable, and this document had been implying it
was.** A caller using the documented `(ctx) => TaskCollectionRef` factory path to resolve an
externally-managed durable collection gets **`backing: "factory"`**, not `"resource"`
(`task-board/index.ts:911-923`). Binding FIX-981 and FIX-982 to the `resource` discriminant alone
therefore leaves a **supported durable shape outside claim-safety and detached-executor semantics.**

**Why it cannot simply be included: `factory` is opaque by design.** The type's own doc calls it
**"caller-opaque"** and the capability *"defer[s] entirely to the user's factory"*
(`index.ts:436-441`, `:468-474`). The framework does not introspect what a factory returns, so it
**cannot verify** that a factory-supplied ref is durable, is backed by a store with a conditional
write, or is even the same collection across executions.

**The decision — detached-job guarantees attach only to a board whose durability the framework can
verify:**

1. **`factory`-backed boards are out of scope for detached jobs by default.** Not "broken" — the
   framework cannot make a guarantee about a ref it cannot inspect, and pretending otherwise would
   be exactly the "reports a guarantee it does not have" defect this set exists to remove.
2. **Supporting them requires advertising *two* things, not one — fencing capability is
   insufficient on its own.** An earlier version of this remedy asked only for conditional-write
   capability. **That does not carry the guarantee**, and the reason is the durability caveat stated
   just above: a factory that returns a **fresh in-memory but fully CAS-capable** ref per execution
   **satisfies a fencing advertisement completely**, while the detached executor resolves a
   *different, empty* collection — and the task is stranded with every fence intact. Fencing answers
   "can this write be made conditional"; it says nothing about "is this the same collection."

   So a factory-backed board is supportable only if the ref advertises **both**:

   | | Contract | Answers |
   |---|---|---|
   | **(a)** | **conditional-write capability** | can ownership writes be fenced? |
   | **(b)** | **stable re-resolution / durability identity** | will a later, independent execution resolve *the same* durable collection? |

   **(b) is the load-bearing one and it is new.** Without it the epic would be certifying a board it
   cannot re-find. **Whether to offer this at all, and how a ref advertises either contract, is
   FIX-981's design decision**, tied to 1a's open fork — a ref that cannot advertise cannot be
   fenced, and one that cannot prove identity cannot be trusted to persist.

   **Advertisement-for-fencing-alone is explicitly rejected.** If (b) is not offered, factory-backed
   boards stay **unsupported for detached jobs** — which remains a perfectly defensible outcome.
3. **Binding on FIX-981 and FIX-982: state explicitly which backings your guarantee covers.**
   Neither may silently treat `backing: "resource"` as a proxy for "durable", and a durable board
   arriving via `factory` must get a **named** outcome — supported-because-it-advertised, or
   refused at construction the way an unsupporting adapter is (Decision 1's compatibility path).

### Decision 3 — allocating the scope that moved in from FIX-957

**DECIDED, and this allocation is the reason this section exists.** On 2026-07-29 the durable
half of FIX-957 was factored into this epic. **FIX-957 retains the in-request half; durable scope
and backing already ship, and this epic's job is to make them *safe*** — not to add them (see
Decision 2, and note there is no `lifetime` enum). **Seven items moved.** The filed issues each
carry a *"to be confirmed in the epic-spec"* marker pointing here — so leaving any row
unallocated re-creates the vacuum this document exists to remove.

The cut FIX-957 was split along: **every concurrency consequence it had accumulated needs two
executions over one board, and in-request there is only ever one.** That is the test applied
below.

| # | Moved-in item | Owner | Why |
|---|---|---|---|
| 1 | `session` / `user` / `org` board lifetimes | **nothing to build — already shipped** | **Corrected in round 1.** These are `ResourceScope` values on `defineTaskCollection`, shipped today (`define-task-collection.ts:65`, `core/src/types/resource.ts:24`). This epic **consumes** them; it does not add them. What FIX-981 owns is making a board *safe* at those scopes, which is 1a/1b — not the scopes themselves. See Decision 2. |
| 2 | FIX-957's former **Decision 3** (cap enforcement on durable storage) **+ its five consequences** | **⚠️ CONFLICT — surfaced, not resolved** | **This document cannot allocate this row.** FIX-957's spec PR [#954](https://github.com/fixpoint-labs/flow-state-dev/pull/954) carries cap enforcement on the durable backing as **its own Decision 3, already decided** (backing-agnostic check, durable backing accepts cap options, authoritative re-read, described there as bounded overshoot — see 1b's cross-issue finding). The epic description says the work moved *here*. **Both cannot own it.** See 2.a below. |
| 3 | The unresolved **(a)/(b) claim-recovery mechanism** | **Decision 1, this document** | Not deferred to a spec — it *is* Decision 1, settled below rather than inside one issue, because option (b) is FIX-982's territory and option (a) is FIX-981's. |
| 4 | The **durable collection-identity seam** | **FIX-981 (M1)** | A durable board must be re-findable across executions before anything can contend for it. It is a precondition of M1's own tests, not separable work. |
| 5 | The **mandatory hydration memo** | **FIX-981 (M1)** | Same reason: hydrating a durable board is how the second execution reaches the first one's task. M1 needs it to exist in order to demonstrate the race at all. |
| 6 | The **pre-drain `reclaim()`** | **FIX-978 / FIX-980 — not this epic** | *Resolved below.* |
| 7 | **`flowIsolation` forwarding** | **FIX-982 (M3)** | *Resolved below.* |

#### 2.a — the cap-enforcement ownership conflict (**needs a human; do not let two issues build it**)

FIX-957's spec and this epic's description disagree about who owns cap enforcement on the durable backing:

- **FIX-957's spec (#954), Decision 3 — decided:** *"The creation caps move to one
  backing-agnostic check that both backings call; the durable backing accepts cap options like the
  other one does, and reads an authoritative count from the collection immediately before each
  check."* Its §7 even deletes the paragraph that justified why caps *can't* apply to the durable
  backing. Its non-goals exclude *"detached/background jobs that run outside any request
  (FIX-939)"* — but **not** the caps.
- **This epic's description:** lists *"the whole of FIX-957's former Decision 3 (cap enforcement
  on durable storage) and its five consequences"* among the seven items that moved here.

**The most likely reading is that the description is stale** — FIX-957's spec was *"revised after
review round 1"*, and its Decision 3 survived that revision as a live, decided item. If so, 1b's
cap work is largely **FIX-957's**, and FIX-939 inherits its outcome the way it inherits FIX-978's.

**Recorded as OQ-D. Not resolved here, because resolving it by fiat is how the same guard gets
built twice** — the failure FIX-957's own focus practice 1 warns about. What FIX-981 must not do
is start cap work before this is answered.

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

#### 3.b — `flowIsolation` is **re-derived**, not forwarded — and it is FIX-982's (**M3**)

**Owner: FIX-982 — and there is nothing to "forward".** `flowIsolation` is declared **only on
resource/collection definitions** (`core/src/types/resource.ts:186`; `resource-collection.ts:59`),
with flow-level `isolateUserState` / `isolateOrgState` defaults (`types/flow.ts:489-499`) as the
only other input. **It appears nowhere on a request**, and `createExecutionContext` already
*recomputes* it from config + flow defaults + identity (`:867-880`, via
`scope-keys.ts:140-160`). **So carrying a copy on the task would be a bug** — it would diverge
from the definition and from the shared-prefix conflict rule that *throws* when collections
disagree (`createExecutionContext.ts:818-861`).

**What the executor must load to re-derive** — recorded because FIX-982 would otherwise discover
it late: (1) the **full config map** for that scope, since canonicalization and the prefix check
are whole-map decisions; (2) the **flow definition**, for `flow.kind` and the isolation defaults;
(3) the **identity fields** below.

**Carry the *bare* identity fields, never a derived key.** An earlier draft said to carry the
"tenant-namespaced session key" — **that is wrong and would strand the board.**
`createExecutionContext` derives the storage key from `(sessionId, tenantId)`, so passing an
already-derived key as `sessionId` either **double-prefixes** it or **loses the tenant binding** —
either way resolving a *different* session partition than the one holding the board.

**The minimal travel set: `flowKind` + bare `sessionId` + `tenantId` + `userId` / `orgId`, as
separate fields.** Conveniently this is exactly the shape `DispatchEnvelope` already carries
(`engine/src/transports/dispatcher.ts:16-26`) — a shipped type FIX-982 can reuse rather than invent
an envelope beside. Everything else the executor re-derives from the definitions, which is much
smaller than "forward the isolation settings."

**No new issue is needed for 3.a or 3.b.** Row 2 is the only unowned one (OQ-D).

### Decision 4 — the evidence branch is gone; the numbers live here now

**The `spike/durable-board-claims` branch is not on `origin`** — verified, 253 remote heads, no
`spike/*` ref of any kind. FIX-939's description cites it as *"do not delete"* and rests the
premise correction on it. **The measured numbers survive as text** (§5, treat as established); the
**re-runnable rig does not**.

**But that costs less than first stated: the harness FIX-981 needs largely exists.**
`integration-tests/src/scenarios/task-board-drain-containment.test.ts` already proves a board
property through full `runAction` composition via `testFlow` — the altitude FIX-980's Decision 5
made the bar — and `testFlow`'s seeding is **deliberately idempotent so multiple calls can share
one store registry** (`testing/src/test-utilities/testFlow.ts:80-82`), which *is* the
two-executions-over-one-board setup.

**So the gap is "resource-backed + two concurrent executions" — an extension, not a new harness
species. FIX-981 must not budget a spike redo.** It should budget the extension plus 1b's
**distinct-ID contention test**, which that shape does not cover. Cite §5 rather than re-deriving;
build a new rig only for a measurement §5 lacks.

**Why the numbers live here.** A Linear description is unversioned, unreviewable, and not
diffable — a poor home for the evidence an epic's premise rests on. §5 is reviewed, versioned, and
reachable from every issue. **This epic also inherits FIX-980's persisted-surface rule:** any issue
claiming it made progress or failure visible **states which persisted surface carries it**. A
`transient: true` trace item is not observability.

### Decision 5 — M3's executor needs a **named wake source**; it must not default to polling

§1 puts task-events-as-dispatch **out** of scope (FIX-825 / Conductor M3). But an in-request worker
wakes on `task-change` items, and **outside a request that stream is gone** — so FIX-982's executor
has no named wake source, and the default in that vacuum is **store polling, chosen by omission**.
Nobody would write that down; it would simply appear.

**Binding: FIX-982's spec must name its wake model explicitly**, from these, and state the cost:

| Model | Notes |
|---|---|
| **Event-driven** (`task-change` → dispatch) | The eventual shape, but it *is* FIX-825 / Conductor M3, which §1 excludes. Not available to M3 without pulling that in. |
| **Schedule tick** | **Not the cheap option it first appeared.** **FSD supplies no scheduler loop** — *"The host owns the actual scheduler… The framework does not run a cron daemon, retry queue, or scheduler loop"* (`docs/architecture/scheduled-actions.md:15-19`). So this needs an **externally configured scheduler** *plus* a **new mapping from each beat to pending board work**. |
| **Native queue delivery** (`@flow-state-dev/bullmq`) | **Not the cheap zero-polling path it appeared — corrected.** BullMQ does fire jobs natively (`claimDue` returns `[]` for that reason, `bullmq/src/schedule-index.ts:5,23`), but **pending tasks do not wake merely because BullMQ is installed**: repeatable jobs exist only after an explicit **schedule-row `upsert`** (`:39-40`), and a flow job is enqueued only when a caller invokes **`dispatch`** (`bullmq/src/dispatcher.ts:36`). **Neither observes task-board admission or reclamation.** So this needs a **board-to-queue producer that does not exist yet**, and it carries a **dual-write hazard**: a crash between the store write and the enqueue strands the task with nothing to wake it — so it also needs a recovery mechanism (outbox or reconciliation pass). Plus the package and its Redis infrastructure. **M3 transport only** — the board stays the work registry. |
| **Liveness-triggered** | Hook onto FIX-978's reclaim/sweeper pass. Couples M3's wake to FIX-978's cadence — acceptable, but it makes the dependency tighter than "consume the outcome". |
| **Bounded poll** | Legitimate *if declared*: state the interval, the scan cost, and how it behaves with an idle board. Not legitimate as a silent default. |

**Reuse `ScheduleIndex.claimDue`'s loop *shape*, never its contract.** It advances schedule-index
rows under a documented **at-most-once** guarantee (`scheduled/src/scheduleIndex.ts:14-17`) — a
dispatch that fails after its row advances is dropped. **This substrate is at-least-once with
reclaim** (§1). The shapes rhyme; the delivery semantics are opposites, and they do not come along
for free.

**The point of this decision is not to pick — it is to forbid the accidental choice.** An executor
whose wake source is an unstated poll is how a "durable job substrate" quietly becomes a busy
loop against the store.

### Reuse seams — cite these, or say why not

**Binding on every issue here: build on the
named seam or state in your spec why it doesn't fit.**

| Seam | Where | Who should reuse it |
|---|---|---|
| **CAS**: `runWithCAS`, version-gated `set(id, value, expectedVersion)`, `DeltaStoreOps` capability advertisement | `engine/src/stores/cas.ts:119-175`, `stores/types.ts:181-272` | **FIX-981** — the precedent to reuse rather than invent beside. **But note: resource state has no version to gate on**, so this is a direction, not a drop-in — see 1a's open fork. |
| **Two-tier dispatch**: in-process FIFO queue + CAS at the durable boundary | `engine/src/stores/scope-lock.ts:1-5` | **FIX-981** — the architecture being completed, and the reason coarse locks are rejected. |
| **Liveness**: `LeaseStore` (4 adapters), `durability-sweeper`, interrupted-request detection | `engine/src/stores/{memory,filesystem}/lease-store.ts`, `store-{sqlite,postgres}/src/lease-store.ts`, `engine/src/durability/durability-sweeper.ts` | **FIX-978 / FIX-980** — align "gone vs slow" with these rather than inventing a parallel liveness notion. Ownership stays with FIX-980 (Decision 0). |
| **Out-of-request execution**: `FlowDispatcher` + `StreamBridge` | `engine/src/transports/dispatcher.ts` | **FIX-982** — structurally this seam at flow-run granularity. Its spec must state **compose vs rebuild**. |
| **Atomic claim-and-advance across executions**: `ScheduleIndex.claimDue` | `packages/scheduled/src/scheduleIndex.ts:48-61` | **FIX-981** (shape precedent) and **FIX-982** (wake model, Decision 5). Note its contract is *at-most-once*; tasks want at-least-once (§1). |
| **Cap/claim analysis**: `task-caps.ts` + `resource-backed.ts` | `orchestration/src/tasks/collection/task-caps.ts`, `.../resource-backed.ts` | **FIX-981** — build on this analysis rather than restating it. Note FIX-957's spec has already moved much of it (OQ-D). |
| **Board integration harness**: drain-containment scenario + `testFlow` shared-registry seeding | `integration-tests/src/scenarios/task-board-drain-containment.test.ts`, `testing/src/test-utilities/testFlow.ts:80-82` | **FIX-981** — extend, don't rebuild (Decision 4). |

---

## 3. Running index

Durable audit log of every PR under this epic. Refreshed from the coordinator's status table
each time this doc is updated. Empty columns mean not yet reached.

**Epic PR:** [#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993) · never merged, open for the life of the epic.

**Active set** — parented under FIX-939; runs an `issue-lifecycle` **once the objective gate passes**, and holds at `NEEDS_SPEC` until then (`orchestration.md` → Gates). Decision 1 is still awaiting that gate, so no lifecycle is dispatched yet:

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
| **FIX-957** | sub-issue of FIX-939 | Backlog | Retains the **in-request** half after the 2026-07-29 split; its durable half is Decision 3's seven rows. Durable scope/backing already ship, so there is no enum to coordinate — **the real coordination point is FIX-960** (`sequencer` → `state` backing rename). Blocks nothing here and is blocked by nothing here, but **see OQ-D**: it may still own cap enforcement. |
| **FIX-825** | sub-issue of FIX-939 | Backlog | Topic notification subscribers that bubble up into the flow — the **reactive-dispatch** concern. Parented per the epic description's explicit instruction ("reparent FIX-825 under this epic"), but it sits in the task-events-as-dispatch-triggers gap that §1 puts **out** of this decomposition (Conductor M3). **Reviewer note, routed not folded:** review argued `relates-to` would model this better than parenting, since a sub-issue outside the decomposition reads as scope the epic owns and isn't delivering. That is a defensible Linear-hygiene point, but the parenting was the owner's stated call and re-parenting is destructive — left as-is, flagged for the gate. Decision 5 is where its eventual capability is depended upon. |
| **FIX-978** | **not** a sub-issue — owned by epic **FIX-980**, blocks **FIX-982** | In Spec Review | The M2 hole. Reclamation joined to execution liveness stays with FIX-980 per Decision 0; this epic consumes its outcome as FIX-982's dependency. Its spec activity is on FIX-980's epic PR [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983), not here. |

---

## 4. Open cross-cutting questions

**OQ-A — Decision 1: does this epic change `ResourceStateStore`?** **The question the objective
gate must answer.** Two sub-answers are needed, because the objective's clause 1 has two halves
that need two mechanisms. **Evidence and pricing are in §2 Decision 1 — not repeated here.**

| | Recommendation | If the gate refuses it |
|---|---|---|
| **1a — ownership** (one current owner; stale settlement rejected) | **Yes — (a), additively**, reusing the existing scope-store precedent rather than a parallel mechanism, and covering **claim *and* settlement**. **The shape is not decided here** — resource state has no version to gate on, so it is FIX-981's first design fork | **M1 merges into M3** — (b)'s dedup can only live where the queue is. Not a smaller epic; a resequenced one. |
| **1b — cap admission** | **No mechanism recommended.** The constraint: name one that enforces a hard maximum on concurrent admitters, or state honestly that overshoot is *narrowed but unbounded*. **Conditional on OQ-D and on FIX-957's claimed bound being real** — 1b's cross-issue finding argues it is not | §1's criterion 1b is relaxed away and the epic claims **no** cap guarantee |

Also for the gate: the recommended path is **not** free — optional verbs preserve source but not
behavioral compatibility, so it carries a **declared adapter migration** (durable boards refuse
construction on an adapter lacking the verb).

> **Sharpened option — not decided here.** Because 1b needs its own mechanism, a third path opens:
> **is cap admission in FIX-981's scope at all, or its own milestone (or FIX-957's)?** Splitting
> lets 1a — the precedent-backed half — ship without waiting on cap-arbitration design.
> **Tradeoff:** the two were one milestone because they share the two-execution setup and one
> harness; splitting duplicates that. Interacts with **OQ-D**.

**A human decides all of this**, which is why it is an open question rather than a decision.

**OQ-B — Does the blocking/background disposition need to be *durable*? (premise corrected in round 1.)**

**A `TaskHandle` cannot be awaited.** It is
`Task<TInput, TOutput> & { items(): readonly OutputItem[] }`
(`tasks/collection/types.ts:109-111`); `Task` is pure Zod-inferred data
(`tasks/schema/task.ts:13-58`), `items()` is documented *"Sync, throw-free"* (`types.ts:96`), and
`get`/`list`/`count` are non-async (`types.ts:199-201`). **No promise, no `then`, no wait member —
`await handle` resolves immediately.**

**But the conclusion "nothing can block on a task" is also wrong**, and this is the sharper
finding: **in-request blocking already exists.** `.waitForCondition(predicate, { timeoutMs, wakeOn? })`
(`core/src/blocks/sequencer-methods.ts:343-352`, impl `sequencer.ts:2083`) suspends a sequencer on
the item stream until a synchronous predicate over collection state holds — and the docs name *"a
task-board that flips a task status"* as the canonical use
(`apps/docs/docs/sequencers/control-flow.md:316`), with `whenBoardClaimable`
(`task-board/predicates.ts:39-62`) and the `onTaskChangeFor` wake filter as the shipped board-side
pairing. What is missing is only a **per-task** helper — no `waitForTask`, no terminal-state
predicate factory — so a caller hand-writes `() => collection.get(id)?.status === "completed"`,
and it works **only inside a sequencer step within the same request**.

**But `.waitForCondition` cannot be the durable answer, and the "just a predicate helper" sizing is
withdrawn.** It **requires and subscribes to the current request's `ResponseEmitter`** — the impl
throws *"waitForCondition requires a response emitter on the context"* when `ctx.response` is
undefined (`core/src/blocks/sequencer.ts:2083-2100`) — and it wakes on **that** request's item
stream. So wrapping `collection.get(id)` in a predicate helper **cannot receive a completion
performed by a later detached execution**: the write happens in an execution whose items this waiter
never sees. In-request blocking ships; **cross-request blocking does not exist**, and a helper over
`.waitForCondition` does not create it.

**So the real question, restated:** does the detached/durable case need a disposition that survives
the request — and **since no cross-request wait mechanism exists today, whatever answers it is new
work, not a helper.** Routed as a **precondition to speccing FIX-983**.

> **Sharpened option for the gate — not decided here, and now with a precondition attached.**
> Collapsing **M4 into M3** is viable **only if M3 owns a persisted cross-request wait/resume
> mechanism.** Otherwise **M4 is retained** — because the thing being collapsed away does not exist
> to be inherited.
>
> This **narrows** the decision rather than widening it: the earlier framing ("M4's durable half may
> be one predicate helper, so collapsing is nearly free") **was wrong**, and it was the main argument
> for collapsing. The tradeoff that remains is real but different — collapsing puts "does anything
> still await this task" inside the executor's design, where it is easy to answer implicitly and
> wrongly.

**OQ-C — What is M5's real necessity argument?**

The description justifies FIX-984 by the conductor board view not being live — observability,
which does not obviously carry a Medium–Large **breaking** change to `.work` / `.waitForWork`
callers.

An earlier draft of this question proposed a stronger framing: *"a detached task that reports
nothing is indistinguishable from a detached task that died."* **That is wrong.** A **healthy but quiet or blocked** task's persisted progress is
indistinguishable from that of a worker that died at the same point. **Progress reporting cannot
separate those — only liveness can.** And this document assigns liveness and reclamation to
FIX-978 (Decision 0) and explicitly declines to design heartbeats here, so sizing M5 around
silent-vs-dead **borrows FIX-978's property** to justify FIX-984's cost. That was my error, not
the description's.

**Corrected framing, and this document picks one: keep M5 as observability** — that is its honest
value, and it should be sized and justified as such. If the gate wants "alive vs dead" instead,
that is **an explicit dependency of M5 on FIX-978's liveness semantics**, not something a progress
surface delivers.

> **Sharpened option for the gate — not decided here.** Cursor recommends narrowing M5 to
> **liveness-only** by default. **Tradeoff, and it is large:** an "alive vs dead" heartbeat field
> versus persisted **per-delta progress writes** differ by *orders of magnitude in write
> amplification* — one write per interval against one write per emitted item. Narrowing buys most
> of the operational value for a small fraction of the write cost, and gives up the live stream
> the conductor board view wants. Per the correction above, the liveness half also depends on
> FIX-978 rather than standing alone.

**OQ-D — Who owns cap enforcement on the durable backing: FIX-957 or FIX-981?** FIX-957's spec
PR [#954](https://github.com/fixpoint-labs/flow-state-dev/pull/954) carries it as its **own
Decision 3, already decided**; this epic's description lists the same work as having moved here.
**Both cannot own it, and building it twice is the specific failure FIX-957's focus practice 1
warns about.** Most likely the description is stale. **FIX-981 must not start cap work until this
is answered.** See §2 Decision 3 → 2.a. **Needs a human.**

**And the question is now larger than ownership.** 1b's cross-issue finding argues FIX-957's chosen
mechanism **does not deliver the bound its spec claims**. So OQ-D is no longer only "who builds it"
but **"does either issue have a cap mechanism at all"** — if the bound is not real, the gate is
choosing between *exact arbitration* (needs a mechanism nobody has named) and an *honest unbounded
statement*. **Route the finding to FIX-957's owner alongside this question.**

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

### Corroboration in the tree

The harness is gone, but **the mechanism that explains these numbers was located in the current
code** — see §2 Decision 1's two-tier finding. So the measurements no longer rest on the vanished
branch alone: **the numbers say what happened, and the mechanism says why it had to.** That is a
stronger position than the harness by itself gave us.

---

---

## Epic evolution

A short stub by design. **The decisions and their reasoning live in §2, where they are
load-bearing** — a parallel changelog of how they got there drifts from them and doubles the
reading cost.

- **Epic created.** Previously a placeholder keeping FIX-930's task contract detach-ready.
  Promoted to active work by the Conductor M2 forcing function; membership decided with the repo
  owner (§1). The description's **M2 hole** is Decision 0, recorded with its reasoning so it is
  not re-read as an oversight.
- **Three review rounds spent; converged.** The default budget is two;
  [`orchestration.md`](../../contributing/orchestration.md) authorises a third only when round two
  surfaced a genuine spec-level finding. **It did, and the third was earned rather than drifted
  into:** round 2 found the cap hole, round 2's own fix for it was incomplete, and round 3 found
  **two contradictions inside the gated statement itself** — §1 still demanded a cap guarantee that
  1b's recommendation provably does not deliver, and 1a as scoped did not deliver clause 1's
  stale-settlement half. **Approving the objective as written would have signed off something the
  recommendation cannot do.** A fourth round is refused.

  Six of this document's own conclusions changed across the three rounds: the **objective clause**
  (twice — "exactly once" was unachievable, then its cap half needed two guarantees), **Decision 2**
  (a category error, rewritten), the **"non-breaking" claim**, **OQ-C's framing**, **Decision 1's
  scope** (split into 1a/1b, then 1a widened to settlement), and **Decision 4's cost** (materially
  cheapened). **The direction never changed:** option (a), staged, mirroring a shipped precedent.

- **Final convergence — the document was narrowed, not extended.** The last round diagnosed the
  real problem: **the epic had been specifying a mechanism it cannot verify at its own altitude.**
  Each of three successive fixes became the next round's defect — the cap framing, then the
  objective contradicting it, then a "bounded" overshoot nothing bounds; a conditional
  `transitionRef`, then the model-facing path that was never fenced. **Every one of those defects
  was in a *mechanism* claim. The direction survived all of them untouched.**

  So the final edit **removed** claims about *how*: 1a's staged implementation list, 1b's mechanism
  table, and every implication that the conditional-write shape was settled (**it is not — resource
  state has no version to gate on**, recorded as FIX-981's first design fork). **Decision 1 now
  states direction and constraints only, with mechanism explicitly delegated to FIX-981.**

- **Open at the gate:** OQ-A (two-part), OQ-B, OQ-C, OQ-D, plus the sharpened scope options
  recorded for the user rather than adopted — including the **leaner-epic default** (collapse
  M4 into M3, narrow M5, split 1b out), which this document's own necessity check arguably implies
  but does not decide.
