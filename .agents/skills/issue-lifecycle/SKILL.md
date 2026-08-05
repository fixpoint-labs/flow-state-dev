---
name: issue-lifecycle
description: Drive ONE Linear issue through its full lifecycle in a single session — spec (issue-spec) → human spec-approval gate → implementation (issue-implement) → PR review-feedback rounds → stop before merge. A BUG skips the spec entirely and enters at implementation, with the PR as its review surface. A THIN, event-driven orchestrator: every heavy phase runs in a fresh bounded sub-agent that returns a compact summary and exits, so the orchestrator's own token cost stays small across the whole lifecycle. Advances the issue to its next external wait per invocation (a satisfied gate is a release, not a stop — a just-approved spec chains straight into implementation); re-enters on events (PR activity, your approval, a scheduled check-in). Composed per-issue by epic-lifecycle for parallel multi-issue runs under an epic.
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
  **The load-bearing spec-PR signal is the approval:** an **approving comment or GitHub
    Review from a human** on the spec PR (from the PR's
    comments — `pull_request_read` `get_comments` — or its reviews — `get_reviews`) — the
    human's durable sign-off on the full spec (Part I + Part II): either a comment saying "approved" authored
    by a human (not a bot, not a bot-authored comment), or a Review whose **latest state is
    `APPROVED` on the current head** authored by a human who is not the PR's own author (GitHub
    already blocks a PR author from approving their own PR, but check `review.user != pr.user`
    explicitly rather than depend on that alone — and exclude bot reviews, e.g. Cursor Bugbot /
    Codex leave Review submissions with a `state`, not just comments). **Not any historical
    `APPROVED`:** the reviews list is chronological, so collapse to each human's latest review,
    require no outstanding `CHANGES_REQUESTED`, and confirm the approving review's `commit_id`
    is the current head — a push after an approval re-opens the gate. The full detection rule is
    in [`orchestration.md`](../../../docs/contributing/orchestration.md) → Gates. A comment or a
    review submission is the gate because either *wakes* the lifecycle — a `labeled` webhook
    doesn't arrive, but both of these do. On detecting either, **mirror it to the
    `spec approved` label** (a durable, filterable record) in the same step. **The gate is the
    fresh evidence — a current-head approving comment/review, re-derived by this scan each
    wake — not the label.** The `spec approved` label is a mirror only; it can go stale (it was
    applied at an earlier commit, then a push or a later `CHANGES_REQUESTED` landed), so
    **never advance from the label alone** — re-confirm approval against the current head every
    wake. That fresh approval is what advances to NEEDS_IMPLEMENTATION and authorizes closing
    the spec PR (unmerged).
- **Handle cache:** a compact record at `.orchestration/<ISSUE-ID>.md` (a **gitignored,
  session-only** directory — never `git add`/commit/PR it) — issue
  ID, **`route`** (`spec | direct` — see "Two routes in"), spec PR#, impl PR#, branch,
  worktree path, current phase, the last action
  taken, the **spec-review round count** (see the convergence budget below), the
  **PR-feedback round count** (`prFeedbackRounds` — see the cap below), and any
  **in-flight or settled claim** (`settling: <claim> · poc: in-flight | <verdict>` — see POC
  settlement below; a settled claim's evidence lives in the spec's §12, not here). A few
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
approval closes the spec PR **and** dispatches implementation, continuously — approval →
implementing is *one* bounded step, because nothing external separates them. A "bounded step"
runs until the issue next has to wait for something external, not until the next internal
boundary. The gate is the only place a human blocks; once it opens, keep moving.

| Phase (derived) | Next bounded action | Then |
|---|---|---|
| **NEEDS_SPEC** — spec route, no spec yet *(a direct-route issue skips this row and the next)* | Dispatch a sub-agent: *run `issue-spec <issue>`*. It researches, drafts **Part I ("The Case") and Part II ("The Build Plan")**, opens the spec PR **ready for review**, and returns Part I + open questions + spec PR link, then exits. | Surface Part I + the spec PR to the user for review; record handles; end turn → AWAITING_SPEC_APPROVAL. |
| **AWAITING_SPEC_APPROVAL** — spec PR is open (Part I + II) | On a **spec-PR review event**, *and only while the round budget allows* (see below): dispatch a bounded sub-agent to run `issue-spec` Step 6.5 for that batch (triage against the bar, fold spec-level findings, record the rest as §13 notes, escalate direction forks), returns what changed + rounds actually spent + whether anything was spec-level, exits; add the **rounds it reports spent** to the count (not one per event — see below). When an **approving human comment or Review is posted** on the spec PR (the durable sign-off — a comment saying "approved", or a Review whose latest state is `APPROVED` on the current head, from a human, not a bot, and for a review, not the PR's own author; see [`orchestration.md`](../../../docs/contributing/orchestration.md) → Gates): **mirror it to the `spec approved` label**, **close the spec PR** (unmerged, delete the branch) pointing to the Linear document as canonical — *unless a POC settlement on a load-bearing claim is still in flight, in which case leave it open until the verdict lands* (see POC settlement below; this defers cleanup only, never implementation) — and — **without ending the turn** — proceed straight into NEEDS_IMPLEMENTATION and dispatch implementation. The approval is the release; nothing external separates approved from implementing. If the user conveys sign-off **in-session** instead of commenting or reviewing, that in-session sign-off satisfies the gate identically (the comment/review channel exists only for the *async* wake; a live "approved" needs none) — apply the `spec approved` label as the mirror and proceed the same way. | **Chain into NEEDS_IMPLEMENTATION in the same wake** — do not end the turn on the approval. (While *unapproved*, end the turn and wait: **human sign-off** — an approving comment/review or an in-session "approved" — is the one required gate in; don't implement without one.) |
| **NEEDS_IMPLEMENTATION** — spec approved, **or** a direct-route (bug) issue, which enters here | **Single-PR (default):** dispatch a sub-agent to *run `issue-implement <issue>`* — implements on `fix/<ISSUE>` (the spec PR was already closed at the approval gate; `issue-implement` skips the close when it finds it already closed, and a bug has none to close), runs `review`, opens the impl PR, returns summary + key decisions + PR link, exits. **A direct-route worker that finds no reproduction, or finds the "bug" is really a feature, returns `specRequired` instead of building** — that re-routes the issue to `NEEDS_SPEC`. A design *decision* found mid-diagnosis is not that: it ships with the fix and is surfaced on the PR. **Multi-PR (the spec declares a PR plan):** advance the plan by one bounded step via the **`issue-multi-pr` workflow** — see [Multi-PR issues](#multi-pr-issues-pr-plan) below. | Record impl PR#(s); subscribe; end turn → PR_FEEDBACK. |
| **PR_FEEDBACK** — impl PR(s) open | On each **PR event** (new review comments / CI) on any open impl / sub-PR, *and only while the round cap allows* (see below): dispatch a fresh bounded sub-agent to run `issue-implement` Step 10 for that batch — react, fix, reply, push — exit; add the rounds it reports spent to `prFeedbackRounds`. | End turn between events. When a PR is approved + green: surface **"ready to merge"** and stop (merge is the user's). Multi-PR: a merged dependency unblocks its dependents (they return to NEEDS_IMPLEMENTATION); after the **last** sub-PR merges the issue is **not** yet DONE — run the assembled end-to-end goal first (see [Multi-PR issues](#multi-pr-issues-pr-plan) §4). |
| **DONE** — impl PR merged **and** (multi-PR) the assembled goal passed | none | Update the cache to DONE; report completion. |

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
  gate, stating that it's converged and that remaining open threads are carried as §13
  implementer notes. Then **stop dispatching review rounds**; further spec-PR review events
  are logged in the cache and ignored until the gate resolves. The only event that still
  acts is a **human** one — an approving comment/review (the gate), or the user asking for
  a specific change.
- **A third round is allowed only when round two surfaced a genuine spec-level finding** —
  a new approach question, not more notes. The Step 6.5 sub-agent reports whether anything
  was spec-level; that flag is what authorizes the extra round. Say so in one line when you
  spend it, so the extra round is a visible decision rather than drift.

Three things make stopping safe, all canonical in
[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review": the spec
PR is never merged so open threads gate nothing; below-the-bar feedback is preserved in §13
and reaches the implementer; and implementation re-reviews the design against real code.
**A bot `CHANGES_REQUESTED` neither holds the gate nor extends the budget.**

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
- **Keep the spec PR open while a load-bearing settlement is live.** Approval still chains
  straight into implementation — nothing blocks — but **defer the spec PR's close-and-delete
  until the verdict lands**, so a `REFUTED` verdict still has a live artifact and thread to
  fold into. Closing it is cleanup, not a precondition for implementing, and the deferral has
  to be passed *down*: `issue-implement` Step 3 otherwise closes every open spec PR itself, so
  the `(POC in flight)` marker in §12 is what tells it to leave this one alone. (Already
  closed? The Linear document is canonical from then on; fold there.) **Then close it once the
  verdict is recorded** — a deferred PR left open forever is an obsolete artifact you keep
  subscribing to and refreshing on every wake.
- **Route the verdict when the POC returns** (its completion is an event like any other) by
  dispatching a worker to apply it per `issue-spec` 6.5.3. If the verdict is **REFUTED and
  implementation has already started**, treat it exactly as a challenger-surfaced spec blind
  spot: fold it, tell the in-flight implementation, and re-gate only if the direction actually
  changed. Then **clear `settling` to the verdict, and close any spec PR you were holding open
  for it** (unmerged, delete the branch, as at the approval gate). A settled claim is
  **closed**, so a later event re-litigating it is not a pending action.

  **Two verdicts don't close it.** A `REFUTED` fold that **re-gates** the spec keeps the PR
  open for that round. And an **`INCONCLUSIVE` verdict settles nothing** — the load-bearing
  question is still open and now belongs to the human (`issue-spec` 6.5.3), so keep `settling`
  as `inconclusive: awaiting decision` and keep the PR open until they answer. Closing on
  `INCONCLUSIVE` would be the worst of both: implementation continuing on an unresolved premise
  with no live artifact to correct it, and the one outcome that most needs a human left with
  nowhere to land.

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
| Approving comment detected (→ NEEDS_IMPLEMENTATION) — *spec route only* | **Spec Approved** | `dfe5f095-467b-4b08-9494-693b928d0b86` |
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
issues, Part II §8), the `NEEDS_IMPLEMENTATION` and `PR_FEEDBACK` phases generalize
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

A PR-activity event arrives in *this* session with the comment bodies and CI output attached,
and the harness's own posture on PRs you opened is that they are yours to drive green: diagnose
the failure, push the fix, answer the reviewer. **Under this skill that posture does not apply
to you.** You "opened" that PR only in the sense that you hold its subscription — a sub-agent
can't. The work on it is the PR_FEEDBACK row of the phase table: a fresh bounded sub-agent
running `issue-implement` Step 10 over the batch.

So on any PR-activity event — a review comment, a CI failure, a push, an approval:

- **Don't** read the diff, diagnose the failure, write a fix, push a commit, or reply on a
  thread. Not for a one-line CI fix, and not because the change looks obvious from the event
  text; "obvious" is what every round nine looked like at round three.
- **Do** re-derive the phase from the small durable read above, take that phase's one bounded
  action — which for PR_FEEDBACK means *dispatching*, not doing — and end the turn.

The gate work stays yours, because nothing else can hold it: subscribing, surfacing a gate,
recording a human's answer, writing the Linear mirror. None of it involves acting on review
content.

**Handling a round here costs more than the tokens it burns.** `prFeedbackRounds` only advances
on a worker's reported `prFeedbackRoundsSpent`, so a round you handle yourself is uncounted: the
twelve-round cap never trips on an issue that is genuinely looping, which is the one signal that
would have told you the approach is wrong rather than the lines being argued about. A round
handled here is worse than a round handled a wake late.

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
approval signal rather than trusting a webhook arrived: in AWAITING_SPEC_APPROVAL, an approving
human comment or review on the spec PR is the go-ahead (check the PR's comments and reviews —
both small reads; not a label). Never poll with `sleep`.

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
  the issue ID / PR# to the sub-agent; it fetches what it needs.
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
