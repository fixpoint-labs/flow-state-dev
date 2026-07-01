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

- **`doneWhen`** — a handler. Checked **first**: any required task `errored` /
  `cancelled` (retry budget exhausted) → `errored`. The board runs
  `onError: "skip"` and the `wait`/`shouldExit` drain also exits when a task
  has errored and nothing is claimable — without this branch a failed drafter
  would fall through to `in_progress` and the snapshot would report a dead run
  as merely stuck. Then: newest approval task `completed` with
  `verdict: "approve"` → `done`; `completed` with `verdict: "reject"` →
  `replan`; still `awaiting_review` with deps met → `blocked_on_human`;
  otherwise `in_progress`.
- **`replan`** — a handler. On `reject`, seeds two tasks: a revise task for the
  drafter carrying the human's `feedback`, and a fresh approval task
  (`awaiting_review`, dep on the revise task).

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

One sequencer, re-entered by every action:

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
| `start` | `{ goal: string }` | Create the session board if absent, seed draft task + approval task, run the advance loop. |
| `decide` | `{ verdict: "approve" \| "reject", feedback?: string }` | Find the open approval task and **`collection.complete(taskId, { verdict, feedback })`** — `awaiting_review → completed` is a legal transition. Explicitly NOT `resumeFromReview`: that re-pends the task, making it claimable, and the registry router throws on the unknown human assignee. Then run the advance loop in the same request. |
| `advance` | `{}` | Just run the advance loop. Exists to prove a *fresh* request can pick the board up with no other input. |
| `status` | `{}` | **Zero-model** snapshot read (the trading-desk `runSummary` precedent). |
| `startUnchecked` | `{ goal: string }` | **The control.** Same drafter, same board wiring, but no approval task and no `doneWhen`/`replan` — drain once and return. Must be behaviorally equivalent to `planAndExecute` on the same goal. |

### The snapshot (what a request returns)

Every action returns the same shape — the concept doc's "board-state snapshot,
not a terminal answer":

```ts
{
  workstreamStatus: "done" | "blocked_on_human" | "in_progress" | "errored",
  goal: string,
  tasks: Array<{ id, title, status, assignee, attempts }>,
  blockedOnYou: Array<{ id, title, feedbackWanted: boolean }>,  // open human tasks with deps met
  artifacts: { draft: string | null, revisions: number },
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
- **`AI_GATEWAY_API_KEY`** must be set — the drafter's `intent/utility` model
  resolves through the Vercel gateway, which the config only wires when the
  key is present. Without it, request 1 dies before ever touching the board.

```bash
export FSD_ENV=dev
export STORE_TYPE=filesystem
# AI_GATEWAY_API_KEY must already be set — verify before starting.
SID=wsvet_$(date +%s)

# Request 1 — start. Expect: draft written, then the request ENDS with the
# workstream open.
pnpm fsdev run workstream-vet start \
  -i '{"goal":"Produce an approved brief on ACME"}' \
  --session "$SID" --capture .fsdev/wsvet/1-start.json --quiet
# assert: exit 0; snapshot.workstreamStatus == "blocked_on_human";
#         artifacts.draft != null; blockedOnYou has the approval task.

# Request 2 — human rejects with feedback. Expect: replan, drafter revises,
# blocked on the NEW approval task.
pnpm fsdev run workstream-vet decide \
  -i '{"verdict":"reject","feedback":"Too long; cut to one page and add pricing."}' \
  --session "$SID" --capture .fsdev/wsvet/2-reject.json --quiet
# assert: snapshot shows a revise task completed (drafter ran again),
#         artifacts.revisions == 1, workstreamStatus == "blocked_on_human",
#         a FRESH approval task in blockedOnYou (not the original).

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
2. **Goal evaluation changes the outcome.** The reject path *replans* (revise
   task seeded and executed) rather than terminating — visible as
   `artifacts.revisions == 1` and a second approval task in `2-reject.json`.
3. **HITL is pure board semantics.** `rg -n "suspend" apps/kitchen-sink/flows/workstream-vet/`
   returns nothing; requests 1 and 2 exit 0 with the workstream open.
4. **The shared workspace works via capability injection — proven
   deterministically.** The drafter's commit tap lands the draft in the
   workspace resource AND stamps a `feedbackEcho` field read from the *same
   workspace field the capability's context preset renders* — so
   `2-reject.json` showing `feedbackEcho == "Too long; …"` proves the injected
   data path was live at generation time, independent of what the model chose
   to do with it. Whether the revision *visibly reflects* the feedback is a
   non-gating observation, never a pass/fail criterion. `status` reads the
   artifact back without touching the drafter.
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
- The workstream injects its shared board + tools into every member as a
  capability (`uses`), reusing the existing capability machinery.
- Housing on green: the runtime pattern → `packages/patterns` (beside
  `supervisor` et al.); `assign`/`assemble` sugar → `packages/workforce`.
  No `packages/workstreams`.
- HITL model: the board model (this vet), not durable `ctx.suspend()`.
  Convergence between the two is a named follow-up.

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
