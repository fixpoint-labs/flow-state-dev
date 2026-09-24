---
name: issue-lifecycle
description: Drive one Linear issue through spec authoring, human direction approval, checked spec merge, implementation, and PR feedback; stop before human-controlled implementation merge. Bugs normally skip the spec. A thin event-driven coordinator dispatches bounded workers, holds compact state, and advances to the next real external wait.
argument-hint: "<Linear issue ID, e.g. FIX-123>"
---

# Issue Lifecycle

Take one issue to a merge-ready PR without you having to hand-drive each stage — and
without the session's token count ballooning over a lifecycle that spans spec review,
implementation, and several rounds of PR feedback. A feature starts at its spec; a **bug
starts at the fix**.

## The two ideas that make this cheap

1. **Thin orchestrator, heavy sub-agents.** This skill holds only *handles* (issue
   ID, spec PR#, impl PR#, branch, worktree) and a few lines of state. It never reads
   a spec or a diff into its own context. Every token-heavy phase — authoring the
   spec, implementing, answering a review round — runs in a **fresh sub-agent** that
   does the work in *its* context window and returns **≤ a screen** of summary
   (status, PR link, key decisions, open questions, blockers), then exits. The
   sub-agent's transcript is discarded; only the summary lands here. That is how the
   lifecycle stays affordable.

2. **One bounded step per invocation; the loop is event-driven.** A single
   invocation determines the current phase, takes the *one* next bounded action, and
   returns. It does **not** block waiting for human approval or CI. Waiting happens
   *between* invocations: the session ends its turn (holding ~zero context) and
   re-enters on an event — a PR webhook, your message, or a scheduled check-in. On
   re-entry it re-derives the phase from durable external state (Linear + the PRs),
   not from in-context history. Idle cost ≈ 0.

> Standalone, *this session's* event loop re-invokes the skill. Under `epic-lifecycle`,
> the epic coordinator is the event loop and dispatches a worktree-isolated worker to
> run the next step. Same step logic either way — so keep every step a self-contained,
> re-enterable unit.

## State — derive it, don't store a transcript

On each invocation, reconstruct the phase from a **small** read:

- **Durable truth:** the Linear issue state + whether a spec PR / impl PR exist and
  their status (open / review / CI / merged). Fetch these compactly (Linear — see
  CLAUDE.md → "Linear access" for the channel; the
  GitHub `pull_request_read` methods `get`, `get_check_runs`, `get_comments` — the
  approval-comment read — `get_reviews` — the approval-review read — and
  `get_review_comments` for inline diff threads).
  **Direction approval and observed merge are distinct facts.** Apply the canonical
  [`orchestration.md`](../../../docs/contributing/orchestration.md) → Gates and
  "Merging and amending a spec": human approval must bind to the reviewed head, with no
  self-approval or later human changes requested. Attribute an owner's label to its
  application event and reviewed revision; its presence alone never approves a changed
  head. Comments and in-session approval also need revision binding.
  The owner merging the spec PR is itself approval: no label or comment needed, and the
  merged head is the approved head.
  The coordinator never writes approval labels or mechanically merges. After approval,
  dispatch an existing `issue-worker` with the canonical **MERGE-ONLY** assignment,
  exact PR and reviewed head. Confirm its evidence before releasing implementation.
  A closed-unmerged PR does not satisfy this.
  Keep the approved head and observed merge separate in the handle cache.
- **Handle cache:** a compact record at `.orchestration/<ISSUE-ID>.md` (a **gitignored,
  session-only** directory — never `git add`/commit/PR it) — issue
  ID, **`route`** (`spec | direct` — see "Two routes in"), **`owner`** (the GitHub login whose
  approval *label* passes the gate — establish it on the first wake, ask if you don't know it,
  and never infer it from a PR author or a commit trailer, since this one authorizes work;
  without it the label channel is off and only comment/review approval works), spec PR#, impl
  PR#, branch,
  worktree path, current phase, the last action
  taken, the **spec-review round count** (see the convergence budget below), the
  **PR-feedback round count** (`prFeedbackRounds` — see the cap below), and any
  **in-flight or settled claim** (`settling: <claim> · poc: in-flight | <verdict>` — see POC
  settlement below; a settled claim's evidence lives in the spec's `DECISIONS.md`, not here). A few
  lines. Update it at the end of every step. It is a cache of handles,
  not a log of content.

Never rebuild state by re-reading prior sub-agent output. If you need detail, the
next sub-agent fetches it.

## Two routes in — derive the route before the phase

**A bug does not get a spec.** Read the issue's Linear **category label** on the first
wake and every refresh, and route on it — the rule, the reasoning, and the escape hatches
are canonical in [`orchestration.md`](../../../docs/contributing/orchestration.md) →
"Which issues get a spec":

| Category | Route | Entry phase | Gate before code |
|---|---|---|---|
| Feature · Enhancement · Improvement | **spec** | `NEEDS_SPEC` | spec approval |
| **Bug** | **direct** | `NEEDS_IMPLEMENTATION` | **none** — the impl PR is the review |

Three things put a bug back on the spec route, and only these. **You decide one; the
worker decides two** — the split matters because each is visible at a different moment:
**a spec PR already exists** is yours, re-derived here every wake (and the worker
re-checks it before building, since a row you discovered mid-wake may carry a spec handle
you haven't scanned yet); **no reproduction** and **it isn't really a bug** are the
worker's, decided before it writes any code and returned as `specRequired`. Record the route in the handle cache
as `route: spec | direct`, and re-derive it from the label each wake — relabelling an
issue re-routes it. **If you can't read the category, use `spec`**: failing closed costs
one unnecessary document, failing open ships ungated code.

A direct-route issue simply never enters `NEEDS_SPEC` or `AWAITING_SPEC_APPROVAL`. Every
other phase below, and every rule about PR feedback, the round cap, and merge, is
identical for both routes.

## Phases (advance to the next external wait, then end the turn)

**A satisfied gate is a release, not a stop — never end the turn *on* it.** "End the turn"
below means the next action is **waiting on an external signal** — a human gate not yet given,
CI, a review, a dependency PR still open. It does **not** mean "pause at every internal state
boundary." When a gate is *satisfied* (approval detected, a dependency just merged), the next
action needs no new external input, so **take it in the same wake** — do not end the turn and
do not wait for a heartbeat or a user nudge to continue. Concretely: the wake that detects spec
approval schedules the canonical MERGE-ONLY assignment. Continue on the next wake after
observed merge, or in the same wake through the explicitly authorized implement backstop.
Required checks or unresolved required threads are real external waits, not another
generic approval request. Implementation PR merge remains the user's separate gate.

| Phase (derived) | Next bounded action | Then |
|---|---|---|
| **NEEDS_SPEC** — spec route, no spec yet | Dispatch `issue-spec`: author `SPEC.md`, `DECISIONS.md`, `BUSINESS-RULES.md`, `PLAN.md`, `DOCS.md`, conditional `EVOLUTION.md`, and owned artifacts under `specs/issues/<ISSUE-ID>/`; open ready for review. | Surface the direction ask and PR; record handles → AWAITING_SPEC_APPROVAL. |
| **AWAITING_SPEC_APPROVAL** — spec PR not yet merged | On review events within the existing budget, dispatch Step 6.5 and preserve its reported counters. Human approval binds to the reviewed head. After approval, dispatch `issue-worker` **MERGE-ONLY** under the canonical merge contract with the PR and reviewed head. Observe merge; never infer it from approval or closure. If the owner merged the spec PR themselves, that merge is the approval: skip MERGE-ONLY and go straight to implementation. | If blocked, report the actual approval/check/merge wait, not another approval ask. Resume implementation on the next wake after observed merge; an authorized implement backstop may continue in the same wake. |
| **NEEDS_IMPLEMENTATION** — spec confirmed merged, or direct-route bug | Dispatch `issue-implement` on a base containing the merged spec. Direct-route `specRequired` re-routes to NEEDS_SPEC. Multi-PR plans advance via `issue-multi-pr` only after the same spec merge gate. | Record implementation PRs; subscribe → PR_FEEDBACK. |
| **PR_FEEDBACK** — impl PR(s) open | On each **PR event** (new review comments / CI) on any open impl / sub-PR, *and only while the round cap allows* (see below): dispatch a fresh bounded sub-agent to run `issue-implement` Step 10 for that batch — react, fix, reply, push — exit; add the rounds it reports spent to `prFeedbackRounds`. | End turn between events. When a PR is approved + green: surface **"ready to merge"** and stop (merge is the user's). Multi-PR: a merged dependency unblocks its dependents (they return to NEEDS_IMPLEMENTATION); after the **last** sub-PR merges the issue is **not** yet DONE — run the assembled end-to-end goal first (see [Multi-PR issues](#multi-pr-issues-pr-plan) §4). |
| **DONE** — impl PR merged **and** (multi-PR) the assembled goal passed | none | Update the cache to DONE; report completion. |

## Surfacing to the user (every "surface" above means this)

Four things in the table reach the user — the spec-approval gate, a worker's blocker, the
PR-feedback cap, and "ready to merge". All four are **decisions put to a product owner**, written
per [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) (canonical for
the shape, the batching, and when not to ask at all) and batched under one `Need your sign-off`
heading.

Two failure modes are specific to this lifecycle, because they come from what a coordinator holds:

- **"The spec PR is open, please approve."** That is a link, not an ask — it hands the framing
  to the person least able to do it. Say what the direction buys, which calls are hard to
  reverse, and what you'd do.
- **Relaying a worker's blocker verbatim as a topic.** You hold status lines, not the code, so
  the worker owes you the ask's parts and the row's `blocker` carries them
  (`.agents/subagents/issue-worker.md` → Return format). Surface those. Where a worker gave you
  only a phrase, say what you have and name what's missing — never invent the substance, and
  never reconstruct it from the event text (see "PR events are wake signals").

## The spec-review round budget (why AWAITING_SPEC_APPROVAL terminates)

A spec PR draws review from bots we don't control, which produce line-level feedback
without limit. Dispatching a Step 6.5 round for every event that arrives is an unbounded
loop — and it's the loop that used to grind a directionally-correct spec through ten
rounds. So this phase is **budgeted, not open-ended.**

**Default: two rounds.** Track the count in the handle cache (`specReviewRounds`; the older
`spec_review_rounds` spelling is still read, so an epic resumed from an earlier record keeps its spent
budget instead of silently starting a fresh two).

> **Two implementations, one rule.** Running standalone, *you* apply the budget as written
> below. Running under `epic-lifecycle`, the `epic-wake` workflow's `atReviewBudget()` applies
> it — the same rule as executable code, covering issue specs and the epic PR alike. Both
> derive from [`orchestration.md`](../../../docs/contributing/orchestration.md) → "The
> convergence rule", which stays canonical. **Change that doc first, then both.** A change to
> one alone is the drift this note exists to catch.

**Count rounds spent, not events dispatched.** The Step 6.5 sub-agent reports the rounds it
actually spent, and **a batch that was only factual corrections or broken references costs
zero** — those get fixed inline by rule precisely because they don't move the design. So add
what the worker reports; never increment blindly per event. Charging typo batches to the
budget would exhaust it on noise and then suppress the substantive feedback the budget exists
to make room for — the opposite of the point. Then:

- **Rounds 1–2** — dispatch Step 6.5 on the event batch as normal.
- **Round 2 returns** — the spec has **converged**. Surface it to the user for the approval
  gate, stating that it's converged and that remaining open threads are carried as
  implementer notes in the plan. Then **stop dispatching review rounds**; further spec-PR review events
  are logged in the cache and ignored until the gate resolves. The only event that still
  acts is a **human** one — a gate signal from
  [Gates](../../../docs/contributing/orchestration.md#gates-direction-approval-then-confirmed-merge)
  (in-session go-ahead, a non-owner human review with no agent header, or an owner label),
  or the user asking for a specific change. An owner-login review is not that signal.
- **A third round is allowed only when round two surfaced a genuine spec-level finding** —
  a new approach question, not more notes. The Step 6.5 sub-agent reports whether anything
  was spec-level; that flag is what authorizes the extra round. Say so in one line when you
  spend it, so the extra round is a visible decision rather than drift.

Stopping design rounds preserves the canonical convergence budget; it never waives
required branch checks or review-thread policy for spec merge. Below-the-bar feedback
remains implementer input, and implementation reviews the design against real code.
A bot review neither grants human direction approval nor extends the design budget.

The counter resets only if the *user* asks for a spec-level change after convergence — that
starts a fresh direction question, not another polishing pass.

## The PR-feedback round cap (why PR_FEEDBACK terminates)

The spec side is bounded by the budget above. The **implementation** PR is the other
unbounded loop, and the worse one: several reviewers comment on a diff, a worker fixes and
replies, the fixes draw fresh comments, and every round looks individually reasonable. Round
nine re-litigating round three is invisible from inside any single round.

**Default cap: twelve auto-handled rounds** (`prFeedbackRounds` in the handle cache). The
rule is canonical in [`orchestration.md`](../../../docs/contributing/orchestration.md) →
"PR feedback: the round cap"; under `epic-lifecycle` the `epic-wake` workflow's
`atPrFeedbackCap()` applies it as executable code. **Change that doc first, then both.**

Count rounds the worker reports **spent** (`prFeedbackRoundsSpent`), not events dispatched —
a batch of pure acknowledgements costs zero, an escalated blocker costs zero, an unreported
round is charged one. Then:

- **Rounds 1–11** — dispatch Step 10 on the event batch as normal.
- **Round 12 returns** — **stop dispatching.** The worker posted its pause comment on the PR
  during that round (see the dispatch contract below). Surface the question to the user with
  the round count, the open threads, and the worker's read on whether this is converging or
  looping. Further PR events are recorded in the cache and **not acted on** — no fixes, no
  pushes. The issue is parked: offer it no merge gate while it sits here.

**Every feedback dispatch carries the count** — the counter is *yours*, and the worker is a
**fresh sub-agent that cannot read this cache**. Tell it, in the prompt, every time:

- **`prFeedbackRounds` so far and the cap** (`n of 12 auto-handled rounds`), and
- **report `prFeedbackRoundsSpent`**: `1` for a normal pass, `0` for a batch that turned out
  to be only acknowledgements and process chatter.
- **On the last allowed round** (the count is 11), additionally: *if* this batch turns out to
  be a real round, it is the twelfth — finish it, then post the pause comment per
  `issue-implement` 10.7 and return the converging-or-looping read. If it turns out to be
  acknowledgements only, report `0` and post **no** pause comment; no round was spent and the
  loop continues.

Skip this and the cap degrades in both directions at once: an unprompted worker omits the
count, so every acknowledgement batch is charged one, and the batch that reaches twelve parks
the issue with **no** pause comment on the PR and no assessment to give the user — the two
things the cap exists to produce. (`epic-wake` builds exactly this into the `pr-feedback`
prompt; standalone, it is yours to build.)

**The user's answer is the release.** Record it, carry it verbatim into the next dispatch's
prompt (the escalating worker is gone — same handoff rule as any other blocker), and **reset
`prFeedbackRounds` to zero**, which is what un-parks the issue. Nothing else clears it; an
answer you never record leaves the issue parked and re-surfaced every wake.

The cap gates **feedback handling only**. On a multi-PR issue the DAG keeps advancing — a
ready slice, a rebase, the assembled goal — none of which is a feedback round.

## POC settlement (dispatch it, don't wait on it)

The budget bounds how many rounds we spend; it doesn't help when a thread keeps flipping
because it turns on a **factual claim about how the system behaves**. Once that claim has been
asserted and counter-asserted **twice**, it gets **run** instead of argued.
**[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed claim
(POC settlement)" is canonical** — the trigger, the claim slice, the costs, the fan-out bound.
Four things are the orchestrator's:

- **Dispatch on request, no approval needed.** A Step 6.5 worker returns
  `settle_requested: <claim slice>` rather than dispatching (it exits before a verdict could
  land); you dispatch the **`poc-agent`**. Record `settling: <claim> · poc: in-flight` in the
  handle cache, and **never hold a phase waiting on it** — the round budget is untouched, the
  spec keeps converging, and the approval gate stays reachable.
- **Disclose in-flight settlements at the gate**, in one line, when you surface the spec for
  approval. Non-blocking is not the same as unmentioned.
- **Do not hold the original PR open for later settlement edits.** The human sees any
  in-flight premise when approving its head. Required checks still precede spec merge,
  and confirmed spec merge still precedes implementation. Evidence arriving after merge
  belongs in a follow-up PR from `main`, not a reopened or pushed original.
- **Route verdicts immediately.** `CONFIRMED` records evidence; `REFUTED` amends the
  affected design and informs in-flight implementation, with renewed human approval if
  direction changes. `INCONCLUSIVE` stays `inconclusive: awaiting decision`; don't pretend
  it settled the claim. Use the current unmerged review PR or a new post-merge amendment
  PR as appropriate. Preserve the settlement budget and stop re-litigating settled claims.

## Under an epic, report live transitions accurately

Report spec approval and spec merge separately, plus implementation PR progress, on
the wake they occur. The coordinator derives live status from Linear and implementation
PRs; retained epic content describes approved intent. Do not edit that content or the
original merged PR on every phase transition. Meaningful design changes use amendment PRs.

## Linear status is a mirror you own

Linear's GitHub auto-status is **off** — it mis-fired on spec PRs, treating a spec PR's
open/merge as the *issue's* progress and closing issues early. So the lifecycle sets the
issue's Linear status **explicitly** at every phase transition, the same "PR is the
trigger, Linear state is the human-facing mirror, the orchestrator keeps it in step" rule
the epic objective gate already follows. Nothing else updates it now.

**The rule the auto-status got wrong: a spec PR is not the implementation.** A spec PR
only ever moves the issue *within spec review*; only the **impl** PR moves it to In
Review / Done. Never let a spec PR's open/close/merge push the issue toward Done.

Set the issue's status (`save_issue` with `stateId`, or `issueUpdate(input:{stateId:})`
on the API — see CLAUDE.md → "Linear access"; team `flow-state`
`1ec31154-539c-45d5-bee7-8d12f36357d6`) at each transition. IDs are inlined so no
per-write lookup is needed:

| Transition | Status | `stateId` |
|---|---|---|
| NEEDS_SPEC picked up (dispatching `issue-spec`) — *spec route only* | **In Spec Dev** | `16091670-e146-42a6-ac19-df1c13cd42c8` |
| Spec PR opened (→ AWAITING_SPEC_APPROVAL) — *spec route only* | **In Spec Review** | `520c428e-9e4d-41f9-bcf2-f6e84b6d1ec2` |
| Human direction approval detected (spec merge may still be pending) — *spec route only* | **Spec Approved** | `dfe5f095-467b-4b08-9494-693b928d0b86` |
| Implementation dispatched (`issue-implement` starts) | **In Development** | `53d6fd64-8136-42ea-b33c-65fd97d9dbf5` |
| Impl PR opened (→ PR_FEEDBACK) | **In Review** | `91df31a4-b3fd-4a3a-afd8-1b0496e7956e` |
| Impl PR merged (→ DONE) — single-PR; **multi-PR: only after the assembled goal passes**, not on the last merge | **Done** | `f5983dd3-92a5-4a9a-84d8-23e775b7fa8f` |

**A direct-route (bug) issue skips the first three rows** — it has no spec, so its first
mirror is **In Development** when implementation is dispatched, then In Review and Done as
normal. Writing a spec status for an issue with no spec is a lie the board can't recover
from: a human filtering "In Spec Review" would find an issue whose spec will never exist.

**Who writes it:** whichever agent effects or detects the transition, in the same step —
the worker sets it for a transition it *causes* (it opened the PR); the orchestrator sets
it inline (one cheap `save_issue` call) for a transition it *detects* on refresh (an
approving comment or review, a merge). Set it **idempotently** — if the issue is already in the
target state, leave it. On a multi-PR issue the status tracks the **whole** issue: In
Review while any impl sub-PR is open, Done only when every sub-PR is merged **and the
assembled goal has passed** (a spec PR never counts). If these IDs ever stop resolving (a workflow edit), re-fetch with
`list_issue_statuses` for team `flow-state` and update this table — don't guess.

## Multi-PR issues (PR plan)

When the spec declares a **PR plan** (a DAG of sub-PRs — `issue-spec` Large
issues, `PLAN.md → Sequence`), the `NEEDS_IMPLEMENTATION` and `PR_FEEDBACK` phases generalize
from one PR to the plan. The single spec-approval up front covers the whole plan; you
still stop before merge on each sub-PR.

Each invocation advances the plan by one bounded step, and **the step is a workflow**:
`issue-multi-pr` (`.agents/workflows/issue-multi-pr.js`). The DAG's mechanics are pure
procedure — which sub-PRs are ready, what base each one takes, which have been unstacked by a
merge, and whether the assembled goal is still owed — so they live as code with a verification
harness (`node .agents/workflows/verify.mjs`) rather than as prose to re-derive each wake.

```
Workflow tool:
  name: issue-multi-pr
  args: {
    issueId: "<ISSUE>",
    cap: <a few — one worktree per sub-PR>,
    subPrs: [ { id, dependsOn: [], branch, pr, status, stackedOn } ],
    assembledGoal: <persist VERBATIM — see below>
  }
```

**Re-invoke until the result names an external wait.** `deferred` is only one reason another step is
runnable, and keying on it alone ended the turn after every internal assembly transition — a failed goal
records its failure and the *next* action (file the gap) is immediately runnable, and since every slice PR
has already merged there is no PR event left to wake the session. The repair then waited for the heartbeat,
or indefinitely in an attended local run.

The workflow already names its waits, so use those rather than re-deriving its state machine. Run another
step unless the result carries one of:

- `done: true` — the assembled goal passed with evidence; the issue is finished.
- `awaitingFix` — a repair PR is open and a human has to merge it.
- `blockedGap` — the filed gap is blocked by a Linear relation someone else must move.
- `blocker` — a human decision is owed.
- `awaiting` — no DAG step is runnable at all. `awaiting.merge` lists slices open on the merge gate (or
  pending behind a dependency that has to merge first), `awaiting.decision` slices that escalated a fork,
  `awaiting.plan` slices refused as malformed — that last one isn't an external event, it's the `invalid`
  case below, and it needs the plan fixed rather than another call.

This is the state a multi-PR issue spends most of its life in: every slice built, every PR open, nothing
left but merges the human owns. It is on the *result* rather than re-derived from `subPrs` because the
workflow is the only thing that knows its own ready set — a table that looks runnable from outside may
have no classifiable node in it.

Anything else, including a non-empty `deferred`, is work this workflow can do the moment you call it again.
Cap-deferred slices are the clearest case: a `pending` slice has no PR, so nothing external will ever wake
it. The cap bounds concurrency, not scheduling.

**Persist `assembledGoal` verbatim, whole.** It is a state machine's state, not a handful of
flags: `passed` · `evidence` · `failure` · `owningSubPr` · `fixIssue` · `fixReady` · `fixPr` ·
`fixBlocker` · `fixMerged`. Dropping any one of them silently changes which state the next wake
computes — lose `failure` and it re-runs the expensive goal instead of filing its gap; lose
`fixReady: false` and it starts repair work `issue-manager` reported as blocked; lose
`fixBlocker` and it re-dispatches a worker at the fork it escalated. Round-trip the object; don't
pick fields out of it.

Two things you must carry back verbatim:

- **`stackedOn`** — set by the script from the base it chose, and it is what schedules the
  later rebase. Lose it and a stacked sub-PR silently keeps its dependency's commits in its own
  diff. It survives a *failed* rebase on purpose, so the next wake retries.
- **`fixPr` / `fixIssue`** — the repair a failed assembled goal opened. While either is set and
  `fixMerged` is false, the script refuses to re-run the goal; that's what stops a single
  failure filing a duplicate issue and PR on every wake. Both are tracked because the repair
  worker may legitimately file the issue without opening a PR. **Set `fixMerged: true` when the
  repair lands** — that is what re-arms the goal.

The script also returns **`invalid`**: sub-PRs that declare a `dependsOn` id absent from the
table. It refuses to build those rather than treating them as dependency-free — an unresolved
id means the PR plan or the handle cache is wrong, and guessing would build a dependent before
its prerequisite exists. Fix the table; it won't self-heal.

**It fails closed on the ambiguous cases, which can look like it's stalling:**

- A node with a **mix of merged and open dependencies** waits instead of stacking. The open
  dep's branch may have been cut before the merged one landed, so building on it would omit
  declared prerequisite code. Only a *sole* open dependency is a safe stack base.
- A **dead agent is not an outcome.** `incomplete: 'assembled-goal'` means the goal agent
  returned nothing, so no gap was filed and no repair opened — the next wake retries. A rebase
  that returns anything other than success keeps both its `open` status and its stack marker
  for the same reason.

What the script decides, so you don't:

1. **Base selection.** A sub-PR whose deps are all **merged** builds on fresh `origin/main`;
   one whose single dep is merely **open** *stacks on that dep's branch* so review can start
   before the dep merges. Two open deps are waited on rather than stacked arbitrarily.
2. **The rebase.** A stacked sub-PR whose deps have since merged comes off the stack onto
   `origin/main` — otherwise it carries the dep's commits into its own diff.
3. **The assembled goal.** Every sub-PR merged is necessary but **not sufficient**: each
   `issue-implement` run only proved its own slice, and the merges are the first moment the
   end-to-end goal is runnable. The script runs it on the real path before the issue can be
   DONE — always, from a fresh `origin/main` checkout, because the worktree it inherits may predate
   some of those merges. On FAIL it files the gap and opens a **new fix PR** owned
   by the breaking slice — the sub-PRs are merged and can't be reopened — and keeps the issue
   out of DONE until that lands.

`subPrs` comes from the handle cache and goes back to it: the `.orchestration/<ISSUE>.md` record
adds one row per sub-PR — `id · dependsOn · branch · PR# · stackedOn · status (pending / open /
merged)` — alongside the issue-level fields. (`issue-multi-pr` also accepts the `depends_on` spelling
the spec's PR-plan table uses, so a row copied straight out of the spec still carries its edges; write
`dependsOn` in new records. Getting this wrong used to read as *no dependencies*, which builds a
dependent onto `origin/main` beside the prerequisite it declared.) There is deliberately no `building`: a wake is
synchronous, so a sub-PR either has a PR (`open`) or doesn't (`pending`), and a status the script
can't act on is a node that waits forever. A table carried over from before this record shape
normalizes `building` back to `pending` on the way in, so the build simply retries. You hold only
this table, never
sub-PR content (same token discipline). **You still own every merge gate**: a dependency's merge
is an external event that re-enters this lifecycle, and the script never merges anything.

**Optional team-backed burst.** When agent teams are enabled and the independent
sub-PRs share interfaces that benefit from live coordination, the parallel build can
run as a team (the DAG is the shared task board) instead of independent workers.
Default is independent worktree workers — no team required.

**Single-PR issues are a one-node plan and don't use the workflow.** With no fan-out and no
DAG there is nothing for it to decide, and a background workflow would add a hop for zero
benefit — dispatch `issue-implement` directly, as the phase table says.

And as the PR_FEEDBACK row states: after the **last** sub-PR merges the issue is **not** DONE.
The script enforces that (a build wake never returns `done: true`), but the merge that makes
the assembled goal runnable is *your* event to act on — re-enter and run the workflow again.

## PR events are wake signals, not work items

**Canonical: [`orchestration.md`](../../../docs/contributing/orchestration.md) → "PR events are
wake signals, not work items".** Read it, don't re-derive it here. It is a *correctness* rule —
and the harness's own posture on PRs you opened (they're yours to drive green, so diagnose the
failure, push the fix, answer the reviewer) is louder than this heading and wins if you let it.

The issue-specific delta: **the phase table decides what the event becomes, and it is the
authority — not any summary of it, including this one.** Re-derive the phase from the small
durable read above, find the row, and take the action that row gives for *that kind of event*.

This section deliberately does not list the routes. The rows branch on the event — feedback,
an approval, approved-and-green — and the branches differ in which worker runs, which budget is
charged, and whether to dispatch at all. Every route written down here would be a rule that
outranks the row it was copied from and goes stale the moment the row moves.

## Your requests are dispatched too

**Canonical: [`orchestration.md`](../../../docs/contributing/orchestration.md) → "The coordinator
dispatches; it never does the work".** Read it, don't re-derive it here. Same rule as the section
above with the disguise removed — a mid-run request from **you** says *what* should happen, not
*who* does it — and it is the case that gets through, because a direct ask doesn't look like an
event at all.

The issue-specific delta: **this issue's own worktree is not yours to edit from here.** A side
request about a file this issue touches is dispatched to a phase sub-agent, so the change lands
inside the PR that is already under review; editing it from the orchestrator puts an unreviewed
commit on the branch a worker is mid-flight on. **Dispatch it in the wake it arrives** — an issue
sitting at "ready to merge" has no next phase action, so a request merely recorded is one the
merge then ships without — and hold the merge gate until it lands. A *change* to anything else is
a different issue: file it via `issue-manager` (Boundaries) rather than scope-creeping it into
this one. A read-only *lookup* is neither — that's a `scout`, not a ticket.

## Waking

**Re-subscribe on every invocation, not just when a PR first opens — and do it last, after**
**this invocation's dispatched sub-agent (if any) has returned.** On each wake, call
`subscribe_pr_activity` for whichever of the issue's PRs currently exist and are open (the
spec PR while it's live, the impl PR once opened) — unconditionally, every time, regardless
of whether this invocation just opened one of them. Subscribing before dispatching would miss
a PR this same invocation opens (e.g. NEEDS_SPEC dispatching the sub-agent that opens the
spec PR) — that PR wouldn't exist yet at that point in the turn. The call is idempotent, so re-subscribing
to a PR already subscribed costs nothing, and doing it every wake self-heals a missed or lost
subscription (a sub-agent opened the PR and exited before subscribing — sub-agents can't hold
one, only this loop can — or the session cold-resumed after a restart) instead of leaving
that PR silently deaf to events for the rest of the issue's life. **The spec-approval gate
rides that stream** — an approving comment or review is a delivered PR-activity event, so it
wakes this loop immediately (the reason the gate moved off a label, whose webhook never
arrives). As a fallback heartbeat for
transitions webhooks *don't* cover — CI success and merge — schedule a check-in
(`send_later`, ~30–60 min) and re-arm it while the issue is
live; stop once the impl PR is merged or closed. On each wake, re-read the spec-PR
approval signal rather than trusting a webhook arrived: in AWAITING_SPEC_APPROVAL, the go-ahead
is **the owner merging the spec PR** (no label or comment needed — the merge alone is the
sign-off), a message from the user in this conversation (`approvedInSession` on the reviewed head),
a non-owner human approving comment or review with no agent header, **or the `spec approved`
label** — check merge state, comments, reviews *and* labels, all small reads. An agent-mailbox header
(`from:` / `session:` / `kind:`, then a blank line) means the review or comment is
agent-authored and is not the gate. An approving review or comment under the owner login
with no such header is **suspect**: escalate it, do not treat it as sign-off, do not
implement. The owner is still not excluded merely for authoring the PR. Do not use
timestamps or prose style to decide. The label needs checking precisely because it
never wakes the session, so it is only ever found by looking. When you post a review or
PR comment, start the body with that header
([Gates](../../../docs/contributing/orchestration.md#gates-direction-approval-then-confirmed-merge)).
Approval detection is not merge detection: also read required checks, required thread
state, and actual merge status. An attributed label must identify the reviewed head;
a later push requires renewed revision-bound sign-off, not a standing-label bypass.

**Attribute the label before you accept it.** A GitHub label is writable by every collaborator
and by every bot with write access, so its presence is only half the test — read the PR
timeline's `labeled` events for `spec approved`, take the **most recent**, and require its
actor's login to be the **owner's** — the `owner` in this issue's handle cache, established on
the first wake. Not "a human": an agent with write access is not a human,
and a passing collaborator is not the owner. If you have no configured owner login, if the
timeline is unreadable, or if the most recent `labeled` event names anyone else, **treat the
label as absent** and fall back to the comment/review channels — and if it was the *owner
login* you were missing, say so once rather than silently, since someone signing off by label
alone is otherwise waiting on a channel nothing reads — an approval you cannot
attribute is not approval. Bind its application to the reviewed head as well: a push
after sign-off requires fresh revision-bound approval. Unknown timing/head provenance
fails closed. After confirmed merge, preserve that historical approval/merge receipt;
later amendments have their own gate rather than re-gating the original on label changes.

**A human `CHANGES_REQUESTED` holds approval of an open spec across all channels.**
Owner labels are head-bound, not standing authorization until removal: follow
[Gates](../../../docs/contributing/orchestration.md#gates-direction-approval-then-confirmed-merge).
A later push needs fresh revision-bound sign-off; a merged original retains its history.
Never poll with `sleep`.

**Both `subscribe_pr_activity` and `send_later` are cloud-only** — neither works in a local
Claude Code session (no reachable webhook endpoint, no server-side scheduler). Check whether
you're in a cloud session before relying on either; if local, arm a **`Monitor` poll loop
(the `watch-pr` skill)** on the issue's PR(s) as the wake signal. It replaces both: its
continuous tick polls the PR's **`state`/merge** meta as well as comments/reviews/CI, so a
quiet merge/close wakes the loop even when nothing else lands. (For an *unattended*
local run, still add a low-frequency `CronCreate` backstop against the Monitor subprocess
dying.) **Arming a Monitor is *not* idempotent** (unlike `subscribe_pr_activity`), so — unlike
the cloud subscription, which you re-assert every wake — **store the PR's Monitor handle in the
issue's `.orchestration/<ISSUE-ID>.md` cache and re-arm only when it's missing or dead**; a
re-arm on every re-entry would stack duplicate poll subprocesses, wake notifications, and API
traffic. See [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Environment:
cloud vs. local" for how to detect the environment and the full fallback design.

## Token discipline (the point of this skill)

- **Never** read a full spec, diff, or file into this orchestrator's context. Pass
  the issue ID / PR# to the sub-agent; it fetches what it needs. That holds when **you** are the
  one asking, not just when an event is
  ([Your requests are dispatched too](#your-requests-are-dispatched-too)).
- Every phase sub-agent returns **≤ a screen**. If it would return more, it is doing
  the orchestrator's job — tighten its prompt.
- Persist state as a handful of fields (the handle cache), so re-entry costs a small
  read, not a replay.
- Prefer event-driven wakes over scheduled ones; the heartbeat is a backstop.
- **Model tiering** (AGENTS.md): the orchestrator itself is thin — keep it on the
  default (Opus) for its routing judgment. Read-only status/handle fetches use the
  **`scout`** agent (Haiku); phase work runs through `issue-spec` /
  `issue-implement`, which tier their own sub-agents (Sonnet for decided execution).

## Boundaries

- **Discovered gaps/blockers** during the work get **filed via the `issue-manager` agent** (related to this issue, same project) — never dropped or scope-crept into it. It returns a ready/blocked verdict; under `epic-lifecycle`, an unblocked related one can join the epic's active set.
- One issue. For several related issues in parallel, use `epic-lifecycle` (it composes
  this skill, one worktree per issue, under a shared epic).
- This is the *coordinated, single-session, event-driven* lifecycle — one session
  shepherds the whole issue, start to merge-ready PR.
- **Goal verification is part of done, not a gate.** `issue-implement` proves the goal on the
  real path at completion (a real model when the goal declares one; model-free goals are valid);
  a worker that skipped a model-backed goal to save credits hasn't finished. Same enforcement
  rule — and the same narrow "no goal check applies" exception — as `epic-lifecycle` →
  Boundaries; don't accept a cost-based skip.
- Gates are fixed by the route: **spec approval in, merge out** on the spec route;
  **merge out only** on the direct (bug) route, where the implementation PR is the review
  surface. Everything between runs without hand-holding, surfacing blockers when a
  sub-agent reports one. A bug's fix is not held for a pre-code sign-off nobody asked for.
- **When a blocker is answered, carry the answer into the next phase agent's prompt.** Every phase
  here runs in a fresh bounded sub-agent, so the one that escalated is gone and the one that resumes
  never saw the question. Surfacing the blocker and then dispatching as if nothing happened sends it
  back to the same architectural fork, where it can only escalate again or guess. Put the human's
  decision in the prompt verbatim — the option chosen, and the why if the why constrains the work.
  For a **multi-PR** issue, pass it to `issue-multi-pr` as `blockerResolutions: [{ for, answer }]` —
  `for` naming the slice that escalated. That is also what **clears** the slice's cached `blocker` (or
  `assembledGoal.fixBlocker`): the answer is the unblocking signal, so you don't clear it yourself, and
  a slice whose answer you never pass stays parked no matter what else you update.
  (Under `epic-lifecycle` the same handoff is the row's `blockerResolutions` list, which `epic-wake`
  hands to the next dispatch, forwards into `issue-multi-pr`, and clears once carried.)
