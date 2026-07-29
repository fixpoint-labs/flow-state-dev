# Epic: Honest task substrate

**Epic issue:** [FIX-980](https://linear.app/fixpoint-labs/issue/FIX-980) · **Epic PR:** [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983) · **Project:** Orchestration Primitives · **Branch:** `epic/honest-task-substrate`

> **What this document is.** A coordination artifact for a set of related issues, not an
> implementing spec. Issues under this epic do **not** derive from it — they reference and
> align to it. It exists so the decisions that cut across the set aren't made six times in
> six specs, each in a vacuum. Reviewed at the same altitude as a spec: fold what changes
> the objective or a cross-cutting decision, route everything else to the issue it belongs
> to. See [`orchestration.md`](../../contributing/orchestration.md).

---

## 1. Purpose & objective

### The objective (the gated statement)

**A caller of the task substrate can act on what it reports.** Every write path either did
what it reported, or reported that it didn't — and where the substrate deliberately stays
quiet, that silence is a **named contract with a stated audience**, not a side effect of an
optional parameter or a swallowed rejection.

The second clause is the whole difficulty, and it is deliberately not "make everything
loud." Silence is sometimes the correct behavior here: FIX-951 shipped a containment guard
whose entire value is that a late worker outcome lands on a settled task *without* throwing
and taking down every sibling on the board. Reverting that is not an option, and an epic
framed as "no more silent failures" would walk straight into it. What this epic is actually
after is that a caller can tell which kind of quiet it is looking at.

### Membership — the sets this document counts by

Defined once here; every count elsewhere in this doc uses these labels rather than a raw
number.

| Set | Size | Members |
|---|---|---|
| **Sub-issues** — parented under FIX-980 | 6 | FIX-978, FIX-976, FIX-964, FIX-963, FIX-951, FIX-948 |
| **Completed anchor** — shipped, no lifecycle | 1 | FIX-951 (*Done*, merged) |
| **Active set** — each gets an `issue-lifecycle` | 5 | FIX-978, FIX-976, FIX-964, FIX-963, FIX-948 |
| ├ **Decision-1-bound** | 3 | FIX-976, FIX-963, FIX-964 |
| └ **Decision-1-independent** | 2 | FIX-978, FIX-948 |
| **Project siblings** — off-objective, direct-fix, *not* parented | 2 | FIX-972 (PR #984), FIX-962 (PR #985) |
| **Indexed rows** (§3) = sub-issues + project siblings | 8 | — |

### Why this is one body of work

The **sub-issues** were filed independently, over five months, by different investigations.
They read as a grab-bag of orchestration bugs. They are not — every one of them is the same
shape:

> **The substrate's report of what happened diverges from what happened, and the caller
> has no way to detect the divergence.**

The divergence comes in two flavours, which is worth separating because they need different
fixes:

**(a) It reports success for something that didn't happen.**

| | The report | The reality |
|---|---|---|
| **FIX-976** | `assignTask` → `{ ok: true }` | assignee rewritten on a `completed` task, status untouched; the work will never run |
| **FIX-976** | `cancelTask` → `{ ok: true }` | the transition was declined inside the CAS section; nothing changed |
| **FIX-963** | drain returns normally | the recorder rejected *after* the task durably committed; the error survives only on two `transient: true` trace items |

**(b) It reports nothing at all, where a report was the point.**

| | The silence | What it costs |
|---|---|---|
| **FIX-964** | a custom `TaskCollectionRef` with the pre-FIX-951 two-arg `complete`/`fail` structurally satisfies the interface | the board silently gets none of FIX-951's containment, with no compile-time and no runtime signal |
| **FIX-948** | `maxTotalTasks` / `maxEnqueuedTasks` are enforced at task *creation*; a retry creates no task | a guardrail whose entire purpose is bounding unsanctioned spend sits at "under the cap" while a `maxAttempts` storm runs |
| **FIX-978** | a stranded `in_progress` lease | `reclaim()` is the only thing that reads `leaseUntil` for expiry and **has zero callers** in `packages/orchestration/src/` (verified — every other hit in the tree is a comment or the interface declaration). A later drain rides out `timeoutMs 5000 × (maxIterations 10000 + 1)` — roughly 14 hours at production defaults — and then reports `blocked`, which names the wrong cause |

FIX-978 is the one that most repays reading twice. It is not a false success; it is a report
that arrives fourteen hours late and blames the wrong thing. The root cause is an honesty
gap all the same: **the substrate has no way to distinguish a claim whose owner is provably
gone from one whose owner is merely slow**, so it cannot truthfully say either. Nothing
renews a lease during execution (`grep -rni "renew|heartbeat|extendLease"` returns nothing),
and `DEFAULT_LEASE_DURATION_MS` is 30s while a generator's model call routinely exceeds
that — so an expired lease is the *normal* state of a healthy worker. Any fix that infers
abandonment from expiry alone trades a hang for silent duplicate execution, which is worse.

### FIX-951 is the completed anchor — and that changes what Decision 1 is

**FIX-951 is `Done`.** Its implementation merged to `main` (PR #953, merge commit
`41a5655`) and `docs/specs/FIX-951.md` is on `main` alongside it. It stays parented under
FIX-980 because it genuinely belongs to this objective — it shipped the containment half and
established the contract the rest of the epic has to decide about — but it is **out of the
active set** and gets no issue-lifecycle. It appears in §3 as a completed anchor row, not as
work.

That contract, verbatim from `packages/orchestration/src/tasks/collection/types.ts:32-53`:

> Both guards are evaluated **inside** the same atomic write that performs the transition,
> so there is no window between checking and writing. Both are advisory: when a guard
> rejects the write, the call is a silent no-op and returns normally. Nothing reports which
> guard fired.

**This is live behavior on `main` today, not a proposal under review — and that is the single
most important thing to hold while reading §2.** Decision 1 is not "how do we coordinate with
work that is still in flight." It is **"do we revise a shipped public contract, and what does
that cost."** Three of the five active issues sit directly on that sentence: FIX-976 and
FIX-963 want failure to be loud on paths that route through it; FIX-964 is about the guard
being absent entirely on a documented extension point.

Two consequences the options in §2 have to price, which the earlier draft of this document
did not:

- **Every option that changes `TaskCollectionRef`'s method signatures is a breaking change to
  a published interface** with an unenumerable population of custom-ref implementers. That is
  FIX-964's own complaint seen from the other side: the extension point is real, which is
  exactly why changing it is not free.
- **The do-nothing baseline is not neutral.** Today's behavior is shipped behavior that this
  epic's objective calls dishonest. "Leave it" costs nothing to build and costs the objective
  entirely.

### Holistic necessity check

The `issue-spec` Step 3.5 lens at epic altitude: each issue can earn its place while the
whole set overbuilds. Applied honestly:

- **FIX-948 is the weakest member of the active set.** It is a guardrail gap fitting
  flavour (b) — a cap that reports "under the limit" while spend runs away. But its own
  description flags that **FIX-933** (a cost/budget ceiling) would catch a retry storm by
  its cost rather than its attempt count, and may subsume it. **FIX-933 is now `Done`**
  (under epic FIX-930), so the subsumption question is answerable against shipped behavior
  rather than a pending design. **Do not start FIX-948's spec without first checking what
  FIX-933 actually bounds** — that check is a precondition, not a nicety. See OQ-C.
- **FIX-972 and FIX-962 are project siblings, not epic members — settled.** Both are
  off-objective for this epic and neither is parented under FIX-980:
  - **FIX-972** — a skill named `constructor` resolving `Object.prototype.constructor`
    through an unguarded map lookup is a *crash*: loud, not silent, and in the skills
    runtime rather than the task substrate. It is the fourth instance of a defect class
    already fixed twice (FIX-943 PR #957, FIX-965 PR #969) against a canonical guard shape
    at `packages/core/src/utility/keyed-router.ts:81`. Shipped as PR #984.
  - **FIX-962** — a goal check whose criterion E accepts *any* salted completion rather than
    one bound to `fx.openRequests` will pass a run that did the work exactly backwards. That
    is this epic's shape one level up, and it is worth knowing about, because a set about
    honest reporting that verifies itself with a dishonest check has a problem. It is an
    analogy, not a membership claim. Shipped as PR #985.

  They are carried in §3's index for audit continuity, marked *off-objective · direct-fix*.
  **Neither shapes any cross-cutting decision here, Decision 1 included.**

Nothing in the active set is redundant with anything else in it. The five issues touch five
distinct paths (tool boundary, drain result, extension point, retry accounting, lease
recovery) and none subsumes another.

### What "done" looks like

Not "no silent failures." Specifically:

1. A model or caller reading a task-tool result alone can tell a terminal-task mutation
   failed, without re-fetching and inspecting task state.
2. A drain's result distinguishes "the work completed" from "the work completed and then
   the recorder fell over" — at a surface that is persisted and branchable, not a
   `transient: true` trace item.
3. A board built on a custom `TaskCollectionRef` either gets containment or gets a signal
   that it doesn't. Documentation telling implementers to remember is not a signal.
4. FIX-951's containment property does not regress anywhere: a worker outcome landing on a
   settled task still leaves its siblings running, proven at integration level.

---

## 2. Themes & cross-cutting decisions

### Decision 1 — Does the substrate's shipped write contract gain a return value? **(OPEN — needs the human)**

This is the decision the epic exists to make, and it binds the three Decision-1-bound
issues. It is stated with options rather than resolved, because the evidence is genuinely
balanced and picking by fiat here would be picking for three issues at once. Read it as a
question about **revising something already shipped** (§1) — the options are not equal-cost
greenfield choices.

**First, the sharpening that makes it tractable.** There are *three* different silences
being argued about, and FIX-951's contract collapses the first two:

| | The silence | Who objects |
|---|---|---|
| **S1** | the guard fires and the write does not happen | nobody — this is the containment property, and it is correct |
| **S2** | the decline is not *reported back to the caller* ("Nothing reports which guard fired") | FIX-976, FIX-963 |
| **S3** | the guard was never installed at all | FIX-964 |

S1 and S2 are not the same thing and do not have to travel together. A decline can be
**taken** (the write is skipped, no throw, siblings unaffected — containment fully intact)
and still be **reported** (the return value says so), as long as the substrate's own
recorders ignore the report. FIX-976's own second listed direction arrives at this
independently: *"surface the declined-transition signal that `ifAllowed` currently swallows
... a change here needs to keep those silent while making the tool boundary talk."*

#### Constraint on every option — the guard and its outcome come from the atomic mutation, never from a pre-check

Folded from review (Codex, PR #983), and verified against the code rather than taken on
faith. This constrains the option space before the options are compared, so it is stated
here rather than inside any one of them.

FIX-951's property is that the decision is made *inside* the write: both
`resource-backed.ts`'s `transitionRef` and `sequencer-backed.ts`'s `transitionTo` evaluate
`shouldDeclineTransition` within `ref.updateState` / `casWrite`. A terminal check placed in
the tool handler runs **outside** that write, and the window it opens is not hypothetical:

- **The cancel half.** If a task settles between a handler-side `isTerminalStatus` check and
  the write, `cancel` correctly declines — and the caller is told nothing anyway.
  `resource-backed.ts` absorbs `TransitionDeclined` with a bare `return`, and
  `task-tools-capability.ts`'s `withTask` returns `{ ok: true }` whenever the mutator does
  not throw. The decline is structurally unavailable to the boundary.
- **The assignment half, which is worse.** `setAssignee` does not route through the
  transition path at all. It calls `patchRef` / `patchOne`, which take **no `guards`
  parameter and perform no terminal check of any kind**. The patch simply lands on the
  now-terminal task. There is nothing to decline, so there is nothing a boundary could
  learn about.

**Conclusion this epic adopts:** the terminal decision *and the outcome reporting it* must be
produced by the atomic mutation. A boundary pre-check reintroduces exactly the
check-then-write window FIX-951 closed, and cannot be the mechanism here.

#### Option A — separate the decline from its reporting, at the methods the tools actually call

Widen the substrate's mutation methods from `Promise<void>` to a discriminated outcome. The
substrate's own write-backs ignore the outcome, preserving FIX-951's containment exactly; the
tool boundary maps `declined` to `{ ok: false }`; the drain maps a post-commit recorder
rejection to something a caller can branch on.

**Correction folded from review, verified in code.** The earlier statement of this option
widened only `complete` / `fail` (and `transitionTo`). **That set cannot satisfy FIX-976,
because FIX-976's two tools call neither of them.** In
`packages/orchestration/src/skills/task-tools-capability.ts`:

- `assignTask` → `withTask(ctx, id, (c) => c.setAssignee(input.taskId, input.assignee))`
- `cancelTask` → `withTask(ctx, id, (c) => c.cancel(input.taskId, input.reason))`
- `updateTask`'s assignee arm → `c.setAssignee(...)` as well

So widening `complete` / `fail` alone leaves both of FIX-976's tools returning `{ ok: true }`
exactly as they do today. Option A is only a fix for FIX-976 if it covers all three rows:

| Method | Today | What Option A has to do to it |
|---|---|---|
| `complete` / `fail` | `Promise<void>`; guard already evaluated inside the write | widen the return type — the guard exists |
| `cancel` | `Promise<void>`; passes `{ ifAllowed: true }`, and the backing absorbs `TransitionDeclined` with a bare `return` | widen the return **and** propagate a decline the backing currently discards |
| `setAssignee` (and the rest of the `patchRef` / `patchOne` surface) | `Promise<void>`; no guard parameter, no terminal check at all | **add a guard inside the patch write**, then return its outcome |

The third row is the honest cost this document previously understated: it is not a type
widening, it is **a new guard on a write path that has never had one** — a behavior change
to shipped semantics, not just a signature change. Whether a terminal task should reject an
assignee patch is itself a judgement call ("may this field be written on a terminal task"),
and it is the human's to make.

- Satisfies FIX-976 and FIX-963 with one mechanism instead of two local patches.
- Keeps every guard inside the atomic write, satisfying the constraint above and FIX-951's
  stated invariant.
- **Partial bonus for FIX-964 — SETTLED by POC, see "Settled claims" below.** A return-type
  widening *does* reject a legacy two-arg ref at compile time, using neither of the two
  mechanisms FIX-964 explicitly rejects (a `__advisoryWrites` brand, an `fn.length >= 3` arity
  probe). But it catches only half of what FIX-964 asks for: a ref that returns the new outcome
  while still declaring **no `options` parameter** compiles clean, because dropping a parameter
  stays assignable. **So Option A substantially helps FIX-964 and does not close it.** Whatever
  FIX-964's spec ends up doing, it still owes a mechanism for the options-parameter gap. This
  is a scope fact for FIX-964, not a reason to prefer or reject Option A.
- Cost: a breaking change to a shipped public interface, across more methods than first
  stated, plus one new guard on the patch surface. **First-party blast radius is small and now
  measured: 6 call sites in 3 files** — `resource-backed.ts:310,325`,
  `sequencer-backed.ts:332,347`, and `task-tools-capability.ts:423,433` (the last pair in the
  reverse direction, so the tool wrappers' return types open too). Zero new errors in
  `patterns`, `workforce`, or any test file.

#### Option B — keep the substrate silent; fix each caller at its own boundary

FIX-976 pre-checks `isTerminalStatus` in the tool handlers; FIX-963 has `recordSuccess`
record in worker-body state that it already committed, so `recordError` knows it is looking
at a post-settlement recorder failure.

**As stated, this option does not survive the constraint above.** The pre-check is not
atomic; the cancel half still reports `{ ok: true }` on a lost race, and the assignment half
writes to a terminal task with no guard to stop it. Its appeal was "no public-interface
change," and the review established there is no known mechanism that delivers that appeal
*and* an honest result. Anything that preserves `void` returns would still have to move the
guard inside the write and find some other channel for the outcome — which is a design the
human would be choosing, not one this document has.

- FIX-963's half (worker-body state recording its own commit) is unaffected by the
  constraint — that part remains viable independently of Decision 1.
- Leaves FIX-964 with nothing regardless: S3 is untouched by anything in Option B.

#### Option C — split by shape

Option B for `assignTask` and the rest of `updateTask`'s non-status patch surface, Option A
for the transition-shaped calls. **This inherits Option B's assignment half, which is the
half the constraint refutes** — `setAssignee`'s path has no guard, so a boundary check there
is precisely the racy pre-check. Option C is viable only if its assignment half is upgraded
to an in-write guard, at which point it converges on Option A with a narrower return type.

**What the human is being asked to decide:** whether the substrate's shipped write contract
gains a return value (A, or C-upgraded), accepting a breaking interface change — measured at
6 first-party sites in 3 files — and a new guard on the patch path; or stays `void`, accepting
that FIX-976's tools keep reporting `{ ok: true }` on writes that didn't happen. FIX-976,
FIX-963 and FIX-964 should not have their specs finalized before this is answered.

One thing this decision does **not** settle, now that the type-widening claim is confirmed
(§5): **no option here closes FIX-964 by itself.** Option A gets it a real compile-time signal
but leaves the options-parameter gap open, so FIX-964 owes a mechanism of its own under any
answer. Decide Decision 1 on the FIX-976 / FIX-963 merits; FIX-964's residue is its spec's
problem, not a tiebreaker here.

### Decision 2 — Decision 1 gates the three issues that touch the shipped contract; the other two are free

With FIX-951 merged there is no anchor to sequence around, only a contract to decide about.
What remains:

- The **Decision-1-bound** three (FIX-976, FIX-963, FIX-964) can be **spec'd in parallel** —
  that is the point of running them under one epic — but none of them *finalizes* its spec
  against an unanswered Decision 1, and none is implemented before it.
- `cross-spec-review` runs across those three once each is individually approved. They touch
  the same files (`sequencer-backed.ts`, `resource-backed.ts`, `task-tools-capability.ts`)
  and are the most likely collision in this set.
- The **Decision-1-independent** two are free of it. FIX-978 has no dependency at all;
  FIX-948 has its own precondition (OQ-C), which is not Decision 1.

### Decision 3 — an expired lease is not evidence of abandonment; no issue in this set may assume otherwise

Recorded here rather than left in FIX-978 because it is the kind of thing that gets
independently re-derived and independently got wrong. Nothing renews a lease during
execution, and the 30s default is routinely exceeded by a healthy model call. So:

- **No fix in this epic may infer "abandoned" from lease expiry alone.** That trades a hang
  for silent duplicate execution of a model call and its side effects — a strictly worse
  failure, and directly counter to the objective.
- A real recovery path needs either an execution/run identifier stamped on the claim, or
  lease renewal during execution. Both are substrate changes with their own design
  questions and neither is mandated here.
- **Adjacent work to check first:** FIX-957 (*Backlog*, under epic FIX-939 "Durable jobs &
  detached-task substrate") scopes "a way out for a task parked mid-run" and leaves open,
  for the repo owner, whether to guard the `in_progress` / `awaiting_review` → `pending`
  transition. That is the same transition surface FIX-978's recovery path would touch, and a
  decision made in one place without the other would be re-litigated. Whoever picks up
  FIX-978 checks FIX-957's current state first. This is overlap, not a blocking dependency.
  *(FIX-957 has no spec document; check the Linear issue, not `docs/specs/`.)*

### Decision 4 — a guarantee this set delivers must be observable at a persisted surface

Applies to every issue here, and it is the standing lesson from FIX-963: the error was not
*completely* gone — it survived on two `block_trace` items — but both were `transient: true`.
Devtool diagnostics, not persisted, not in the action result, not branchable by a caller.

**A breadcrumb is not observability.** "The caller can find out" means the action result or
a persisted item, not a trace a human might read in the devtool. Any issue in this set
claiming it made a failure visible states which persisted surface carries it.

### Decision 5 — containment is a non-negotiable regression bar for the whole set

FIX-951's property — a worker outcome landing on a settled task leaves every sibling
running — must hold after each of these issues lands. Two constraints follow:

- Per-backing unit tests are not sufficient. The escape only emerges from full `runAction`
  composition, so the containment regression check runs at **integration** level (FIX-963's
  scope says this explicitly; it is hereby the bar for the set).
- "Loud" and "contained" are not automatically compatible. Reverting to
  loud-for-everything reinstates the sibling-abandonment bug. Any proposal that makes a
  path loud states how containment survives it.

---

## 3. Running index

Durable audit log of every PR under this epic. Refreshed from the coordinator's status
table each time this doc is updated. Empty columns mean not yet reached.

**Epic PR:** [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983) · never merged, open for the life of the epic.

**Active set** — parented under FIX-980, each runs an `issue-lifecycle`:

| Issue | Title (short) | Decision 1 | Linear state | Spec PR | Impl PR |
|---|---|---|---|---|---|
| **FIX-978** | Stranded `in_progress` lease hangs a later drain ~14h | independent | Todo | — | — |
| **FIX-976** | `assignTask` rewrites a terminal task; `cancelTask` no-ops; both `ok: true` | **bound** | Todo | — | — |
| **FIX-963** | Recorder failure after a task commits is swallowed | **bound** | Todo | — | — |
| **FIX-964** | Custom `TaskCollectionRef`s silently skip FIX-951's guards | **bound** | Todo | — | — |
| **FIX-948** | `maxAttempts` retry storms invisible to `maxTotalTasks`/`maxEnqueuedTasks` | independent · blocked on OQ-C | Backlog | — | — |

**Completed anchor** — parented under FIX-980, shipped before the epic opened, no lifecycle:

| Issue | Title (short) | Linear state | Spec PR | Impl PR |
|---|---|---|---|---|
| **FIX-951** | Drain containment breaks when a worker fails after its task settled | **Done** | #941 | #953 **merged** `41a5655` |

**Project siblings** — *off-objective · direct-fix*, **not** parented under FIX-980, listed
for audit continuity only. Neither shapes any cross-cutting decision here:

| Issue | Title (short) | Linear state | PR |
|---|---|---|---|
| **FIX-972** | Skill named `constructor` crashes `unionAllowedTools` | In Review | [#984](https://github.com/fixpoint-labs/flow-state-dev/pull/984) |
| **FIX-962** | Goal criterion E's salt guard isn't bound to the open request | In Review | [#985](https://github.com/fixpoint-labs/flow-state-dev/pull/985) |

---

## 4. Open cross-cutting questions

**OQ-C — What does FIX-933 actually bound, and does it subsume FIX-948?** FIX-948's own
description raises it: a cost/budget ceiling bounds a retry storm by spend rather than
attempt count. **FIX-933 is `Done`** (under epic FIX-930), so this is answerable against
shipped behavior — read what its cap counts and when it is evaluated, then decide whether
FIX-948 is still a gap or is already covered. Routed as a **precondition to speccing
FIX-948**, assigned to whoever picks it up. Not a human blocker.

> **The Decision-1 fork lives in §2, not here, deliberately.** It was previously restated in
> this section verbatim; it is now stated once, with its options and constraint, in §2
> Decision 1 — where the reasoning it depends on lives. Duplicating it is how two copies drift
> apart. It **needs a human**.

---

## 5. Settled claims (evidence on record)

Claims this epic argued, then settled empirically. **Recorded so a later reviewer does not
reopen them blind** — if you want to revisit one, falsify the evidence rather than restate the
original doubt.

### Does widening `complete`/`fail`'s return type give FIX-964 a compile-time signal? — **CONFIRMED, with two gaps**

Settled by throwaway POC (round 1; the POC is reverted and nothing was committed). Bears on
§2 Decision 1, Option A, and on **FIX-964's scope**.

**Confirmed.** A legacy two-arg ref fails to typecheck against the widened interface, in all
three declaration forms tried — annotated object literal, inline `TaskBoardCollectionFactory`
arrow, and `class ... implements`:

```
error TS2322: Type '(id: string, output: Out) => Promise<void>' is not assignable to type
  '(id, output, options?: TaskTransitionOptions) => Promise<TaskWriteOutcome>'.
    Type 'void' is not assignable to type 'TaskWriteOutcome'.
error TS2416: Property 'complete' in type 'LegacyCustomRef' is not assignable ...
```

Mechanism: return types are strictly covariant in TypeScript with no bivariance escape, and
the `void`-return special case runs the opposite direction, so it does not apply here. The
error fires at **implementation-declaration** time, not at the call site — a caller that awaits
and discards the outcome produces no error. **The signal therefore does not depend on anyone
consuming it**, which is what makes it usable as a guard-adoption signal at all.

**Gap 1 — it does not force the guards to be honoured.** A ref that returns
`Promise<{ outcome: "recorded" }>` but still declares only `(id, output)`, with **no `options`
parameter**, compiles clean: fewer-parameter assignability is untouched by a return-type
change. So the widening forces an author to *touch and think about* both methods; it does not
force them to accept or honour `TaskTransitionOptions`. **FIX-964 is substantially helped and
not closed** — its spec still owes a mechanism for the options-parameter gap.

**Gap 2 — a cast bypasses it entirely.** `as unknown as TaskCollectionRef` defeats the check,
and `packages/orchestration/test/flow-policy.test.ts:45` already does exactly that. Any
FIX-964 claim of "custom refs now get a signal" states what it does about casts.

---

## Epic evolution

- **Epic created** — the sub-issues share one shape (the substrate's report diverging from
  what it did), one live contradiction about when silence is permitted (Decision 1), and two
  adjacent project siblings on a direct-fix track. Objective sharpened from "no silent
  failures" to "silence is a named contract," because the naive form would have reverted
  FIX-951.
- **Round 1 review folded** — three changes of substance. (1) **FIX-951 is `Done` and
  merged**, resolving the former OQ-A: Decision 1 is now about revising a *shipped* contract,
  with the compatibility cost that implies, not about coordinating with in-flight work; the
  former Decision 2 sequencing rationale went with it. (2) **Option A was under-scoped** —
  FIX-976's tools call `setAssignee` and `cancel`, not `complete` / `fail`, and the patch path
  has no guard at all, so the option's real cost is larger than stated. (3) **A boundary
  pre-check cannot be the mechanism** — it reopens the check-then-write window FIX-951 closed,
  which refutes Option B as written and Option C's assignment half. (2) and (3) are folded as
  a constraint stated before the options, and both were verified against
  `task-tools-capability.ts`, `resource-backed.ts` and `sequencer-backed.ts` rather than taken
  from the review on faith. Also settled: FIX-972 and FIX-962 are project siblings, not epic
  members, resolving the §1/§3 scope contradiction.
- **Type-widening claim settled by POC** (same round; evidence, so it cost no extra round).
  **CONFIRMED** that widening `complete`/`fail`'s return type rejects a legacy two-arg ref at
  implementation-declaration time — but with two verified gaps: a ref that returns the new
  outcome while declaring no `options` parameter still compiles, and a cast bypasses the check
  outright. **This moved the design**: Option A's FIX-964 bonus is downgraded from "closes it"
  to "substantially helps, leaves the options-parameter gap," so FIX-964's scope must cover
  that residue under any answer to Decision 1, and Decision 1 should not be picked on
  FIX-964's behalf. Full evidence in §5; blast radius of the widening measured at 6 sites in
  3 files and recorded against Option A's cost.
