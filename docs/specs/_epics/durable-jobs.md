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

Three clauses, each falsifiable, and the order matters because each one is worthless without
the one before it:

1. **Exclusive ownership per attempt, and at-least-once execution.** At any moment a task has
   at most one *current* owner, and a stale owner's settlement is rejected rather than applied.
   Two executions racing over one durable board cannot both win a task, and cannot both admit
   past a cap. Today they can — measured, not inferred (the premise correction below).
2. **Reports what it is doing.** A task running outside its originating request has a
   persisted progress surface. Not `ctx.emit`, which dies with the request.
3. **Steered.** A coordinator that is alive can read the board and act on it; a coordinator
   that is gone does not strand the work.

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
> The completion criteria below were already consistent with the weaker property (criterion 1
> only ever proved "two executions cannot both settle") — so it was the *claim* that was
> wrong, not the criteria. They now agree.

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
- **M4 (FIX-983) is the weakest member.** Its durable half may be as small as one predicate
  helper, because **in-request blocking already ships** via `.waitForCondition`. Whether it
  deserves a milestone at all turns on whether the disposition must survive the request —
  **stated once in OQ-B**, which is also where the "collapse M4 into M3" option is recorded.
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

### Decision 1 — does this epic change `ResourceStateStore`? **(RECOMMENDATION — (a), staged and additive. Awaiting the objective gate.)**

**Settled here, in this document, before the gate — deliberately not deferred to FIX-981's
spec.** Option (b) *is* FIX-982's territory (dispatch topology), so this decision picks the
shape of **two** milestones, not one. Framing it here and leaving it open would re-create
exactly the vacuum this epic-spec exists to remove.

Everything below is priced against the tree at `epic/durable-jobs`, not restated from the
description. **Two of the description's own claims about option (a) turn out to be wrong**, and
they are the two that make (a) look expensive.

#### First — the precedent. This is not greenfield, and that changes the whole question **(verified, round 1)**

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

##### And this is what the gap actually is: resource state has **tier 1 of a two-tier design, and no tier 2**

`packages/engine/src/stores/scope-lock.ts:1-5` states the architecture outright:

> *"Per-`StateContainer` async FIFO mutation queue. The two-tier dispatch lives in
> `applyMutation`; **CAS retries still apply at the durable boundary in `runWithCAS`**."*

| Tier | Scope state (session/user/org/request) | Resource state (**the task board**) |
|---|---|---|
| **1 — in-process serialization** | per-container async FIFO queue (`scope-lock.ts`) | ✅ `serializeResourceWrite` promise chain (`resource-registry.ts:540-546`) |
| **2 — cross-execution, at the durable boundary** | ✅ `runWithCAS` + version-gated `set` | ❌ **absent.** `ResourceStateStore.set` is an unconditional upsert. |

**That is the whole finding in one line: the task board has the local tier and is missing the
durable tier, so its claim safety is real within an execution and vanishes across executions.**
Decision 1 is not "should we add CAS to a store" — it is **"should we finish the two-tier
pattern that scope state already implements."** Framed that way the answer is much less
contentious, and the blast radius is a known quantity rather than an estimate.

#### Second — where the guarantee is missing, traced end to end

The description asks whether to add CAS to the *store*. But the store is not where the claim's
atomicity currently comes from, so it is not where the gap starts. Traced:

| Layer | What it does | File |
|---|---|---|
| `claim()` | lists candidates, then per candidate calls `candidateRef.updateState(...)` and **re-checks eligibility inside the updater** | `packages/orchestration/src/tasks/collection/resource-backed.ts:270-308` |
| `ResourceRef.updateState` | `prev = readState()` → `updater(...)` → `persist(...)`, all wrapped in `serializeResourceWrite(storageKey, …)` | `packages/engine/src/context/resource-registry.ts:706-720` |
| `serializeResourceWrite` | serializes writes per storage key **through an in-memory `Map<string, Promise<unknown>>` promise chain** | `packages/engine/src/context/resource-registry.ts:540-546` |
| the store's `set` | unconditional upsert — "Creates or overwrites" | `packages/engine/src/stores/types.ts:550-551` |

**The decisive fact: that promise chain is per-`ResourceRegistry`, and a registry is built
per execution.** `createScopeResourceRegistry` is constructed inside `createExecutionContext`
(`packages/engine/src/context/createExecutionContext.ts:1649`, `:1664`, `:1682`). So:

- Two writers **in one execution** → one chain → correctly serialized.
- Two writers **in two executions** → two chains, two `Map`s, **no serialization of any kind**.
  Both read `pending`, both write `in_progress`.

That is not a hypothesis — it is precisely the §5 measurements ("two drains both settle one
task"; "`attempts` rolls 1 → 0", a textbook lost update). **The board's claim safety is an
in-process promise queue, and it silently degrades to nothing at the exact boundary this epic
is about.**

**Two code comments assert the opposite, and they are how the wrong reading keeps recurring**
(the description notes "four wrong readings already paid"). Both are stale and both must be
corrected by whoever lands FIX-981 — leaving them is how a fifth reading happens:

- `packages/orchestration/src/task-board/blocks/claim-task.ts:12-14` — *"The substrate's CAS
  retry inside `collection.claim` guarantees exactly-once dispatch under contention."*
  **There is no CAS and no retry anywhere in that path.** False, full stop.
- `packages/orchestration/src/tasks/collection/resource-backed.ts:6-7, 22-26` — *"Per-task CAS
  rides the underlying ResourceRef.updateState contract"* … *"Result: at most one worker claims
  any given task."* **True within one execution, false across two** — and the sentence does not
  say which it means.

#### The contract as it stands

`ResourceStateStore` (`packages/engine/src/stores/types.ts:546-570`) has **six** methods —
`get`, `set`, `delete`, `getAll`, `getByPrefix`, `deleteAll`. **No conditional verb, no version,
no ETag, no compare.** `set` is documented "Creates or overwrites."

It is a **published** interface (exported from `packages/engine/src/index.ts`), and both external
store packages consume it as `import type { ResourceStateStore } from "@flow-state-dev/engine"`.
So a **required** new method is a breaking change across a package boundary for any third-party
adapter. An **optional** one is not.

#### Option (a) — priced properly

**The description's "all four adapters" is correct.** Verified — there are exactly four, and no
more:

| Adapter | File | Can its backing do CAS? |
|---|---|---|
| In-memory | `packages/engine/src/stores/memory/resource-state-store.ts:12` | **Yes, trivially.** Single-threaded JS: read-compare-write in one synchronous tick *is* atomic. Its meaningful scope is one process, which is where it is used. |
| Filesystem | `packages/engine/src/stores/filesystem/resource-state-store.ts:19` over `filesystem-resource-store.ts` | **Yes, but it is the one awkward case.** `set` is write-temp-then-`rename` (`:376-382`) — atomic *replacement*, unconditional. It already uses an atomic compare primitive elsewhere: `link()` fails `EEXIST`, used for the layout marker (`:286-305`). So CAS is buildable, via a version-stamped sidecar or an `O_EXCL` lock — real work, not a one-liner. |
| SQLite | `packages/store-sqlite/src/resource-state-store.ts:21` | **Yes, easily.** Its own header says *"Last-write-wins per key (no CAS/versioning)"* — a deliberate current choice, not a limitation. `better-sqlite3` is synchronous and transactional; a `WHERE`-guarded `UPDATE` or `BEGIN IMMEDIATE` does it. |
| Postgres | `packages/store-postgres/src/resource-state-store.ts:14` | **Yes, easily.** `UPDATE … WHERE version = $n`, or a `WHERE` clause on the `ON CONFLICT` already there. |

**So the "if any backing cannot do CAS, that decides a lot" scenario does not obtain.** No
backing is incapable. The filesystem adapter is the cost centre, not a blocker.

**The conformance suite** is `packages/engine/src/stores/testing/resource-store-conformance.ts`
(207 lines; `createResourceStateStoreConformanceTests` at `:200`), published via the
`@flow-state-dev/engine/testing` entry point and registered at **three** sites:
`packages/engine/test/resource-state-store.test.ts:225` (filesystem),
`packages/store-sqlite/test/resource-durability.test.ts:47`,
`packages/store-postgres/test/resource-stores.test.ts:55`.

> **One wrinkle FIX-981 must design for, not discover:** the current suite builds **one** store
> handle per test (`createStore: () => ResourceStateStore`). A CAS/contention case needs **two
> handles over one backing** — and for the in-memory adapter two handles are two `Map`s, i.e.
> two different stores, so the contention case is *meaningless* there rather than merely
> failing. The suite's shape has to grow a notion of "two handles, one backing," with in-memory
> either opting out explicitly or modelling a shared substrate.

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
   (`packages/orchestration/src/skills/task-tools-capability.ts:560-585`) that a generator holds
   via `uses: [taskTools]`: `assignTask`, `completeTask`, `failTask`, `cancelTask`, `updateTask`
   and siblings. **An LLM calling `completeTask` is not "work routed through the queue."** And
   the capability *explicitly* supports pointing at a shared board — *"Pass a resolver targeting
   a shared board for the shared-board delegation case."* In an agent framework this is the
   normal path, not an edge case.
2. **The default `taskTools` instance is UNCAPPED** (`:588-600`, FIX-931): it closes over
   `defaultOwnStateResolver`, which builds a board with **no** `maxEnqueuedTasks` /
   `maxTotalTasks`. So the *cap* half of M1 is already bypassed by the hand-wired path,
   independent of dispatch topology. (b) cannot fix that at all.
3. **`reclaim()`** flips `in_progress → pending` (`resource-backed.ts:406-450`) outside any
   dispatcher.
4. Pattern code calls `collection.*` directly — e.g. supervisor's post-drain labelling of
   terminal tasks.

**Is (b) sufficient for Conductor M2 — the concrete consumer?** *Not reliably.* Conductor M2
runs each issue as a durable task on a **shared** board, and its phases are agents. The moment
a phase agent holding `taskTools` writes to that board, (b)'s dedup is bypassed. M2's stated
acceptance criterion that a crashed worker's issue returns to the queue with no human
intervening runs through `reclaim`, which is also outside the queue.

**And (b) has a sequencing problem that is disqualifying on its own: the queue it depends on is
milestone 3.** Queue-level dedup lives in the out-of-request executor — FIX-982. So choosing (b)
means **M1's guarantee is delivered by M3's machinery**, which either inverts the epic's stated
sequence (M1 → M3) or collapses M1 into M3. That is a real restructuring of two milestones, and
it is precisely why this decision could not be left inside one issue's spec.

#### Option (c) — neither

(c) means M1 cannot be built here and the epic is itself blocked. But **Conductor M2 is blocked
on this epic**, so (c) does not remove the block — it relocates it upward and leaves the
measured defects (§5) shipped and unaddressed. (c) is only the right answer if the objective
itself is not worth pursuing, which is the gate's question, not this decision's.

#### The objective has **two** clauses here, and they need **two** mechanisms — split into 1a and 1b **(round 2, P1)**

**An earlier draft of this recommendation covered one and implied it covered both. That was the
most consequential error in this document** — it would have left §5's *first measured row*
unfixed while appearing to address it. Round 2 (Codex, PR #993) caught it; verified in code
before folding.

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

##### 1a — claim exclusivity · **recommendation: (a), staged, mirroring the scope-store precedent**

> Add the conditional write as an **optional** verb on `ResourceStateStore` and reach it through
> a **new sibling** ref method — completing the two-tier pattern scope state already implements,
> using the same optional-verb + feature-detect shape `DeltaStoreOps` established.

Staged, in dependency order, all within FIX-981:

1. **Correct the two false comments** (`claim-task.ts:12-14`, `resource-backed.ts:6-7,22-26`).
   Cheap, and it stops the fifth wrong reading.
2. **Add an optional version-gated verb to `ResourceStateStore`,** mirroring
   `SessionStore.set(id, value, expectedVersion)` and the `DeltaStoreOps` capability-advertisement
   pattern rather than inventing a signature.
3. **Implement it in all four adapters** — Postgres and SQLite are near-trivial; filesystem uses
   the existing atomic `link()`/`O_EXCL` primitive; in-memory is a synchronous compare.
4. **Add a new sibling ref method** carrying an applied/declined outcome. `updateState` keeps its
   signature, so the 47 references stay untouched.
5. **Switch `claim` to it**, and apply the compatibility path below.
6. **Extend the conformance suite** with a CAS case and a two-handles-one-backing contention case.

**Reuse `runWithCAS` rather than writing a second retry loop.** It already has conflict refresh,
backoff, and `ConcurrentModificationError` (`cas.ts:119-175`). A parallel loop beside it is the
"two mechanisms for one question" failure this epic keeps warning about.

##### 1b — cap admission · **recommendation: align with FIX-957's decided answer (bounded overshoot), and do *not* invent exactness here**

The mechanisms that could give **exact** cross-execution cap admission, and their costs:

| Mechanism | Cost |
|---|---|
| **CAS-guarded cardinality counter** (one key holding the count; per-key CAS on *that* key) | Reuses 1a's primitive exactly — but makes **every create contend on one key**, a write hot spot precisely under parallel Conductor. This is a coarse lock wearing a CAS costume; see the rejection below. |
| **Reservation / two-phase admit** | Correct and general; needs a reservation record, a release path, and a leak story when a reserver dies. Substantial. |
| **Multi-key transaction** | **The resource registry has no verb for it** — independently confirmed by FIX-957's spec, which rejected a related approach for this reason. |

**FIX-957 already answered this question at the task-cap layer, and chose bounded overshoot.**
Its Decision 3: the check *"reads authoritatively from the collection immediately before it
decides, leaving only the decide-then-write instant racy… That restores a small, bounded
overshoot."* It reached that after rejecting the mirror-only check for the same reason found
here — *"separate long-lived references each admit the full remaining budget without seeing each
other."*

**So the recommendation for 1b is to inherit that answer, not to compete with it:** authoritative
re-read immediately before the decision, accepting a bounded overshoot, and **exact** admission
treated as out of scope unless the gate asks for it.

Two things the gate must see plainly:

- **`maxInstances` and the task caps are different ceilings.** `maxInstances` is a
  resource-registry **live-capacity** limit; `maxTotalTasks`/`maxEnqueuedTasks` are task-layer
  ceilings. FIX-957's spec flags that conflating them *"has already cost a cycle"* — so §5's
  `maxInstances` row and the task-cap work are related but not the same target.
- **Ownership overlaps FIX-957.** Its Decision 3 (cap enforcement on the durable backing) is
  **decided in its spec**, while this epic's description lists that work as having *moved here*.
  **That is a live conflict, surfaced not resolved** — see Decision 3, row 2.

**Required goal check for FIX-981 either way: a distinct-ID contention test.** Two executions
creating *different* task IDs concurrently against one capped collection. The existing harness
gap (resource-backed + two concurrent executions) would **not** catch this case even once
extended, because both writes succeed — the failure is only visible in the final row count.

##### The compatibility path — decided, because "non-breaking" was wrong **(round 2, P2)**

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

##### Coarse locks are rejected — explicitly, here, not in a child spec **(round 1)**

If M1 answers 1a or 1b with a **global board lock**, throughput collapses under parallel
Conductor — the opposite of why this epic exists. The house pattern is already the right one and
is two-tier for exactly this reason: **in-process FIFO queueing per record + per-record
version-gated CAS at the durable boundary** (`scope-lock.ts:1-5`). Per-record, not per-board.

**Binding on every issue here:** no issue may serialize a whole board to obtain claim safety. A
single-key cardinality counter (1b's first row) is a coarse lock by another name and falls under
this rejection too — which is part of why bounded overshoot is recommended over exactness.

##### Why (a) over (b), and what refusing costs

**Why (a) over (b), one line each:** (b)'s guarantee is bypassed by the model-facing tool surface
that is *the* normal way boards get mutated here; (b) cannot address the uncapped default board
at all; and (b) needs M3's queue to deliver M1's guarantee.

**What the gate is asked to accept:** surface area across six packages (additive at the type
level); real work in the filesystem adapter; a conformance-suite shape change; a feature-detected
capability with a construction-time failure mode for durable boards on unsupporting adapters; and
a **declared adapter migration** rather than a free upgrade.

**If the gate refuses the store change**, the honest consequence is not (b) — it is that **M1 and
M3 merge** and the epic's sequence is restated, because (b) can only be built where the queue is.

*Recorded in §4 as **OQ-A**, because these are recommendations and the human decides. When the
gate answers, this heading changes to **DECIDED** and the rejected options stay recorded with
their reasons, so a later reader does not re-open a settled fork.*

### Decision 2 — how board **lifetime** and collection **scope** compose (they are two axes, not one) **(REWRITTEN in round 1 — the previous version was a category error)**

**This decision said the wrong thing and would not have been executable.** It said: *"FIX-957
ships board lifetimes `block | request`; whoever lands the durable rungs here widens that same
option with `session`/`user`/`org`."* Round 1 (Codex, PR #993) challenged it, verification
against the tree **and against FIX-957's own spec PR
[#954](https://github.com/fixpoint-labs/flow-state-dev/pull/954)** confirmed the challenge, and
the correction runs deeper than the review stated. **You cannot widen a lifetime enum with scope
values — they are orthogonal axes**, and the durable rungs are not ours to add because they
already ship.

#### The two axes, as they actually exist

| Axis | What it controls | Values today | Where |
|---|---|---|---|
| **Backing** — *the lifetime lever* | how long the board lives | `request` \| `resource` \| `sequencer` \| `factory` | `TaskBoardBacking`, `packages/orchestration/src/task-board/index.ts:442`; on the handle at `:488` |
| **Scope** — *the identity partition* | **which** durable partition holds the state | `session` \| `user` \| `org` (`ResourceScope`) | required on `DefineTaskCollectionOptions` (`tasks/collection/define-task-collection.ts:65`); type at `packages/core/src/types/resource.ts:24`; runtime-enforced `core/src/types/resource-collection.ts:276-280` |

The docs state the relationship outright — the section is literally titled *"Backings set the
lifetime"*, tabulating `request` = the whole request, `sequencer` = one `board.drain`,
`resource` = across requests (`apps/docs/guides/board-lifecycle.md:122-137`) — and then:
**"The scope lives on the collection, not the board"** (`:172-173`).

Two consequences that unmake the old wording:

- **`scope` only subdivides the durable arm.** It cannot express `block` vs `request` at all;
  those correspond to today's `sequencer` vs `request` **backings**.
- **No field named or shaped as `lifetime` exists anywhere in `packages/orchestration/src`** —
  verified. The old decision was widening an option that does not exist.

**So a durable board is: backing `resource` **+** collection scope `session`/`user`/`org`.**
Both halves already ship. If FIX-957 (or anyone) introduces a `lifetime` option, it competes
with **`backing`**, never with `scope`.

#### What FIX-957 actually proposes — and it *rejected* the shape the old decision assumed

Read from spec PR #954 rather than from the epic description's paraphrase, and this is the part
that matters most:

- FIX-957's Decision 1 is **one library option that accepts a `defineTaskCollection` result**.
  Omit it → today's per-turn board, unchanged. **It introduces no lifetime enum at all.**
- FIX-957 **explicitly considered and rejected** a `boardScope: "turn" | "session" | "user" |
  "org"` enum, for this reason: *"it invents a parallel scope vocabulary beside
  `defineTaskCollection`'s, which means two ways to say 'a durable task board' and two places
  for the definition to drift."*

**That is the same objection the old Decision 2 existed to raise — and FIX-957 already
sustained it, in the opposite direction.** The old wording would have instructed this epic to
build precisely the parallel vocabulary FIX-957 rejected with reasons. The description's
paraphrase ("FIX-957 now covers `block` and `request` board lifetimes only") does not match
FIX-957's spec; **treat the spec as canonical and the paraphrase as stale.**

#### The decision, restated

**"Extend, never fork" survives — but the thing being extended is the *backing* axis, and the
durable rungs come from `scope`, which already exists.** Binding on every issue under this epic:

1. **Do not add a scope vocabulary.** `session`/`user`/`org` already exist on
   `defineTaskCollection`. An issue that finds itself defining a second way to say "which
   durable partition" has found a **conflict to surface**, not a design choice — bring it here.
2. **A durable board is expressed as backing `resource` + a scoped collection.** That is the
   shape FIX-982 and FIX-981 both build on.
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
| 1 | `session` / `user` / `org` board lifetimes | **nothing to build — already shipped** | **Corrected in round 1.** These are `ResourceScope` values on `defineTaskCollection`, shipped today (`define-task-collection.ts:65`, `core/src/types/resource.ts:24`). This epic **consumes** them; it does not add them. What FIX-981 owns is making a board *safe* at those scopes, which is 1a/1b — not the scopes themselves. See Decision 2. |
| 2 | FIX-957's former **Decision 3** (cap enforcement on durable storage) **+ its five consequences** | **⚠️ CONFLICT — surfaced, not resolved** | **This document cannot allocate this row.** FIX-957's spec PR [#954](https://github.com/fixpoint-labs/flow-state-dev/pull/954) carries cap enforcement on the durable backing as **its own Decision 3, already decided** (backing-agnostic check, durable backing accepts cap options, authoritative re-read → bounded overshoot). The epic description says the work moved *here*. **Both cannot own it.** See 2.a below. |
| 3 | The unresolved **(a)/(b) claim-recovery mechanism** | **Decision 1, this document** | Not deferred to a spec — it *is* Decision 1, settled below rather than inside one issue, because option (b) is FIX-982's territory and option (a) is FIX-981's. |
| 4 | The **durable collection-identity seam** | **FIX-981 (M1)** | A durable board must be re-findable across executions before anything can contend for it. It is a precondition of M1's own tests, not separable work. |
| 5 | The **mandatory hydration memo** | **FIX-981 (M1)** | Same reason: hydrating a durable board is how the second execution reaches the first one's task. M1 needs it to exist in order to demonstrate the race at all. |
| 6 | The **pre-drain `reclaim()`** | **FIX-978 / FIX-980 — not this epic** | *Resolved below.* |
| 7 | **`flowIsolation` forwarding** | **FIX-982 (M3)** | *Resolved below.* |

#### 2.a — the cap-enforcement ownership conflict (**needs a human; do not let two issues build it**)

Round 1 read FIX-957's spec directly rather than the epic description's paraphrase, and the two
disagree about who owns cap enforcement on the durable backing:

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

The filing agent found no obvious owner and guessed possibly FIX-982. **Owner confirmed —
FIX-982 — but round 1 corrected the framing, and the correction is the useful part: there is
nothing to "forward".**

`flowIsolation?: boolean` is declared **only on resource/collection definitions**
(`packages/core/src/types/resource.ts:186`, rejected at session scope `:431-435`;
`resource-collection.ts:59`, `:282-286`), with flow-level `isolateUserState` / `isolateOrgState`
defaults (`types/flow.ts:489-499`) as the only other input. **It appears nowhere on a request.**
And `createExecutionContext` already *recomputes* it: `resolveConfigScopeId` reads the config's
`flowIsolation`, resolves it against the flow defaults, and keys off identity
(`createExecutionContext.ts:867-880`) via `resolveResourceIsolation` (resource wins over flow
default, `stores/scope-keys.ts:140-147`) and `resolveResourceScopeId` (`scope-keys.ts:154-160`).

**So carrying a copy on the task would be a bug, not a feature** — it would diverge from the
definition, and from the per-prefix conflict rule `createExecutionContext` enforces across a
whole scope's config map (`createExecutionContext.ts:818-861`, which *throws* when collections
sharing a storage prefix disagree).

**What the out-of-request executor must load to re-derive correctly** — recorded because it is
what FIX-982 would otherwise discover late:

1. **The full config map for that scope** — not just the one definition, since canonicalization
   and the shared-prefix check are whole-map decisions (`createExecutionContext.ts:799-803`).
2. **The flow definition** it runs under, for `flow.kind` plus the `isolateUserState` /
   `isolateOrgState` defaults (`IsolationFlow`, `scope-keys.ts:27-36`).
3. **The identity triple** — `userId`, `orgId`, and the tenant-namespaced session key
   (`resolveSessionStorageKey`, `scope-keys.ts:75-82`).

**Only the flow *kind* is request-derived.** So **flow kind + identity is the genuinely minimal
thing that must travel with a detached task** — everything else the executor re-derives from the
definitions. That is the constraint FIX-982 designs against, and it is much smaller than
"forward the isolation settings."

**No new issue is needed for 3.a or 3.b.** Both have owners. Row 2 is the only unowned one
(OQ-D).

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

**Consequence — and round 1 substantially softened this, correctly.** An earlier draft said any
spec wanting to re-run these experiments *"must rebuild the harness"* and told FIX-981 to budget
that. **That over-priced it.** The harness FIX-981 needs largely exists:

- `packages/integration-tests/src/scenarios/task-board-drain-containment.test.ts` already proves a
  board property through **full `runAction` composition** via `testFlow` — the right altitude, and
  the shape FIX-980's Decision 5 made the bar for board work.
- `testFlow`'s seeding is **deliberately idempotent so multiple calls can share one store
  registry**: *"only `set()` an entity when no record exists yet for its identity. Lets multiple
  `testFlow` calls share a registry without resetting journals or resource state"*
  (`packages/testing/src/test-utilities/testFlow.ts:80-82`). **That is exactly the
  two-executions-over-one-board setup**, already supported.

**So the gap is "resource-backed collection + two concurrent executions" — an extension of an
existing scenario, not a new harness species. FIX-981 should not budget a spike redo.** What it
should budget is the extension plus the **distinct-ID contention test** that 1b requires, which
that scenario shape does not currently cover.

The one thing genuinely gone is the *SQLite-on-disk, falsification-condition-per-run* rig. Cite
the §5 numbers rather than re-deriving them; reach for a new rig only if a spec needs a
measurement §5 does not contain.

**Why the numbers moved into this document.** A Linear issue description is not a durable home
for the evidence a whole epic's premise rests on: it is unversioned, has no review surface, and
its history is not diffable. Putting them in §5 gives them a home that is reviewed, versioned,
and reachable from every issue under the epic. This is Decision 4's own principle applied to
Decision 4 — see also the persisted-surface rule that this epic inherits from FIX-980's
Decision 4, which binds here too: **any issue in this set claiming it made progress or failure
visible states which persisted surface carries it.** A `transient: true` trace item is not
observability.

### Decision 5 — M3's executor needs a **named wake source**; it must not default to polling **(added in round 1)**

**A genuine hole in the epic, found by review rather than by us.** §1 puts
task-events-as-dispatch-triggers **out** of scope (that is FIX-825 / Conductor M3). But an
in-request worker wakes on `task-change` items, and **outside a request that stream is gone.** So
FIX-982's executor is left with no named wake source at all — and the default in that vacuum is
**store polling**, chosen by omission rather than by decision. Nobody would write that down; it
would simply appear.

**Binding: FIX-982's spec must name its wake model explicitly**, from these, and state the cost:

| Model | Notes |
|---|---|
| **Event-driven** (`task-change` → dispatch) | The eventual shape, but it *is* FIX-825 / Conductor M3, which §1 excludes. Not available to M3 without pulling that in. |
| **Schedule tick** | A cron beat claims due work. **Precedent exists** — `ScheduleIndex.claimDue` is exactly this, atomic read-and-advance per beat (`packages/scheduled/src/scheduleIndex.ts:48-61`). Cheapest path that reuses shipped machinery. |
| **Liveness-triggered** | Hook onto FIX-978's reclaim/sweeper pass. Couples M3's wake to FIX-978's cadence — acceptable, but it makes the dependency tighter than "consume the outcome". |
| **Bounded poll** | Legitimate *if declared*: state the interval, the scan cost, and how it behaves with an idle board. Not legitimate as a silent default. |

**The point of this decision is not to pick — it is to forbid the accidental choice.** An executor
whose wake source is an unstated poll is how a "durable job substrate" quietly becomes a busy
loop against the store.

### Reuse seams — cite these, or say why not **(added in round 1)**

This document previously named no primitives one layer down, which left four child issues free to
each reinvent liveness, dispatch, progress, and CAS. **Binding on every issue here: build on the
named seam or state in your spec why it doesn't fit.**

| Seam | Where | Who should reuse it |
|---|---|---|
| **CAS**: `runWithCAS`, version-gated `set(id, value, expectedVersion)`, `DeltaStoreOps` capability advertisement | `engine/src/stores/cas.ts:119-175`, `stores/types.ts:181-272` | **FIX-981** — mirror this shape; do not invent a retry loop (Decision 1). |
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
| **FIX-825** | sub-issue of FIX-939 | Backlog | Topic notification subscribers that bubble up into the flow — the **reactive-dispatch** concern. Parented per the epic description's explicit instruction ("reparent FIX-825 under this epic"), but it sits in the task-events-as-dispatch-triggers gap that §1 puts **out** of this decomposition (Conductor M3). **Reviewer note, routed not folded:** review argued `relates-to` would model this better than parenting, since a sub-issue outside the decomposition reads as scope the epic owns and isn't delivering. That is a defensible Linear-hygiene point, but the parenting was the owner's stated call and re-parenting is destructive — left as-is, flagged for the gate. Decision 5 is where its eventual capability is depended upon. |
| **FIX-978** | **not** a sub-issue — owned by epic **FIX-980**, blocks **FIX-982** | In Spec Review | The M2 hole. Reclamation joined to execution liveness stays with FIX-980 per Decision 0; this epic consumes its outcome as FIX-982's dependency. Its spec activity is on FIX-980's epic PR [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983), not here. |

---

## 4. Open cross-cutting questions

**OQ-A — Decision 1: does this epic change `ResourceStateStore`?** **This is the one the
objective gate must answer**, and it is here rather than closed because §2 Decision 1 ends in a
**recommendation**, not a settled call. The recommendation is **(a), staged and additive** —
an *optional* `compareAndSet` on the store plus a *new sibling* ref method, so the guarantee
becomes general without a breaking change to any published interface.

**It is now two recommendations, because the objective's two clauses need two mechanisms** — see
§2 Decision 1 → 1a / 1b, stated once where the evidence that supports them lives. What the gate
needs to know:

- **1a (claim exclusivity) — recommend (a), staged.** Not greenfield: **CAS precedent is shipped**
  one layer down (`runWithCAS`, version-gated `set(id, value, expectedVersion)`, and
  `DeltaStoreOps`' optional-verb + feature-detect pattern). The task board has **tier 1 of a
  two-tier design and no tier 2** — mirror the precedent rather than invent a shape.
- **1b (cap admission) — recommend inheriting FIX-957's decided answer** (authoritative re-read →
  **bounded overshoot**), and treating *exact* admission as out of scope unless asked. Per-key CAS
  **cannot** do this: different task IDs are different keys, and `create()` counts from the
  per-execution cache (`resource-registry.ts:981-1004`). This is §5's first measured row.
- **Not "non-breaking".** Optional verbs preserve source compatibility, not behavioral
  compatibility. The recommended path is **refuse durable-board construction on an adapter lacking
  the verb** + a declared adapter migration — because a durable board that appears to have claim
  safety and does not is the exact defect FIX-980 exists to eliminate.
- **(b) is bypassed** by the model-facing `taskTools` surface (the normal way boards get mutated in
  an agent framework), cannot fix the uncapped default board at all, and **needs M3's queue to
  deliver M1's guarantee.**
- **Refusing the store change does not yield (b) — it merges M1 into M3** and restates the epic's
  sequence.

> **Sharpened option for the gate — not decided here.** Given 1b needs its own mechanism, a third
> path opens: **is cap admission in FIX-981's scope at all, or does it become its own milestone
> (or fold into FIX-957)?** Splitting it would let 1a — the well-understood, precedent-backed half
> — ship without waiting on the cap arbitration design. **Tradeoff:** the two clauses were framed
> as one milestone because they share the two-execution setup and one integration harness;
> splitting duplicates that setup across two issues. Interacts with **OQ-D**.

**A human decides all of this.** It is recorded as open questions rather than decisions precisely
so the gate is not asked to rubber-stamp an agent's pick.

**OQ-B — Does the blocking/background disposition need to be *durable*? (premise corrected in round 1.)**

An earlier draft argued *"a caller holding a `TaskHandle` can already choose whether to await
it."* **That premise is false and is withdrawn.** `TaskHandle` is
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

**So the real question, restated:** does the **detached/durable** case need a disposition that
survives the request, and can any new wait API justify itself against `.waitForCondition` —
most likely as a **per-task predicate helper** rather than a new mechanism? **This makes M4's
"near-zero work" framing untenable as originally stated**, and it is a better question than the
one it replaces. Routed as a **precondition to speccing FIX-983**.

> **Sharpened option for the gate — not decided here.** Cursor recommends deciding now that **M4
> collapses into M3**. That is a scope call, so it is recorded rather than taken. **Tradeoff:**
> collapsing removes a milestone whose in-request half already exists and whose durable half may
> be one predicate helper — but it also buries the "does anything still await this task" question
> inside the executor's design, where it is easy to answer implicitly and wrongly.

**OQ-C — What is M5's real necessity argument? (my round-1 reframing was wrong; corrected in round 2.)**

The description justifies FIX-984 by the conductor board view not being live — observability,
which does not obviously carry a Medium–Large **breaking** change to `.work` / `.waitForWork`
callers.

An earlier draft of this question proposed a stronger framing: *"a detached task that reports
nothing is indistinguishable from a detached task that died."* **Round 2 (Codex) refuted that,
and it is right.** A **healthy but quiet or blocked** task's persisted progress is
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

### Corroboration found in the tree (2026-07-29, this document's research)

The measurements above were taken on a branch that no longer exists. **The mechanism that
explains them is still in the tree and was located directly** — so the §5 numbers no longer rest
on the vanished harness alone. Full trace in §2 Decision 1; the short form:

`claim()` → `ResourceRef.updateState` → `serializeResourceWrite`, which serializes writes through
an in-memory `Map<string, Promise<unknown>>` promise chain
(`packages/engine/src/context/resource-registry.ts:540-546`) held **per `ResourceRegistry`** —
and a registry is constructed **per execution**
(`packages/engine/src/context/createExecutionContext.ts:1649`). Two executions therefore share
no serialization at all, and the store's `set` is an unconditional upsert in all four adapters.

**Two drains both reading `pending` and both writing `in_progress` is the predicted behavior of
that code, not a surprise.** This is a *stronger* position than the harness gave us: the numbers
say what happened, and the mechanism says why it must.

---

## Epic evolution

- **Epic created (this document).** Previously a placeholder whose stated purpose was to keep
  FIX-930 designing a detach-ready task contract. Promoted to active work by the Conductor M2
  forcing function, with membership decided with the repo owner: FIX-981 active, FIX-982/983/984
  filed-and-blocked, FIX-957 and FIX-825 parented but out of the active set, FIX-978 consumed as
  an external dependency. The description's **M2 hole** is recorded as Decision 0 with its
  reasoning, so it is not re-derived as an oversight.
- **Decision 1 priced against the real tree, and it moved twice.** Researched rather than
  restated, and two of the description's own claims about option (a) did not survive:
  1. **The gap is not in the store.** Claim atomicity comes from `serializeResourceWrite`, an
     **in-memory promise chain held per `ResourceRegistry`** — and registries are per execution.
     So the substrate's claim safety is an in-process queue that degrades to nothing across
     executions, which is exactly what §5 measured. The mechanism was located in the tree, so
     the §5 numbers no longer rest solely on the deleted harness.
  2. **(a) need not be a breaking change.** The description frames it as the largest blast
     radius and implies a break; an optional store verb plus a *new sibling* ref method is
     additive at every layer. Conversely (a)'s real surface is **wider** than stated — the
     load-bearing type is `updateState` (`Promise<void>`, so it cannot report a declined write),
     with 47 non-test references across 13 files in 6 packages, not just four adapters.

  Also established: **exactly four adapters** (the description's count is right), **no backing is
  incapable of CAS** (filesystem is the awkward one, not a blocker), the conformance suite needs
  a **two-handles-one-backing** shape it does not currently have, and **two code comments
  actively assert the false CAS premise** (`claim-task.ts:12-14`,
  `resource-backed.ts:6-7,22-26`) — the likely source of the "four wrong readings" the
  description mentions, and FIX-981's to correct.

  **Recommendation: (a), staged and additive** — carried as **OQ-A** for the objective gate,
  since the human decides. Recorded with the finding that refusing the store change does not
  yield (b) but **merges M1 into M3**, because (b)'s dedup can only live where the queue is.
- **Round 1 review folded (Codex + Cursor, PR #993) — five changes of substance, and three of them
  corrected *this document*, not the description.**
  1. **The gated objective was wrong.** It claimed work is *"claimed exactly once"*, which
     `reclaim()` makes unachievable — a returned task lets a second worker repeat side effects.
     Restated as **exclusive ownership per attempt + at-least-once execution**, with the explicit
     note that side-effect fencing is *not* adopted here and task bodies must be safe to re-run.
     The completion criteria already only proved the weaker property, so the claim was the defect.
  2. **CAS precedent exists and it reframed Decision 1** — verified, and stronger than asserted:
     `runWithCAS` (`cas.ts:119-175`), version-gated `set(id, value, expectedVersion)`, the
     **optional + feature-detected** `DeltaStoreOps` verbs (the exact staging shape this document
     had independently proposed), and `ScheduleIndex.claimDue`. Decisive framing: `scope-lock.ts`
     documents a **two-tier** design, and the task board **has tier 1 and no tier 2**. Decision 1
     is therefore *finishing an established pattern*, not novel design.
  3. **Decision 2 was a category error — rewritten.** Board **lifetime** is the `backing` axis
     (`request|resource|sequencer|factory`); collection **scope** (`session|user|org`) only
     subdivides the durable arm; **no `lifetime` field exists**. You cannot widen a lifetime enum
     with scope values. Worse, FIX-957's spec PR #954 **explicitly rejected** a parallel
     `boardScope` vocabulary — so the old wording instructed this epic to build the thing FIX-957
     rejected with reasons. The real coordination point is **FIX-960** (`sequencer` → `state`
     rename), not enum-widening. Decision 3 row 1 fell with it: the durable rungs **already ship**.
  4. **A cap-ownership conflict surfaced (OQ-D).** FIX-957's spec carries cap enforcement on the
     durable backing as its own **decided** Decision 3, while this epic's description claims the
     work moved here. Surfaced, not resolved.
  5. **Decision 3.b reframed from "forwarding" to "re-derivation"** — `flowIsolation` lives on
     definitions, never on a request, and `createExecutionContext` already recomputes it. Carrying
     a copy would be a bug. Recorded the three inputs the executor must load, and the useful
     constraint: **only flow *kind* is request-derived**, so flow kind + identity is the minimal
     thing that must travel.

  Also folded: **Decision 5** (M3 must name a wake source, so it cannot silently default to store
  polling — a genuine hole); a **reuse-seam table** so four child issues don't each reinvent
  liveness, dispatch, progress and CAS; **coarse locks rejected explicitly** at epic level; and
  **Decision 4 softened** — `testFlow` already supports a shared registry across calls
  (`testFlow.ts:80-82`) and the containment scenario already runs at `runAction` altitude, so the
  gap is an *extension*, not a harness rebuild. FIX-981 no longer budgets a spike redo. **OQ-B's
  premise was withdrawn**: `TaskHandle` has no awaitable surface, but `.waitForCondition` means
  in-request blocking already ships, which makes M4's question sharper rather than dissolving it.
- **Round 2 review folded (Codex, PR #993) — three findings, two of which corrected round 1's own
  work.**
  1. **P1 — the recommendation covered one clause of two.** Per-key CAS cannot enforce a creation
     cap: different task IDs are **different keys**, and `create()` counts from the per-execution
     cache and is not even under `serializeResourceWrite`
     (`resource-registry.ts:981-1004`). As written it would have left **§5's first measured row (8
     rows against `maxInstances: 4`) unfixed while appearing to fix it.** Decision 1 is now split
     into **1a (claim exclusivity)** and **1b (cap admission)** with separate recommendations —
     1b inherits FIX-957's bounded-overshoot answer rather than inventing exactness — plus a
     required **distinct-ID contention test**, which the extended harness would otherwise miss
     because both writes succeed and only the final count reveals the failure.
  2. **P2 — "non-breaking at any layer" was overstated** (my claim, from round 1). Optional verbs
     preserve **source** compatibility, not **behavioral** compatibility: a third-party adapter
     without the verb backs a durable board that worked before the upgrade. Now decided as
     **refuse durable-board construction + a declared adapter migration**, with degrade-and-warn
     explicitly rejected as the default — a durable board that appears safe and isn't is the exact
     defect FIX-980 exists to eliminate.
  3. **P2 — OQ-C's reframing borrowed FIX-978's property** (also mine, from round 1). "A silent
     detached task is indistinguishable from a dead one" is false as a *progress* argument: a
     healthy-but-quiet task looks identical to one that died at the same point. **Only liveness
     separates them**, and liveness is FIX-978's. M5 is now framed honestly as **observability**,
     with alive-vs-dead recorded as an explicit *dependency* option on FIX-978.

  **Net across both rounds: four of this document's own conclusions changed** — the gated
  objective clause, Decision 2 entirely, the "non-breaking" claim, and OQ-C's framing — plus
  Decision 1 split in two and Decision 4 materially cheapened. The direction did not change:
  still (a), still staged, still mirroring a shipped precedent.
- **The epic-spec has converged.** Two review rounds spent; the budget is exhausted. Remaining
  questions are the four open ones in §4 — **OQ-A** (the gate's decision, now two-part), **OQ-B**,
  **OQ-C**, **OQ-D** — and the three sharpened scope options recorded for the user rather than
  decided: collapsing M4 into M3, narrowing M5 to liveness-only, and whether cap admission belongs
  in FIX-981 at all. Below-the-bar items are routed to the issues they belong to. Further edits
  should be driven by what the gate decides and what implementation discovers, not by another
  review pass.
