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
| ├ **Decision-1-bound** | 2 | FIX-976, FIX-964 |
| └ **Decision-1-independent** | 3 | FIX-978, FIX-948, FIX-963 |
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
most important thing to hold while reading §2.** Decision 1 was not "how do we coordinate with
work that is still in flight." It was **"do we revise a shipped public contract, and what does
that cost"** — and the answer is yes (§2, Decision 1, **DECIDED**). Two of the five active
issues sit directly on that sentence: FIX-976 wants failure to be loud on paths that route
through it; FIX-964 is about the guard being absent entirely on a documented extension point.
FIX-963 was a third until round 2 established it needs its own error channel regardless of the
return value — see Decision 1's "What this decision does not reach."

Two consequences the decision in §2 had to price, which the earlier draft of this document
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
5. Nothing this epic ships makes a *legitimate* terminal-task write fail. Labelling a settled
   task is a real use (post-drain failure-category audit); the new honesty applies to
   assignment, not to the whole patch surface. See Decision 1 → A1.

---

## 2. Themes & cross-cutting decisions

### Decision 1 — The substrate's shipped write contract gains a return value **(DECIDED — Option A)**

**Decided by the repo owner, 2026-07-29, at epic-spec head `1126cd1`.** The shipped write
contract gains a return value: the terminal guard **and the outcome reporting it** are
produced inside the atomic mutation, and the relevant methods return a discriminated outcome
instead of `void`. The stated costs are accepted — **a breaking change to a contract already
on `main`**, and **a genuinely new guard on the `patchRef` / `patchOne` path**. (Round 2
scoped that second cost: the guard sits on the *assignment* write, which routes through those
helpers, and is not installed helper-wide — see A1.)

The rejected options stay recorded below with the reasoning that rejected them. That record
is the point: without it the next reader re-opens a settled fork.

Read this as a decision about **revising something already shipped** (§1), not a greenfield
choice.

**First, the sharpening that made it tractable.** There are *four* different silences being
argued about. FIX-951's contract collapses the first two, and round 2 established that the
fourth is a different animal from the rest:

| | The silence | Who objects |
|---|---|---|
| **S1** | the guard fires and the write does not happen | nobody — this is the containment property, and it is correct |
| **S2** | the decline is not *reported back to the caller* ("Nothing reports which guard fired") | FIX-976 |
| **S3** | the guard was never installed at all | FIX-964 |
| **S4** | the write **committed** and then something *after* it rejected | FIX-963 — **not addressed by this decision**, see below |

S1 and S2 are not the same thing and do not have to travel together. A decline can be
**taken** (the write is skipped, no throw, siblings unaffected — containment fully intact)
and still be **reported** (the return value says so), as long as the substrate's own
recorders ignore the report. FIX-976's own second listed direction arrives at this
independently: *"surface the declined-transition signal that `ifAllowed` currently swallows
... a change here needs to keep those silent while making the tool boundary talk."*

S4 was folded into S2 in the previous draft, and that was a mistake — a return value is a
channel for a *decline*, and S4 is a *throw*. Decision 1 resolves S2 and S3; S4 needs its own
design and is not gated on this one.

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

#### Option A — separate the decline from its reporting, at the methods the tools actually call **(CHOSEN)**

Widen the substrate's mutation methods from `Promise<void>` to a discriminated outcome. The
substrate's own write-backs ignore the outcome, preserving FIX-951's containment exactly; the
tool boundary maps `declined` to `{ ok: false }`.

*(An earlier draft added "and the drain maps a post-commit recorder rejection to something a
caller can branch on." Round 2 refuted that clause — see "What this decision does not
reach.")*

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
assignee patch is itself a judgement call ("may this field be written on a terminal task").
**It has been made: yes for assignment, and only for assignment** — see constraint A1.

##### A1 (constraint) — the new guard is scoped to assignment, never applied to the shared patch helper

Folded from round 2 (Codex, PR #983), verified in code rather than taken on faith, and it
sharpens the decision rather than reopening it.

Both backings funnel **five** methods through one shared helper — `setAssignee`,
`setPriority`, `addLabel`, `removeLabel`, `patchMetadata` all call `patchRef`
(`resource-backed.ts:452-486`) / `patchOne` (`sequencer-backed.ts:470-504`). So "add a guard
inside the patch write" applied to the helper would decline **all five** on a terminal task.

That breaks a live production path. `packages/patterns/src/supervisor/blocks/label-failed-reviews.ts`
is a post-drain audit block that selects `collection.list({ status: "errored" })` — `errored`
is terminal (`TERMINAL_STATUSES = {completed, errored, cancelled}`,
`schema/task-status.ts:24`) — and calls `collection.addLabel(task.id, label)` on each, to tag
it `failed-review` / `reviewer-error` / `worker-error`. It is wired into the supervisor
pipeline as `.tap(labelFailedReviews)` (`packages/patterns/src/supervisor/index.ts:413`), not
dead code. **Labelling a terminal task is the entire point of the block** — a blanket terminal
guard would silently erase the failure-category audit, which is this epic's own defect shape
inflicted by this epic's own fix.

**Therefore:** the guard is **per-operation, not per-helper.** `setAssignee` declines on a
terminal task; `addLabel` / `removeLabel` / `setPriority` / `patchMetadata` keep today's
behavior. Implementations may express this as a guard parameter threaded through
`patchRef`/`patchOne` and passed only by `setAssignee`, or as a policy table keyed by
operation — that is an implementation choice for FIX-976, not an epic-level one. What is
epic-level: **no issue in this set may install a terminal guard on the shared patch helper
unconditionally**, and any issue that touches this surface states which operations its guard
covers.

##### A-i (open sub-question) — what does `updateTask` report when it mutates several fields and settles mid-sequence?

Folded from round 2, verified in code, and **genuinely open** — recorded rather than answered,
because inventing the answer here would be picking for FIX-976 by fiat.

`updateTask` (`packages/orchestration/src/skills/task-tools-capability.ts:472-487`) performs up
to **five sequential awaited writes** inside one `withTask` mutator: `setPriority`,
`setAssignee`, `patchMetadata`, `addLabel`, `removeLabel`. There is no batching. Under A1, only
the `setAssignee` write is guarded. So if a task settles after `setPriority` commits but before
`setAssignee` runs, the priority change is durable and the assignment is declined — and a
single `ok` boolean is a lie in both directions: `ok: false` hides the fields that did land,
`ok: true` hides the one that didn't.

Two shapes resolve it, and this document does not choose between them:

- **One atomic batch patch** — `updateTask` becomes a single guarded write over all requested
  fields, so the whole patch commits or the whole patch declines.
- **An explicit partial outcome** — the return value reports per-field disposition rather than
  one boolean.

Whoever specs FIX-976 picks one and says why. Note this is *not* a reason to reopen Decision 1:
both shapes sit inside Option A. It is a reason the decision is not yet a design.

##### Net — what Option A buys and what it costs

- Satisfies FIX-976 with one mechanism.
- Keeps every guard inside the atomic write, satisfying the constraint above and FIX-951's
  stated invariant.
- **Partial bonus for FIX-964 — SETTLED by POC, see §5.** A return-type widening *does* reject
  a legacy two-arg ref at compile time, using neither of the two mechanisms FIX-964 explicitly
  rejects (a `__advisoryWrites` brand, an `fn.length >= 3` arity probe). But it catches only
  half of what FIX-964 asks for: a ref that returns the new outcome while still declaring **no
  `options` parameter** compiles clean, because dropping a parameter stays assignable, and a
  cast bypasses the check outright. **So Option A substantially helps FIX-964 and does not
  close it.** FIX-964's spec still owes a mechanism for the options-parameter gap and for
  casts.
- Cost, **accepted by the repo owner**: a breaking change to a shipped public interface,
  across more methods than first stated, plus one new guard on the assignment write path.
  **First-party blast radius is small and now measured: 6 call sites in 3 files** —
  `resource-backed.ts:310,325`, `sequencer-backed.ts:332,347`, and
  `task-tools-capability.ts:423,433` (the last pair in the reverse direction, so the tool
  wrappers' return types open too). Zero new errors in `patterns`, `workforce`, or any test
  file.
- Does **not** reach FIX-963 — see below.

##### What Option A actually buys, once both settled results are in

Worth stating plainly, because the decided option is easy to over-read. Two of the three
issues it was framed to serve turned out to need their own work regardless:

| | Does Option A resolve it? |
|---|---|
| **FIX-976** | **Yes** — this is the one Option A squarely fixes. `assignTask` / `cancelTask` / `updateTask` stop reporting `{ ok: true }` on writes that didn't happen. |
| **FIX-964** | **Partly** — real compile-time signal, but the options-parameter gap and the cast bypass survive it (§5). Its spec owes a mechanism either way. |
| **FIX-963** | **No** — a return value is a channel for a decline, and FIX-963's failure is a throw after commit. Needs its own error channel (below). |

**So Decision 1 rests primarily on FIX-976.** That does not unmake the decision — the objective
says a caller must be able to act on what the substrate reports, and FIX-976 is the path where
a model reads that report directly. But nobody should carry away that one contract change
settles three issues. It settles one, helps one, and misses one.

##### What this decision does not reach — FIX-963 is not Decision-1-bound

Folded from round 2 (Codex, PR #983), verified in both backings. This is a **scope
correction**, and the most consequential change in this round.

The previous draft claimed Option A would let "the drain map a post-commit recorder rejection
to something a caller can branch on." It cannot, because there is no return value in the path:

- **The write commits before the emit, in both backings.** `resource-backed.ts`'s
  `transitionRef` does `await ref.updateState(...)` and *then* `emit(kind, nextTask, prevStatus)`
  (`:192-212`); `sequencer-backed.ts`'s `transitionTo` does `await casWrite(...)` and *then*
  `emit(...)` (`:203-219`). `emit` is the tail call. So a failing `onChange` makes `complete()`
  **reject** after the task is durably committed — and a rejected promise carries no outcome
  value. Widening the return type changes nothing about a throw.
- **The cleanup failure lands after the outcome is already gone.** `recordSuccess`
  (`task-board/blocks/record-result.ts:56-67`) does `await collection.complete(...)` and
  discards the result, then `await ctx.sequencer!.patchState(...)`. It is a `.tap()`-shaped,
  `transient: true` handler with **no `outputSchema`** (BP-012), so it has no channel to carry
  an outcome outward even if it captured one.
- **`recordError` only ever sees the thrown error.** Its `execute(error, ctx)` input is the
  value `.rescue()` caught (`:101-118`). Nothing hands it the substrate's outcome.

**Consequence:** FIX-963 needs its own **recorder-state / error-channel** design — a place for
"the task committed and then the recorder fell over" to be recorded and read — and that design
is required whether or not the write contract returns a value. So:

- **FIX-963 leaves the Decision-1-bound set.** It is not gated on Decision 1 and its spec may
  finalize without it. (Membership table in §1 is updated: bound = FIX-976, FIX-964.)
- **The residual link is an input, not a dependency.** Once `fail()` returns an outcome,
  `recordError` *could* learn that its own failure write was declined because the task had
  already settled — which is one useful ingredient for FIX-963's design. An ingredient is not
  a gate. FIX-963 does not wait.
- Decision 4 still binds it: whatever surface FIX-963 chooses must be persisted and
  branchable, not another `transient: true` trace item.

#### Option B — keep the substrate silent; fix each caller at its own boundary **(REJECTED)**

FIX-976 pre-checks `isTerminalStatus` in the tool handlers; FIX-963 has `recordSuccess`
record in worker-body state that it already committed, so `recordError` knows it is looking
at a post-settlement recorder failure.

**Rejected because it does not survive the atomic-mutation constraint.** The pre-check is not
atomic; the cancel half still reports `{ ok: true }` on a lost race, and the assignment half
writes to a terminal task with no guard to stop it. Its appeal was "no public-interface
change," and review established there is no known mechanism that delivers that appeal *and*
an honest result. Anything preserving `void` returns would still have to move the guard inside
the write and then invent some other channel for the outcome — strictly more design for a
strictly worse result.

- Leaves FIX-964 with nothing regardless: S3 is untouched by anything in Option B.
- **One piece of Option B survives its rejection, and it is now FIX-963's:** the
  worker-body-state half ("`recordSuccess` records that it committed") was never about
  Decision 1 at all. It is a candidate mechanism for the recorder-state design FIX-963 now
  owns outright. Rejecting Option B as a Decision-1 answer does not reject that idea.

#### Option C — split by shape **(REJECTED — collapses into A)**

Option B for `assignTask` and the rest of `updateTask`'s non-status patch surface, Option A
for the transition-shaped calls. **Rejected because it inherits Option B's assignment half,
which is the half the constraint refutes** — `setAssignee`'s path has no guard, so a boundary
check there is precisely the racy pre-check. Upgrading that half to an in-write guard is the
only repair, and at that point Option C *is* Option A with a narrower return type. There was
no third position to choose.

### Decision 2 — with Decision 1 answered, nothing in the active set is gated; the whole set may spec in parallel

This decision used to say "the Decision-1-bound three wait." Two things retired that:
**Decision 1 is now answered** (Option A), and **round 2 moved FIX-963 out of the bound set**
entirely. What remains is a grouping, not a gate.

- **Decision-1-bound: FIX-976, FIX-964** — two, not three. They build *on* Option A rather
  than waiting for it. FIX-976 implements the widened contract at the tool boundary and owns
  open sub-question A-i. FIX-964 inherits the widening's compile-time signal, which §5 confirms
  is real but incomplete — so FIX-964 is bound to Decision 1 for what it *gets*, and still owes
  its own mechanism for the options-parameter gap and the cast bypass.
- **Decision-1-independent: FIX-978, FIX-948, FIX-963.** FIX-978 has no dependency at all.
  FIX-948 has its own precondition (OQ-C), which is not Decision 1. **FIX-963 is here as of
  round 2** — it needs its own recorder-state/error-channel design regardless of the return
  value.
- **`cross-spec-review` still runs across FIX-976, FIX-963 and FIX-964** once each is
  individually approved. Note this set is deliberately *not* the same as the Decision-1-bound
  set — cross-spec-review is scoped by **file collision**, and all three touch
  `sequencer-backed.ts`, `resource-backed.ts` and `task-tools-capability.ts`. FIX-963 leaving
  the gated set does not take it out of the collision set.
- **A1 is a shared constraint across that collision set:** all three touch the patch surface,
  and only FIX-976's `setAssignee` may guard it. Whichever lands first must not leave a
  helper-level guard behind for the others to inherit.

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
| **FIX-976** | `assignTask` rewrites a terminal task; `cancelTask` no-ops; both `ok: true` | **bound** · owns A-i | Todo | — | — |
| **FIX-963** | Recorder failure after a task commits is swallowed | independent *(round 2)* | Todo | — | — |
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

> **The one remaining open item lives in §2, not here, deliberately** — stated once, where the
> reasoning it depends on lives. Duplicating it is how two copies drift apart.
>
> - **A-i — what `updateTask` reports when it patches several fields and settles mid-sequence.**
>   A *design* question inside the already-decided Option A, not a fork. Owned by whoever specs
>   FIX-976. See §2 Decision 1 → A-i.
>
> Two items that used to live here are now closed. The **Decision-1 fork** (A / B / C) is
> decided — Option A, approved by the repo owner; the rejected options and their reasons stay
> in §2. The **type-widening claim** is settled empirically — see §5.

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
  that residue under any answer to Decision 1. Full evidence in §5; blast radius of the
  widening measured at 6 sites in 3 files and recorded against Option A's cost.
- **Objective approved** — the repo owner approved the epic objective in-session at head
  `1126cd1`; recorded durably as the `epic approved` label on PR #983, and the Epic issue moved
  to *In Development*. The gate is closed; the sub-issue lifecycles may run.
- **Decision 1 answered — Option A.** The shipped write contract gains a return value: the
  terminal guard and the outcome reporting it are produced inside the atomic mutation, and the
  relevant methods return a discriminated outcome instead of `void`. The repo owner accepted
  both stated costs — a breaking change to a contract on `main`, and a genuinely new guard on
  the `patchRef` / `patchOne` path. Options B and C stay recorded as rejected, with their
  reasons, so the fork is not reopened by a later reader.
- **Round 2 review folded — three P1s, all above the bar, all verified against the code, and
  all of them sharpening Option A rather than challenging it.**
  1. **The new guard is scoped to assignment (A1).** Both backings funnel five methods through
     one shared `patchRef` / `patchOne` helper, so a blanket terminal guard there would also
     decline `addLabel` — breaking `supervisor/blocks/label-failed-reviews.ts`, which
     deliberately labels terminal `errored` tasks and is wired into the supervisor pipeline as
     `.tap(labelFailedReviews)`. Per-operation guard, never per-helper.
  2. **FIX-963 is not solved by return values, and leaves the Decision-1-bound set.** In both
     backings the write commits before `emit`, so a recorder failure is a *rejection*, and a
     rejected promise carries no outcome; `recordSuccess` is a `.tap()` handler that discards
     the result and has no `outputSchema` to carry one; `recordError` only ever receives the
     thrown error. FIX-963 needs its own recorder-state/error-channel design either way. The
     bound set is now **FIX-976 and FIX-964** — two, not three. A fourth silence (**S4**: the
     write committed and something after it rejected) is now named separately from S2, because
     collapsing them is what produced the wrong grouping.
  3. **`updateTask`'s multi-field atomicity is an open sub-question (A-i), not an answered
     one.** It performs up to five sequential writes; under A1 only the assignee write is
     guarded, so a mid-sequence settle commits some fields and declines that one, and a single
     `ok` boolean misreports in both directions. Two shapes resolve it (one atomic batch patch,
     or an explicit partial outcome); the choice is recorded as open and routed to FIX-976
     rather than invented here.

  Taken together with the settled type-widening result above, these folds narrow what the
  decided option delivers: **Option A resolves FIX-976, partly helps FIX-964, and does not
  reach FIX-963.** Decision 1 now rests primarily on FIX-976. Stated explicitly in §2 so the
  decision is not read as buying more than it does.
- **The epic-spec has converged.** Two review rounds spent, the objective is approved, and the
  one decision this epic existed to make is made. Remaining questions are issue-level (A-i and
  the FIX-964 type test to FIX-976 / FIX-964; OQ-C to FIX-948) and are carried as implementer
  notes, not as epic-spec work. Further edits should be driven by what implementation
  discovers, not by another review pass.
