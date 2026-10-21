# POC · phased workflows as a task-filing template on today's board

A shape POC, with characterization where it touches today's behaviour, retained as evidence for
FIX-2092. It is not production code: nothing imports it, it has no package manifest, and
`specs/**/poc/**` sits outside default build, test, lint and fallow discovery
([specs/README.md](../../../../README.md)).

> **Headline: the direction holds, with one change to the plan.** Fan-in dependencies and
> today's board run a 5-phase workflow with no new runtime. But the plan's loop-back, where
> the worker re-wires the next phase from `onTaskSettled`, **starts the next phase early**
> whenever a dispatch pass runs before the notice. A review that asks for changes still
> *completes*, and completing is what satisfies a dependency. A phase that can loop back
> needs a **gate the worker releases**: one more held row. It is still only filing tasks.

## The question

Can phased workflows be built as a template that only files tasks (fan-in dependencies across
phases), with today's board running them, and no new runtime, drain or board mechanics?

## What would make us abandon this direction

- The next phase starts before every step of the previous phase has ended.
- A loop-back leaves a row pending for good, or starts something early.
- A replayed `start` files duplicates, or leaves the record disagreeing with the rows.
- Display state ("step N of M", per-phase status, next, approvals waiting) that can't be
  derived from the rows plus the record.
- Any of the above passing only with a new drain mode, a new board option, or an engine change.

## How to run it

```bash
pnpm install                                                                         # once per checkout
pnpm exec tsx specs/epics/FIX-2092/poc/phased-workflow/run.ts                        # exit 0: ALL CHECKS PASS
GOAL_CONTROL=no-fanin pnpm exec tsx specs/epics/FIX-2092/poc/phased-workflow/run.ts  # exit 1: check 1 FAILs
```

No build is needed. The packages' `exports` resolve to `src`.

## What it is

| File | Role |
|---|---|
| `workflow.ts` | **The candidate, kept portable.** `defineWorkflow(def, binding)` returns `start`, `addStep`, `releaseGate` and `startBlock`, plus a pure `view(record, rows)`. Step ids are `<featureTaskId>:<stepKey>`. The record `{ name, featureTaskId, policy, phases, steps: { key → taskId } }` lives in session state |
| `run.ts` | **The throwaway shell.** It runs on the real engine (`createFlowState`, `inMemoryStores`) and a real `taskBoard` over a durable, user-scoped ledger. Every assignee is a `dispatcher` to a `pw-worker` task entry (`taskLedgers`), run in its own child session behind the real claim gate. Workers are deterministic, with no model. The host loop stands in for workforce's events: on each ending it runs one dispatch pass (`board.drain`, which starts what's ready and exits) and the feature worker's `onTaskSettled`, then one more pass for whatever the notice filed or released |

The workflow is plan → plan-review ⟨user gate⟩ → implement → review (review-a ∥ review-b)
⟨worker gate⟩ → feedback. Feedback is a follow-up in implement's session. Every check reads
its evidence from the ledger rows in the resource store and the record in the session store.

## Results (on `97ed8260a`, stable over repeated runs)

| Check | Result | Evidence (from the stored rows) |
|---|---|---|
| **1 · No new runtime** | **PASS** | 8 rows (6 steps and 2 gates), all `completed`, after 20 dispatch passes. review-a ran 150→202 ms and review-b 151→178 ms, in parallel. Every row's `startedAt` ≥ the latest `completedAt` of the layer before it, and ≥ each of its deps' |
| **2 · Loop-back** | **PASS** (both orders) | review-a returned `changes`. The worker filed `fix-r2` (`followUpOf` = implement, and it ran in implement's child session) and re-reviews `review-a-r2` and `review-b-r2`, deps `[fix-r2]`. The review gate's deps were re-wired to include all three. Feedback started after the last review-phase row ended. 0 rows pending at rest, 0 re-wires refused, 0 rows started before a dep ended. Checked dispatch-first and notice-first |
| 2-control · the plan's shape (no worker gate) | **starts early, as expected** | Dispatch-first: feedback started at +314 ms, before `fix-r2` was even filed (+331 ms, its `createdAt`); the round-2 reviews ended at +502 ms. `addStep`'s re-wire of feedback was refused because the row had started. Notice-first: safe (INFO line), so it is safe in that order only |
| **3 · Replay** | **PASS** | (a) A second `start` files 0 of 8. (b) Mid-run, `start` files nothing, `plan` keeps revision 4 → 4, and record ↔ rows agree. (c) After a loop-back, `start` files nothing, the record keeps `fix-r2` and the two re-reviews, and every record id has a row and every row is in the record |
| **4 · Display** | **PASS** | `view(record, rows)` is pure. The happy path walks "step 1 of 6" → "step 3 of 6 \| plan-review: awaiting-approval \| approvals waiting: gate-plan-review" → "step 6 of 6 (all ended)". (4b) Across a loop-back, M grows 6 → 9 and the current phase moves back from review to implement |
| **5 · Approval gate** (stand-in) | **PASS** | The gate row is filed `undispatched` with deps `[plan-review]`. Two extra dispatch passes ran while it was held, and implement stayed `pending`, never started. The simulated answer calls `dispatch(gate)`; the board ran the gate at +105 ms, after the answer, and implement started at +119 ms ≥ gate ended at +113 ms |
| **Control** `GOAL_CONTROL=no-fanin` | **check 1 FAILs** | "plan-review started at +17ms, before plan ended at +45ms; implement started at +16ms, before gate-plan-review ended…" Checks 2, 4 and 5 also fail; replay (3) doesn't depend on deps and passes |

The numbers in the table are from one run. Absolute timings vary between runs; which checks pass and fail doesn't.

## The finding that changes the plan: loop-back needs a worker gate

FIX-2092's approach says the worker loops back in `onTaskSettled`, and `addStep` re-wires the
next phase through `updateTask({ deps })`, "allowed before it starts". That only works if the
notice runs before any dispatch pass that follows the review's ending. Nothing promises
that. The coordination model reruns `dispatch` on "any filing, start, answer, retry or ending
that makes a row ready, and on any touch of the board". A review that asks for changes ends
`completed`, and its dependents become ready in that same instant. The 2-control run shows
the result: feedback started before the fix was filed, and the re-wire found it already started.

**The fix stays inside the template:** a phase that can loop back gets `gate: { by: "worker" }`,
one held row its successors depend on. The feature worker releases it from `onTaskSettled`
once the latest round passed. A loop-back then re-wires the gate, which is always unstarted
because only the worker can release it. Both orders pass. Two alternatives were rejected:

- **Fail the review task on "changes".** Dependents never become ready, but this mixes up "the
  reviewer found problems" with "the reviewer crashed". It spends an attempt (the default is
  one retry, which re-runs the review), and it leaves an errored row the re-wire has to drop.
- **Promise that the notice runs before the dispatch pass.** That is a new runtime ordering
  guarantee, which the question rules out.

## What today's code lacked, and how the POC worked around it

| Missing today | Stand-in here | What the real feature must provide |
|---|---|---|
| A `phase` field on a task, and `listTasks({ phase })` | `metadata.phase`, alongside `workflow`, `feature`, `step`, `kind` and `round` | The epic's opaque `phase` field. Also a **round** (see below) |
| A held start | `undispatched: true` (FIX-1875's recorded row), which the substrate never claims, released with the ref's `dispatch(id, { call })`. It holds across dispatch passes (check 5) | Held, released by its filer, per the concept |
| An approval: held on questions or an approval kind (FIX-2058) | The simulated user calls `dispatch` on the gate. The released row is then *work*, so the board dispatches it to a no-op `gate` task entry: one extra child session per gate | A held row that **settles on its answer** (approve or reject), with no run. Also one Inbox item per gate, and what a rejection does (not covered) |
| Writing `deps` after filing (FIX-2056's `updateTask({ deps })`) | `rewireDeps` writes `deps` on the durable row through the resource layer, and refuses a row that has started | The real field, with the same refusal |
| Idempotent filing | A plain `addTask` of an existing id throws `Resource instance "pw-ledger/…" already exists`. The template looks before it adds | Nothing new: deterministic ids plus look-before-add is enough. A concurrent double `start` would throw on one side (not covered) |

Two more conflicts with today's rules surfaced through follow-ups. The POC files through the
ref, which trusts its caller, so it didn't hit them. The task tools would refuse both:

- **A follow-up step declared in the definition** (feedback follows implement), filed at
  `start`, names an unfinished task. The tools refuse that (`follow_up_of_unfinished`). They
  also refuse a second open follow-up of the same root (`follow_up_busy`): feedback is still
  open when the loop-back files its fix. The tools also mint a follow-up's id as `<root>-f<n>`,
  not `<featureTaskId>:<stepKey>`. The board's `per-task` session policy routes both
  follow-ups into implement's session, as wanted (checked from the rows' outputs).
- The epic's "`followUpOf` points at an earlier step, validated when defined" therefore needs a
  decision. Either the template files follow-up steps late, when the phase before them ends,
  or template-filed rows get an exemption from the tool rule.

## What the template needed that the FIX-2092 plan didn't anticipate

1. **A worker gate for any phase that can loop back.** Covered above.
2. **Re-wire the first layer that hasn't ended, not "the next phase".** The fix lands in
   implement, and the layer right after implement, the reviews, has already run. The rows
   that must wait are the review gate's.
3. **Rounds.** The worker has to judge the *latest* round, and the re-review keys are derived
   from it (`review-a-r2`). While building, a version without rounds re-read the round-1
   verdict and looped back again after the re-reviews passed.
4. **The template has to be bound to a board.** `start(ctx)` alone isn't enough: it needs the
   delegation board's ref, and (for the stand-in) the ledger id.
5. **"Step N of M" isn't monotonic.** A loop-back grows M (6 → 9) and moves the current phase
   back to implement. Gates are rows but not steps: the view excludes them from M and shows
   them as a phase status ("awaiting-approval"). While the review gate's no-op run is in
   flight, the view says "step 6 of 6" with review still "running".
6. **`policy` is undefined in the plan.** The POC uses `{ loopBackFrom, loopBackTo, maxLoopBacks }`,
   which the worker reads, not the template.
7. **Session-state footgun (not a framework bug).** The record has to be cloned before it is
   changed. Mutating the object read from `ctx.session.state` and then passing it to
   `patchState` lost the write: no late steps were persisted until the read was cloned.

## What it does not cover

- **Rule 6.** It doesn't check that the feature task settles only when its last step ends.
  There is no feature row here, and the "is this task done" predicate is FIX-2077's.
- **A crash between filing and the record write.** A late step filed before `addStep`
  writes the record can't be recovered from the definition on replay. It can be recovered from
  the rows' `phase` and `round`, which argues for the record being rebuildable from rows.
- Concurrent `start` calls, roles (`assignee: { role }`), a rejected approval,
  skipping or re-running a phase, and real workforce wiring: the session board, the internal
  `onTaskSettled` entry, and its actual notice and wake ordering.
