# Workstream vet — tracer-bullet prototype spec

> **Status: throwaway vet.** This is not a feature spec. It exists to answer one
> question before the Layer-2 conventions (FIX-867 exploration) commit to
> "workstream" as a centerpiece noun: **is the workstream a load-bearing
> concept, or is it planAndExecute dressed up?** The prototype is disposable;
> only the answer ships.
>
> Companion context: the Layer 2 Concept Model & Vocabulary doc (Linear),
> FIX-867 (spike), `docs/architecture/` for substrate contracts.

## Plain-language summary

A workstream is supposed to be "a bounded effort that hires agents, runs them
toward a goal, judges whether the goal is met, and can block on a human before
continuing — outliving any single request." Everything in that sentence except
two clauses already exists as `planAndExecute` / `supervisor`. The two clauses
that don't:

1. **Goal-completion judgment that changes the outcome** — "did we actually
   reach the objective," with a replan loop when the answer is no.
2. **A human checkpoint expressed purely as board semantics** — a task a human
   resolves in a *later request*, with the board surviving in between. No
   `ctx.suspend()`, no durable-action machinery.

This prototype builds the smallest flow that exercises both, headlessly, in
three `fsdev run` invocations against one session. If it works, workstream is
real and gets productized (pattern in `patterns`, assembly sugar in
`workforce`). If it collapses or requires framework surgery, we learned that
for the price of a kitchen-sink flow.

## Hypothesis under test

> A workstream = strategy dispatch over a **session-lived** board + a
> **doneWhen** evaluation loop + **human tasks** as first-class board citizens.
> All three are composable from existing substrate with zero `packages/*`
> changes.

The null hypothesis (kill case): removing `doneWhen` + the human task leaves
behavior indistinguishable from `planAndExecute`, or the cross-request board
can't round-trip without engine changes. Either way, workstream should not
become a centerpiece concept and the Layer-2 conventions should be re-planned
around plain strategies.

## What exists vs. what this vet proves

Recon (2026-07-01) against the live substrate:

| Piece | State | Where |
| --- | --- | --- |
| Task statuses incl. `blocked` / `awaiting_review`, transitions enforced | ✅ exists | `packages/tasks/src/schema/task-status.ts` |
| `feedback` field on tasks; `complete` / `resumeFromReview` mutators | ✅ exists | `packages/tasks/src/schema/task.ts`, `collection/types.ts` |
| CAS-guarded claim/lease semantics | ✅ exists | `packages/tasks/src/collection/sequencer-backed.ts` |
| Evaluate/replan loop *within one request* | ✅ exists | `planAndExecute` evaluator → `loopBack` |
| Cross-request board backing | ✅ substrate (`backing: "resource"`), ❌ **no factory uses it** — all built-ins hardcode `backing: "request"`; skill boards explicitly reject session scope in Wave 1 (`packages/patterns/src/skill-registry.ts:122`) | `packages/tasks/src/collection/get-or-create.ts` |
| Board drain that can exit while a human task is open | ⚠️ **`complete-or-blocked` cannot**: `awaiting_review` counts as in-flight and keeps the loop alive (FIX-443 §10.1, `packages/patterns/src/task-board/blocks/check-board.ts:83-97`). The vet must use `onIdle: "wait"` + a `shouldExit` that ignores `awaiting_review` | `packages/patterns/src/task-board/blocks/check-board.ts` |
| Human (non-worker) assignee | ⚠️ substrate `assignee` is free-form, **but** the registry worker-step throws on a claimable task with an unknown assignee (`packages/patterns/src/task-board/blocks/worker-step.ts:213`) | must be born non-claimable, and must never transition back to `pending` |
| Workstream-shared board/tools as a capability | ✅ machinery (`defineCapability`), composition is new | `packages/core` |
| CLI persistence across processes | ⚠️ kitchen-sink's `dev` profile is `inMemoryStores()` unless `STORE_TYPE=filesystem` | `apps/kitchen-sink/fsdev.config.ts:102-117` |

So the vet's genuinely new ground is exactly: (a) a resource-backed,
session-scoped board driven by `taskBoard`'s collection-factory slot, (b) a
human task modeled as `awaiting_review`-from-birth with a drain that can exit
around it, (c) a workstream-level `doneWhen`/`replan` loop that spans requests,
(d) the shared-workspace capability injected into every member.

## Design

**Home:** `apps/kitchen-sink/flows/workstream-vet/` (the documented prototype
home). **Zero changes to `packages/*`.** Everything below is app-space
composition; if something can't be composed, that is itself a finding.

**Registration:** when a `fsdev.config.ts` is present, `fsdev run` resolves
flows from the FlowState registry only — conventional-directory discovery is
the no-config fallback. So the prototype adds one line to
`apps/kitchen-sink/fsdev.config.ts`'s `flows` map. App-space, throwaway.

### Roles

- **drafter** — the only model-backed worker. A generator on a cheap intent
  model (`intent/utility`) whose **structured output** is the draft
  (`{ draft: string }`, strict per BP-016). A deterministic commit `.tap`
  after the generator persists the draft to the shared workspace resource
  (the memo-writer precedent — never rely on the model *voluntarily* calling
  a write tool for proof evidence; a skipped tool call must not be
  mistakable for a failed concept).
- **approver** — a human. **Not a worker.** Exists only as tasks with
  `assignee: "human:approver"`, seeded with `status: "awaiting_review"` so the
  drain loop can never claim them (default eligibility claims `pending` only —
  this is what keeps the registry worker-step from throwing).

### Deterministic loop blocks (no LLM — keeps the control experiment clean)

- **`doneWhen`** — a handler, evaluated in this order. **(1)** Any required
  task `errored` / `cancelled` (retry budget exhausted) → `errored`. The board
  runs `onError: "skip"` and the `wait`/`shouldExit` drain also exits when a
  task has errored and nothing is claimable — without this branch a failed
  drafter would fall through to `in_progress` and the snapshot would report a
  dead run as merely stuck. **(2) Deterministic acceptance check, independent
  of any human**: the goal carries a machine-checkable criterion (the vet
  pins `minRevisions: 1` — a deliberately mechanical stand-in for a real
  acceptance evaluator; an LLM evaluator is a drop-in since the slot is a
  block). Unmet → `replan` with no human in the loop. This clause is what
  exercises "goal-completion judgment changes the outcome" *on its own* —
  without it, `doneWhen` collapses into a relay of the human verdict and the
  vet would only prove the checkpoint round-trip, not goal judgment.
  **(3)** Acceptance met: if no approval task exists yet for the accepted
  draft → `replan` (it seeds the first approval task); else newest approval
  task `completed` with `verdict: "approve"` → `done`; `completed` with
  `verdict: "reject"` → `replan`; still `awaiting_review` with deps met →
  `blocked_on_human`; otherwise `in_progress`.
- **`replan`** — a handler, keyed to which `doneWhen` branch fired. On an
  unmet acceptance criterion: seed a revise task only (`assignee: "drafter"`)
  — no human task yet. When the acceptance check first passes with no open
  approval task: seed the first approval task (`awaiting_review`,
  `assignee: "human:approver"`) — `start` never seeds it, so a human can
  never approve an artifact the goal check hasn't accepted. On `reject`:
  write the human's `feedback` to the workspace's `latestFeedback` field —
  the SAME field the capability preset renders and the commit tap echoes
  (nothing else writes it, so a non-null `feedbackEcho` is unambiguous) —
  then seed a revise task plus a fresh approval task (`awaiting_review`,
  dep on the revise task).

An LLM evaluator is a drop-in later — the slot is a block — but the vet keeps
loop mechanics deterministic so a flaky model can't masquerade as a broken
concept.

### The board

A session-scoped **wildcard** resource collection declared on the flow
(`resources: { workstreamTasks: ... }`, pattern `workstreamTasks/*`), handed
to `taskBoard` via its collection-factory slot as
`getOrCreateTaskCollection({ backing: "resource", collection: ... })`. This is
the seam Wave 1 deferred, exercised in app space.

Two constraints discovered in review, encoded here:

- **Pattern shape:** collection patterns take wildcards, not `{id}` braces,
  and the task collection creates instances with *string* task-id keys — so
  the collection's instances ARE the tasks (`workstreamTasks/<taskId>`). The
  vet runs one board per session; multi-board identity (a key prefix or a
  second collection) is deferred.
- **Idle mode:** `onIdle: "complete-or-blocked"` treats `awaiting_review` as
  in-flight and would spin on the open human task. The board therefore runs
  `onIdle: "wait"` with a `shouldExit` of: nothing `in_progress` AND no
  claimable task — i.e. exit when only human-blocked (or terminal) work
  remains. "Claimable" must be a **local ~5-line predicate** (a `pending`
  task whose deps are all `completed`, via `collection.list({ status:
  "pending" })` + dep checks): the substrate's `hasClaimableTask` lives in
  `packages/patterns/src/task-board/shared.ts` and is NOT exported from the
  public subpath, and the vet is zero-`packages/*` by rule. A first-class
  `complete-or-external` idle mode (and exporting the predicate) is a named
  productization follow-up, not vet scope.

Board config otherwise: `workers: { drafter }`, `dispatcher: "topological"`.
The registry form routes every claimable task by `task.assignee` and THROWS
on a pending task without one — so every draft/revise task is seeded with
`assignee: "drafter"`; only human tasks carry `human:approver`.
**No `ctx.suspend()` anywhere in this flow** (success criterion 3).

### The shared workspace (workstream-as-capability)

`workstreamWorkspace` — a session resource holding the draft + revision
history, wrapped in a capability that contributes a context preset (board
summary + latest human feedback) to every member via `uses`. The drafter's
draft lands in the resource through the deterministic commit tap (above), and
`status` reads it back without touching the drafter. This proves the "every
member gets the shared surface by one `uses` injection" claim with n=1 member;
multi-member injection is the same mechanism.

### The advance loop (the hand-rolled workstream)

One sequencer, re-entered by every **mutating** action (`start`, `decide`,
`advance`). `status` bypasses it entirely — a pure snapshot read must never
drain the board, or a read-back that happens to see claimable work would
advance it and the persistence proof would stop distinguishing reads from
advancement:

```
ensureBoard (seed goal tasks if empty)
  → taskBoard drain            (claims pending drafter tasks, runs them;
                                exits via shouldExit when only human tasks remain)
  → doneWhen                   (handler; classifies the board)
  → replan (only on "replan")  (handler; seeds revise + approval tasks)
  → loopBack to drain          (when replan seeded work, maxIterations guard)
  → snapshot                   (always the action's return value)
```

### Actions

| Action | Input | Behavior |
| --- | --- | --- |
| `start` | `{ goal: string }` | Create the session board if absent, seed the draft task only (`assignee: "drafter"`), run the advance loop. No approval task yet — `replan` creates the first one after the acceptance criterion passes. |
| `decide` | `{ verdict: "approve" \| "reject", feedback?: string }` | Find the open approval task and **`collection.complete(taskId, { verdict, feedback })`** — `awaiting_review → completed` is a legal transition. Explicitly NOT `resumeFromReview`: that re-pends the task, making it claimable, and the registry router throws on the unknown human assignee. Then run the advance loop in the same request. |
| `advance` | `{}` | Just run the advance loop. Exists to prove a *fresh* request can pick the board up with no other input. |
| `status` | `{}` | **Zero-model** snapshot read (the trading-desk `runSummary` precedent). |
| `resolve` | `{ taskId?: string \| null, output: unknown }` | **The general human-resolution surface.** Complete any ACTIONABLE human task — approval seat or WORK seat — with an arbitrary output, then advance. `decide` is sugar over this shape (output = the verdict). |
| `startUnchecked` | `{ goal: string }` | **The control.** Same drafter, same board wiring, but no approval task and no `doneWhen`/`replan` — drain once and return. Must be behaviorally equivalent to `planAndExecute` on the same goal. |

**Human WORK tasks (extension, 2026-07-02):** `start` accepts
`humanBriefFirst: true`, seeding a whole task assigned to a human
(`human:requester`, "provide the requirements") that dep-gates the first
draft. The human's `resolve` output flows into the drafter through ordinary
substrate dep materialization — no custom plumbing. This forced a classifier
reorder: the **generic human-gate check runs before the acceptance check**
(any actionable human task → `blocked_on_human`), otherwise a work task
gating the first draft trips a spurious acceptance replan before the
requirements exist.

### The snapshot (what a request returns)

Every action returns the same shape — the concept doc's "board-state snapshot,
not a terminal answer":

```ts
{
  workstreamStatus: "done" | "blocked_on_human" | "in_progress" | "errored",
  goal: string,
  tasks: Array<{ id, title, status, assignee, attempts }>,
  blockedOnYou: Array<{ id, title, feedbackWanted: boolean }>,  // open human tasks with deps met
  artifacts: { draft: string | null, revisions: number, feedbackEcho: string | null },
}
```

## Proof script

Run from `apps/kitchen-sink` (config search is cwd-only). One session
throughout; every invocation is a **separate OS process** — that separation is
the point. Three env preconditions, all of the "harness failure must not look
like concept failure" kind:

- **`FSD_ENV=dev`** — kitchen-sink selects the `prod` (Postgres) profile
  whenever `FSD_ENV=prod` or a `DATABASE_URL`/`FSD_DB_URL` is present in the
  shell; the explicit `dev` pin makes the profile deterministic.
- **`STORE_TYPE=filesystem`** — the `dev` profile defaults to in-memory
  stores, which would fail the cross-request criterion for harness reasons.
  With it, state persists under `.fsdev/data`.
- **A model source, one of two modes.** Default for the vet:
  **`KITCHEN_SINK_TEST_MODE=1`** — the deterministic `wsvet-drafter-gen` mock
  (`test/mock-flowstate.ts`), so loop mechanics are tested with zero provider
  dependence (this is the mode the Results below ran in). Optional live pass:
  unset the test mode and set **`AI_GATEWAY_API_KEY`** — the drafter's
  `intent/utility` model resolves through the Vercel gateway, which the
  config only wires when the key is present; without either, request 1 dies
  before ever touching the board.

```bash
export FSD_ENV=dev
export STORE_TYPE=filesystem
export KITCHEN_SINK_TEST_MODE=1   # deterministic mock drafter (the default)
# Live-model variant instead: unset KITCHEN_SINK_TEST_MODE and set AI_GATEWAY_API_KEY.
SID=wsvet_$(date +%s)

# Request 1 — start. Expect: draft written, then the request ENDS with the
# workstream open.
pnpm fsdev run workstream-vet start \
  -i '{"goal":"Produce an approved brief on ACME"}' \
  --session "$SID" --capture .fsdev/wsvet/1-start.json --quiet
# assert: exit 0; snapshot.workstreamStatus == "blocked_on_human";
#         artifacts.draft != null; blockedOnYou has the approval task;
#         artifacts.revisions == 1 — the acceptance check already forced one
#         auto-replan BEFORE any human was involved (goal judgment changed
#         the outcome on its own).

# Request 2 — human rejects with feedback. Expect: replan, drafter revises,
# blocked on the NEW approval task.
pnpm fsdev run workstream-vet decide \
  -i '{"verdict":"reject","feedback":"Too long; cut to one page and add pricing."}' \
  --session "$SID" --capture .fsdev/wsvet/2-reject.json --quiet
# assert: snapshot shows another revise task completed (human-driven this
#         time), artifacts.revisions == 2, feedbackEcho == "Too long; …",
#         workstreamStatus == "blocked_on_human", a FRESH approval task in
#         blockedOnYou (not the original).

# Request 2b — cold read-back from yet another process (board persistence).
pnpm fsdev run workstream-vet status -i '{}' \
  --session "$SID" --capture .fsdev/wsvet/2b-status.json --quiet
# assert: identical board contents to 2's snapshot; zero model calls.

# Request 3 — human approves. Expect: done.
pnpm fsdev run workstream-vet decide \
  -i '{"verdict":"approve"}' \
  --session "$SID" --capture .fsdev/wsvet/3-approve.json --quiet
# assert: workstreamStatus == "done"; blockedOnYou empty.

# Control — same goal, no doneWhen / no human task. Must finish in ONE request.
pnpm fsdev run workstream-vet startUnchecked \
  -i '{"goal":"Produce an approved brief on ACME"}' \
  --session "${SID}_control" --capture .fsdev/wsvet/4-control.json --quiet
# assert: workstreamStatus == "done" in this single request; no approval task
#         ever existed; artifacts.revisions == 0 — i.e. planAndExecute-shaped.
```

The control run is the falsifiable check that the delta (goal loop + human
checkpoint) is what the three-request behavior above is made of — not
incidental wiring.

## Success criteria (each with an evidence path — BP-003)

1. **The board outlives a request.** `2b-status.json` (a fresh process, zero
   models) lists the same tasks request 2 left behind.
2. **Goal evaluation changes the outcome — twice, from two independent
   sources.** The acceptance check replans with no human involved
   (`1-start.json` shows `revisions == 1` before any `decide`), and the human
   reject replans again (`2-reject.json` shows `revisions == 2` and a second
   approval task). The first is the goal-judgment clause on its own; the
   second is the checkpoint clause.
3. **HITL is pure board semantics.** `rg -n "suspend" flows/workstream-vet/`
   (run from `apps/kitchen-sink`, the same cwd as the proof script) returns
   nothing; requests 1 and 2 exit 0 with the workstream open.
4. **The shared workspace works via capability injection — proven at two
   layers.** (a) *Capability path:* a vitest unit test (the write-block-tests
   convention, mocked generator via `@flow-state-dev/testing`) asserts the
   drafter's RENDERED context contains the feedback the preset formats — the
   only deterministic proof that the preset actually reached the generator; a
   post-generator read can pass even if `uses` was never wired. (b) *Data
   path, headlessly:* the commit tap stamps `feedbackEcho` (surfaced on the
   snapshot's `artifacts`) read from the same workspace field the preset
   renders, so `2-reject.json` shows the injected data was live at generation
   time. Whether the revision *visibly reflects* the feedback stays a
   non-gating observation. `status` reads the artifact back without touching
   the drafter.
5. **The control degenerates.** `4-control.json` shows `startUnchecked` ≈
   planAndExecute — proving workstream's differentiation is exactly the two
   clauses under test.

## Kill criteria

- The resource-backed board cannot round-trip across requests without engine
  or `packages/*` changes → the floor doesn't exist yet; the Layer-2
  conventions must not assume it. File the substrate issue; pause the noun.
- The human task cannot be represented without modifying worker-step /
  registry / check-board semantics → same: pattern-first follow-up, not
  app-space vet. (The `onIdle: "wait"` + `shouldExit` route is the app-space
  escape; if *that* proves insufficient, this criterion trips.)
- The control experiment shows no meaningful delta → workstream is a costume
  over planAndExecute; keep strategies as the vocabulary and drop workstream
  from the centerpiece position.

## Out of scope (named seams, deliberately not built)

- **Durable background advancement** (work continues with no request open) —
  the ceiling; FIX-636/637 territory. The vet proves the *floor*
  (request-driven advancement over a persistent board).
- **Event gates** (declared external events a task waits on) — arrives with
  durability, not before.
- **Executor / dynamic team assembly** ("executor present + no team → it
  assigns") and **hire** (minting agents from archetypes) — v-next of the
  pattern; the vet uses a static team.
- **Nested workstreams / board-in-board** — one board + subtasks for now;
  isolation-needing children are the concept doc's deferred question.
- **Multi-board identity** — one board per session in the vet; a key-prefix or
  second-collection scheme comes with productization.
- **Claim/conflict hardening for concurrent multi-writer boards** — required
  before the durable ceiling, unexercised by a single-request-at-a-time vet.
- **Any `packages/*` change** — incl. reversing the Wave-1 "no session-scoped
  skill boards" decision and adding a `complete-or-external` idle mode. On
  green, both are the productization PR's explicit, reviewed decisions.

## Decision log (carried in from the design conversation)

- One `workstream` pattern; "dynamic" is not a separate concept — it's the
  branch where an executor is present and no team is given.
- **assign** = place an existing agent into a role (v1). **hire** = mint a new
  agent from an archetype (deferred).
- Human checkpoints are *tasks*, not gate config. No `gates:` knob exists.
- Human decisions land via `complete(taskId, output)`, never
  `resumeFromReview` — re-pending a human task makes it claimable and the
  worker registry throws on unknown assignees.
- Board default scope is **session**; a request advances a slice. Request-
  bounded boards cap the concept and were rejected.
- Board idle mode for the vet is `wait` + `shouldExit` (ignore
  `awaiting_review`), because `complete-or-blocked` deliberately holds the
  loop open for review tasks (FIX-443 §10.1).
- Proof evidence must be deterministic: the draft persists via a commit tap,
  not a voluntary model tool call; `doneWhen`/`replan` are handlers.
- Goal acceptance is a deterministic criterion checked BEFORE any human task
  is seeded (`minRevisions` stand-in), so goal judgment is exercised
  independently of the approval round-trip — the two clauses under test must
  not collapse into one.
- The workstream injects its shared board + tools into every member as a
  capability (`uses`), reusing the existing capability machinery.
- Housing on green: the runtime pattern → `packages/patterns` (beside
  `supervisor` et al.); `assign`/`assemble` sugar → `packages/workforce`.
  No `packages/workstreams`.
- HITL model: the board model (this vet), not durable `ctx.suspend()`.
  Convergence between the two is a named follow-up.

## Results (2026-07-02) — GREEN

The prototype is built at `apps/kitchen-sink/flows/workstream-vet/` and the
full proof script ran green with the drafter mocked
(`KITCHEN_SINK_TEST_MODE=1`, deterministic `wsvet-drafter-gen` mock in
`test/mock-flowstate.ts`) over `STORE_TYPE=filesystem`:

1. **`start`** → exit 0, `blocked_on_human`, draft present, approval task in
   `blockedOnYou`, and `revisions == 1` — the acceptance check forced an
   auto-replan before any human was involved. ✅
2. **`decide reject`** → second (human-driven) revision, `revisions == 2`,
   `feedbackEcho == "Too long; …"` (the tap read it from the workspace field
   the preset renders), a FRESH approval task open. ✅
3. **`status`** (separate process, 1 item, zero models) → identical board
   contents to request 2 — the session board round-tripped across OS
   processes. ✅
4. **`decide approve`** → `done`, `blockedOnYou` empty. ✅
5. **Control (`startUnchecked`)** → done in ONE request, one task total,
   `revisions == 0`, no approval task ever existed — planAndExecute-shaped. ✅
6. `rg -in "suspend" flows/workstream-vet/` → no matches; 13/13 unit tests
   (`test/workstream-vet.test.ts`) pass, incl. criterion 4a in its strong
   form — the REAL drafter generator run against a mock model resolver with
   `input.feedback: null`, proving the capability preset is the only path
   that carried the workspace feedback into the rendered call — and 4b (the
   tap echo). The tests also enforce that a decide can only land on an
   ACTIONABLE approval (deps completed), closing a race where a premature
   approve could mark the workstream done before the revised draft existed.

**Human-work extension (2026-07-02), also GREEN:** `start` with
`humanBriefFirst: true` → `blocked_on_human` on the requirements task with
the draft still gated (`pending`, zero models, and — the classifier-order
proof — no spurious acceptance replan at `draftsWritten: 0`); `resolve` with
real requirements → the gated draft unlocked and ran with the human's output
in its rendered call (dep materialization, verified in the capture), the
acceptance auto-revise fired, first approval seeded; `decide approve` →
`done`. 16/16 unit tests.

**Verdict evidence: the workstream is load-bearing.** The checked/control
delta is exactly the two clauses under test, both exercised independently.
One classification bug was found and fixed by the unit tests (an
`awaiting_review` approval with an unmet dep must classify `in_progress`,
not `blocked_on_human`). One cosmetic substrate note for productization:
under the factory backing the board-meta item reports
`terminationReason: "blocked-by-failures"` when exiting around an open
`awaiting_review` task — misleading label, harmless behavior.

## Learnings & implications (the two phases)

The vet's zero-`packages/*` constraint forced everything the real primitive
should own into app space — and each point of friction is a signpost. This
section is the record the productization spec and the workforce-conventions
writeup should be written against.

### L1 — A workstream is a durable process with an interaction protocol

The prototype's actions are the tell: `start` posts a goal, `decide` posts a
verdict, `resolve` posts a task output, `advance` posts nothing — and all of
them run the identical advance loop. That's not N actions; it's ONE protocol:

> workstream = a durable, identified, session-lived process + a uniform
> surface: **post** (task / guidance / goal revision), **resolve** (complete
> an external task), **advance**, **snapshot**. Every interaction is a post
> followed by an advance; the request is just the vehicle.

"Durable" means more than resumable-after-interruption: the process exists
across calls, and callers add tasks or nudge it mid-flight. The concept doc
derived the same shape from theory (§11: a request is one way to interact
with an ongoing workstream); the build re-derived it from friction.

Corollary: **the advance loop belongs to the runtime, not to actions.**
`doneWhen`/`replan` proved out as the right *slots*; the loop that drives
them (and advance-on-post) is the primitive's job.

### L2 — Approval is the degenerate human task; `resolve` is the primitive

A whole task can be assigned to a human (`human:*` seats): goal = real work,
output = whatever downstream tasks consume via ordinary dep materialization
(proven end-to-end in the extension). An approval is just a human task whose
output schema is a verdict — `decide` is sugar over `resolve`. Consequences:

- The classifier's generic human-gate (any actionable human task →
  `blocked_on_human`) must precede goal-acceptance evaluation.
- "Resolve only actionable tasks" (deps completed) is *protocol*, not app
  logic — the substrate's resolve operation should enforce it for everyone.
- Human/external participants deserve first-class representation (a declared
  external-assignee kind), not the born-`awaiting_review` trick + a registry
  that throws on unknown assignees.

### L3 — Two HITL mechanisms, one decision rule

FSD now demonstrably has two: durable-suspend (`ctx.suspend()`, request-
scoped) and board-task HITL (process-scoped, proven here with zero suspend
machinery). They are complementary, split by *who owes the answer and does
the current request need it to finish*:

- **Suspend** when the CURRENT CALLER must answer for the CURRENT REQUEST to
  complete — synchronous feel, user present, one gate in a pipeline.
- **Board task** when the PROCESS needs human work independent of any
  request — possibly a different person, a different channel, hours later,
  DAG-positioned so sibling work continues around it. Suspend pauses a
  pipeline at a point; a board task gates only its dependents.
- They compose: a suspended request can be the *transport* that delivers a
  resolve. Transport choice, not model choice.

### L4 — The workspace splits three ways: state / content / journal

- **State** = the standardized workstream envelope (status, goal, gate
  counters) — pattern-owned, identical across workstreams. This is what
  makes a GENERIC workstream inspector and a universal `blockedOnYou`
  possible. The prototype wrongly mixed app payload (`draft`,
  `feedbackEcho`) into it.
- **Content** = the members' scratchpad — freeform, schema-less, rendered
  into context via `readContent`. In the file-conventions layer this is
  literally a markdown document.
- **Journal** = the append-only record of posts/decisions/replans.
  `feedbackEcho` is a one-slot journal we reinvented under review pressure
  because the real one doesn't exist; the board's transient `task-change`
  items are the stream that wants to become a durable resource journal.
  **The resource-journal seam is a substrate dependency both phases want.**

### L5 — Substrate punch-list (each found the hard way)

1. Resource-backed boards need a front door (the collection-factory escape
   works but nothing exposes it).
2. A first-class `complete-or-external` idle mode + export the claimable
   predicate.
3. First-class external assignees (see L2).
4. Resolve-only-actionable enforced by the substrate (see L2).
5. Task-level message payloads: `TaskInit` has no feedback/guidance slot —
   we smuggled it through `input`; the post/journal design should own this.
6. Cosmetic: board-meta labels a human-blocked exit `"blocked-by-failures"`.

### Phase A — the standalone pattern (FSD)

The earlier "workstream() returns a sequencer you paste into actions" sketch
is the PROTOTYPE's shape, not the feature's. The real shape is a process
definition that GENERATES its interaction surface:

```
defineWorkstream({ goal, strategy, team | executor, doneWhen?, replan?, workspace? })
  → standard actions auto-exposed: post / resolve / advance / snapshot
  → standardized envelope state; content + journal for everything else
```

Scope: the factory + the L5 punch-list, on-demand/foreground only. Durable
BACKGROUND advancement stays the deferred ceiling — nothing in the vet
forced it forward.

### Phase B — the workforce conventions (workstream at the center)

The learnings simplify Phase B:

- The action gradient collapses: a `workstream:` action is "which posts does
  this channel expose"; `employ:` is a workstream-of-one whose post is the
  user message; channels/schedules/events are all *sources of posts to a
  process* — one mental model.
- The workspace maps onto the org metaphor natively: journal = the project
  log, content = the working documents, state = the standardized status
  report. Authors never write an envelope schema; custom scratch is just
  markdown — exactly what a file-first authoring layer wants.
- The standardized envelope buys the 90% case a finished feel: one generic
  workstream status view for every app.
- "Nudge a running workstream by posting" is the same surface a runtime
  executor (and the roster-introspection work) would use — the seam we
  agreed to name-not-build now has a concrete shape.

### Not established (honesty ledger)

Multi-member concurrency under real contention, event gates, the dynamic
executor, model-quality behavior (drafter mocked), durable background
advancement. None block Phase A's on-demand scope; all stay named-deferred.

## Follow-ups on green (not part of the vet)

1. `workstream()` factory in `packages/patterns` implementing the proven loop;
   `assign`/`assemble` in `packages/workforce`.
2. A first-class board idle mode that exits cleanly around open external
   (human/event) tasks — `complete-or-external` — replacing the vet's
   `wait` + `shouldExit` workaround.
3. Update the Layer 2 concept doc's package decision (one-package plan →
   additive pattern + workforce sugar) so doc and code agree.
4. The Wave-1 session-board reversal as its own reviewed change.
5. Evaluator-as-generator variant of `doneWhen` (drop-in, slot is a block).
6. The FIX-867 conventions writeup (b), now standing on a vetted centerpiece.
