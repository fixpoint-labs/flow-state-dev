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

### Why this is one body of work

Six issues, filed independently, over five months, by different investigations. They read
as a grab-bag of orchestration bugs. They are not — every one of them is the same shape:

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

### FIX-951 is the anchor, and it is already merged

**Sequencing fact that changes how this set is read:** FIX-951's implementation is **on
`main`** — PR #953, merge commit `41a5655`, with `docs/specs/FIX-951.md` merged alongside
it. Its advisory-write contract is live behavior, not a proposal under review.

That contract, verbatim from `packages/orchestration/src/tasks/collection/types.ts:32-53`:

> Both guards are evaluated **inside** the same atomic write that performs the transition,
> so there is no window between checking and writing. Both are advisory: when a guard
> rejects the write, the call is a silent no-op and returns normally. Nothing reports which
> guard fired.

Three of the five remaining issues sit directly on that sentence. FIX-976 and FIX-963 both
want failure to be loud on paths that route through it; FIX-964 is about the guard being
absent entirely on a documented extension point. That is a genuine contradiction inside the
set, and resolving it once — here — is the reason this epic exists rather than six
independent issue-lifecycles. See §2, Decision 1.

> **Linear state drift, flagged not fixed:** FIX-951's Linear state still reads *In Spec
> Review* and its description still points at spec PR #941, though the implementation
> merged. Whether FIX-951 needs any further work under this epic, or is simply a
> mis-stated status to correct, is Open Question A.

### Holistic necessity check

The `issue-spec` Step 3.5 lens at epic altitude: each issue can earn its place while the
whole set overbuilds. Applied honestly, two of the eight do not sit cleanly on the
objective, and saying so is more useful than a tidy story:

- **FIX-948 is the weakest member of the spec'd set.** It is a guardrail gap, and it fits
  flavour (b) — a cap that reports "under the limit" while spend runs away. But its own
  description flags that **FIX-933** (a cost/budget ceiling) would catch a retry storm by
  its cost rather than its attempt count, and may subsume it. Building both is the
  overbuild risk this check exists to catch. **Do not start FIX-948's spec without first
  checking FIX-933's state** — that check is a precondition, not a nicety.
- **FIX-972 is in the project but not on this objective.** A skill named `constructor`
  resolving `Object.prototype.constructor` through an unguarded map lookup is a *crash* —
  loud, not silent — in the skills runtime, not the task substrate. It is the fourth
  instance of a defect class already fixed twice (FIX-943 PR #957, FIX-965 PR #969) with a
  canonical guard shape sitting in `packages/core/src/utility/keyed-router.ts:81`. It is
  carried in the index because it is in flight on the same project, not because the
  objective needs it. **It should not shape any cross-cutting decision here.**
- **FIX-962 fits by analogy and the analogy holds.** A goal check whose criterion E accepts
  *any* salted completion rather than one bound to `fx.openRequests` will pass a run that
  did the work exactly backwards. That is this epic's shape one level up: **the check
  reports success for something that didn't happen.** Worth keeping in view, because a set
  about honest reporting that verifies itself with a dishonest check has a problem.

Nothing else in the set is redundant with anything else. The five substrate issues touch
five distinct paths (tool boundary, drain result, extension point, retry accounting, lease
recovery) and none of them subsumes another.

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

### Decision 1 — Where is the line between an advisory write that may decline silently, and a call that must report failure? **(OPEN — needs the human)**

This is the decision the epic exists to make. It is stated with options rather than
resolved, because the evidence is genuinely balanced and picking by fiat here would be
picking for four issues at once.

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

**Option A — separate the decline from its reporting.** Widen `complete`/`fail`
(and `transitionTo`) from `Promise<void>` to a discriminated outcome. The substrate's own
write-backs ignore it, preserving FIX-951 exactly; the tool boundary maps `declined` to
`{ ok: false }`; the drain maps a post-commit recorder rejection to something a caller can
branch on.

- Satisfies FIX-976 and FIX-963 with one mechanism instead of two local patches.
- Keeps both guards inside the atomic write, which is FIX-951's stated invariant.
- **Possible bonus, and it needs checking before anyone relies on it:** the current
  signature is `complete(id, output, options?): Promise<void>` — a return-type *widening*
  is not structurally satisfied by a custom ref declared `Promise<void>`, whereas adding
  an optional third *parameter* was. If that holds, Option A hands FIX-964 the
  compile-time signal it asks for, using neither of the two mechanisms FIX-964 explicitly
  rejects (a `__advisoryWrites` brand, an `fn.length >= 3` arity probe). **This is a
  plausible interaction, not a verified one.** Falsified by: a minimal custom ref
  declared `Promise<void>` typechecking clean against the widened interface. If this
  claim gets argued more than once, settle it with a POC rather than a third round of
  prose.
- Cost: a public interface change on `TaskCollectionRef`, which FIX-964 has already shown
  is fragile territory, for a population of custom-ref implementers nobody can enumerate.

**Option B — keep `ifAllowed` fully silent; fix each caller at its own boundary.**
FIX-976 pre-checks `isTerminalStatus` in the tool handlers; FIX-963 has `recordSuccess`
record in worker-body state that it already committed, so `recordError` knows it is looking
at a post-settlement recorder failure.

- Smaller blast radius, no public-interface change, each issue stays independent.
- Cost, and it is a real one: moving the terminal check outside the atomic write
  **reintroduces the check-then-write window FIX-951 deliberately closed.** For
  `assignTask` that may be tolerable (a stale assignee write is not a containment
  failure); for a transition-shaped call it is the bug pattern coming back.
- Leaves FIX-964 with nothing — S3 is untouched by anything in Option B.

**Option C — split by shape.** Option B for `assignTask` and the rest of `updateTask`'s
non-status patch surface (which is genuinely a different guard: "may this field be written
on a terminal task," not "is this transition legal"), Option A for the transition-shaped
calls. Costs two mechanisms, but each is applied where it actually fits.

**What the human is being asked to decide:** whether the substrate's write contract gets
a return value (A/C) or stays `void` with per-boundary patches (B). Everything else in this
epic follows from it, and FIX-976, FIX-963 and FIX-964 should not have their specs
finalized before it is answered.

### Decision 2 — FIX-951 is the anchor: sequencing follows from Decision 1, not from priority order

FIX-976, FIX-963 and FIX-964 all modify or work around behavior FIX-951 shipped. They can
be **spec'd in parallel** — that is the point of running them under one epic — but none of
them should be *implemented* against a version of Decision 1 that another is still
arguing. Concretely:

- Decision 1 is answered → then FIX-976 / FIX-963 / FIX-964 specs finalize against the
  same answer.
- `cross-spec-review` runs across those three once each is individually approved. They
  touch the same files (`sequencer-backed.ts`, `resource-backed.ts`,
  `task-tools-capability.ts`) and are the most likely collision in this set.
- FIX-978 and FIX-948 are independent of Decision 1 and need not wait on it.

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
- **FIX-957's spec §7 independently reaches this same constraint and names the same two
  candidates, also unresolved.** Its sub-PR `d` scopes "recovery of a stranded
  `in_progress` claim" via a pre-drain `reclaim()`. FIX-978 and FIX-957 are pointed at the
  same substrate gap; an expiry-based fix landed independently in both places would be
  wrong for the same reason twice. Whoever picks up FIX-978 checks FIX-957's current state
  first. This is overlap, not a blocking dependency.

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

| Issue | Title (short) | Track | Linear state | Spec PR | Impl PR |
|---|---|---|---|---|---|
| **FIX-951** | Drain containment breaks when a worker fails after its task settled | spec'd · **anchor** | In Spec Review *(stale — see OQ-A)* | #941 | #953 **merged** `41a5655` |
| **FIX-978** | Stranded `in_progress` lease hangs a later drain ~14h | spec'd | Todo | — | — |
| **FIX-976** | `assignTask` rewrites a terminal task; `cancelTask` no-ops; both `ok: true` | spec'd | Todo | — | — |
| **FIX-963** | Recorder failure after a task commits is swallowed | spec'd | Todo | — | — |
| **FIX-964** | Custom `TaskCollectionRef`s silently skip FIX-951's guards | spec'd | Todo | — | — |
| **FIX-948** | `maxAttempts` retry storms invisible to `maxTotalTasks`/`maxEnqueuedTasks` | spec'd | Backlog | — | — |
| **FIX-972** | Skill named `constructor` crashes `unionAllowedTools` | **direct fix, no spec** | Todo | n/a | — |
| **FIX-962** | Goal criterion E's salt guard isn't bound to the open request | **direct fix, no spec** | Backlog | n/a | — |

FIX-972 and FIX-962 are in scope for the epic's objective but run on a separate no-spec
track as direct fix PRs. They are **not** sub-issues of FIX-980 at the time of writing; the
coordinator parents them once their PRs open.

---

## 4. Open cross-cutting questions

**OQ-A — Is FIX-951 actually still open?** Its implementation merged to `main` (PR #953,
`41a5655`) and its spec doc is on `main`, but its Linear state reads *In Spec Review* and
its description still points at spec PR #941. Either the state is stale and should be
advanced, or there is a further pass intended that isn't written down anywhere. This
decides whether FIX-951 gets an issue-lifecycle at all under this epic. **Needs a human.**

**OQ-B — Decision 1: A, B, or C?** See §2. The load-bearing question for four of the six
issues. Nobody should finalize FIX-976 / FIX-963 / FIX-964's specs before it is answered.
**Needs a human.**

**OQ-C — Does FIX-933 subsume FIX-948?** FIX-948's own description raises it: a cost/budget
ceiling bounds a retry storm by spend rather than attempt count. Building both is
overbuild. Resolvable by checking FIX-933's current state — assign it to whoever picks up
FIX-948 first, as a precondition to speccing it.

**OQ-D — unverified, do not build on it yet:** does widening `complete`/`fail`'s return
type actually produce the compile-time signal FIX-964 wants against a two-arg custom ref?
Stated with its falsification in §2 Decision 1, Option A. Cheap to settle empirically; if
it gets argued twice, settle it with a POC rather than a third round of prose.

---

## Epic evolution

- **Epic created** — six issues sharing one shape (the substrate's report diverging from
  what it did), one live contradiction about when silence is permitted (Decision 1), and
  two adjacent issues on a direct-fix track. Objective sharpened from "no silent failures"
  to "silence is a named contract," because the naive form would have reverted FIX-951.
</content>
