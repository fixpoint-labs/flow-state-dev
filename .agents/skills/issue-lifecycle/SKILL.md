---
name: issue-lifecycle
description: Drive ONE Linear issue through its full lifecycle in a single session — spec (issue-spec) → human spec-approval gate → implementation (issue-implement) → PR review-feedback rounds → stop before merge. A THIN, event-driven orchestrator: every heavy phase runs in a fresh bounded sub-agent that returns a compact summary and exits, so the orchestrator's own token cost stays small across the whole lifecycle. Advances the issue to its next external wait per invocation (a satisfied gate is a release, not a stop — a just-approved spec chains straight into implementation); re-enters on events (PR activity, your approval, a scheduled check-in). Composed per-issue by epic-lifecycle for parallel multi-issue runs under an epic.
argument-hint: "<Linear issue ID, e.g. FIX-123>"
---

# Issue Lifecycle

Take one issue from spec to a merge-ready PR without you having to hand-drive each
stage — and without the session's token count ballooning over a lifecycle that spans
spec review, implementation, and several rounds of PR feedback.

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
  their status (open / review / CI / merged). Fetch these compactly (Linear MCP; the
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
  ID, spec PR#, impl PR#, branch, worktree path, current phase, the last action
  taken, and the **spec-review round count** (see the convergence budget below). A few
  lines. Update it at the end of every step. It is a cache of handles,
  not a log of content.

Never rebuild state by re-reading prior sub-agent output. If you need detail, the
next sub-agent fetches it.

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
| **NEEDS_SPEC** — no spec / not yet in spec review | Dispatch a sub-agent: *run `issue-spec <issue>`*. It researches, drafts **Part I ("The Case") and Part II ("The Build Plan")**, opens the spec PR **ready for review**, and returns Part I + open questions + spec PR link, then exits. | Surface Part I + the spec PR to the user for review; record handles; end turn → AWAITING_SPEC_APPROVAL. |
| **AWAITING_SPEC_APPROVAL** — spec PR is open (Part I + II) | On a **spec-PR review event**, *and only while the round budget allows* (see below): dispatch a bounded sub-agent to run `issue-spec` Step 6.5 for that batch (triage against the bar, fold spec-level findings, record the rest as §13 notes, escalate direction forks), returns what changed + rounds actually spent + whether anything was spec-level, exits; add the **rounds it reports spent** to the count (not one per event — see below). When an **approving human comment or Review is posted** on the spec PR (the durable sign-off — a comment saying "approved", or a Review whose latest state is `APPROVED` on the current head, from a human, not a bot, and for a review, not the PR's own author; see [`orchestration.md`](../../../docs/contributing/orchestration.md) → Gates): **mirror it to the `spec approved` label**, **close the spec PR** (unmerged, delete the branch) pointing to the Linear document as canonical, and — **without ending the turn** — proceed straight into NEEDS_IMPLEMENTATION and dispatch implementation. The approval is the release; nothing external separates approved from implementing. If the user conveys sign-off **in-session** instead of commenting or reviewing, that in-session sign-off satisfies the gate identically (the comment/review channel exists only for the *async* wake; a live "approved" needs none) — apply the `spec approved` label as the mirror and proceed the same way. | **Chain into NEEDS_IMPLEMENTATION in the same wake** — do not end the turn on the approval. (While *unapproved*, end the turn and wait: **human sign-off** — an approving comment/review or an in-session "approved" — is the one required gate in; don't implement without one.) |
| **NEEDS_IMPLEMENTATION** — spec approved | **Single-PR (default):** dispatch a sub-agent to *run `issue-implement <issue>`* — implements on `fix/<ISSUE>` (the spec PR was already closed at the approval gate; `issue-implement` skips the close when it finds it already closed), runs `review`, opens the impl PR, returns summary + key decisions + PR link, exits. **Multi-PR (the spec declares a PR plan):** advance the plan by one bounded step — see [Multi-PR issues](#multi-pr-issues-pr-plan) below. | Record impl PR#(s); subscribe; end turn → PR_FEEDBACK. |
| **PR_FEEDBACK** — impl PR(s) open | On each **PR event** (new review comments / CI) on any open impl / sub-PR: dispatch a fresh bounded sub-agent to run `issue-implement` Step 10 for that batch — react, fix, reply, push — exit. | End turn between events. When a PR is approved + green: surface **"ready to merge"** and stop (merge is the user's). Multi-PR: a merged dependency unblocks its dependents (they return to NEEDS_IMPLEMENTATION); after the **last** sub-PR merges the issue is **not** yet DONE — run the assembled end-to-end goal first (see [Multi-PR issues](#multi-pr-issues-pr-plan) §4). |
| **DONE** — impl PR merged **and** (multi-PR) the assembled goal passed | none | Update the cache to DONE; report completion. |

## The spec-review round budget (why AWAITING_SPEC_APPROVAL terminates)

A spec PR draws review from bots we don't control, which produce line-level feedback
without limit. Dispatching a Step 6.5 round for every event that arrives is an unbounded
loop — and it's the loop that used to grind a directionally-correct spec through ten
rounds. So this phase is **budgeted, not open-ended.**

**Default: two rounds.** Track the count in the handle cache (`spec_review_rounds`).

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

## Linear status is a mirror you own

Linear's GitHub auto-status is **off** — it mis-fired on spec PRs, treating a spec PR's
open/merge as the *issue's* progress and closing issues early. So the lifecycle sets the
issue's Linear status **explicitly** at every phase transition, the same "PR is the
trigger, Linear state is the human-facing mirror, the orchestrator keeps it in step" rule
the epic objective gate already follows. Nothing else updates it now.

**The rule the auto-status got wrong: a spec PR is not the implementation.** A spec PR
only ever moves the issue *within spec review*; only the **impl** PR moves it to In
Review / Done. Never let a spec PR's open/close/merge push the issue toward Done.

Set the issue's status (Linear MCP `save_issue` with `stateId`, team `flow-state`
`1ec31154-539c-45d5-bee7-8d12f36357d6`) at each transition. IDs are inlined so no
per-write lookup is needed:

| Transition | Status | `stateId` |
|---|---|---|
| NEEDS_SPEC picked up (dispatching `issue-spec`) | **In Spec Dev** | `16091670-e146-42a6-ac19-df1c13cd42c8` |
| Spec PR opened (→ AWAITING_SPEC_APPROVAL) | **In Spec Review** | `520c428e-9e4d-41f9-bcf2-f6e84b6d1ec2` |
| Approving comment detected (→ NEEDS_IMPLEMENTATION) | **Spec Approved** | `dfe5f095-467b-4b08-9494-693b928d0b86` |
| Implementation dispatched (`issue-implement` starts) | **In Development** | `53d6fd64-8136-42ea-b33c-65fd97d9dbf5` |
| Impl PR opened (→ PR_FEEDBACK) | **In Review** | `91df31a4-b3fd-4a3a-afd8-1b0496e7956e` |
| Impl PR merged (→ DONE) — single-PR; **multi-PR: only after the assembled goal passes**, not on the last merge | **Done** | `f5983dd3-92a5-4a9a-84d8-23e775b7fa8f` |

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

Each invocation advances the plan by **one bounded step**:

1. **Read** the plan (the §8 sub-PR table) and per-sub-PR status from the handle cache.
2. **Independent ready** sub-PRs (no unmet `depends_on`, not yet built) → build in
   **parallel**, each in its own worktree on branch `fix/<ISSUE>-<id>`: dispatch a
   worktree-isolated worker (Agent tool `isolation: worktree`) that runs
   `issue-implement` scoped to that sub-PR's deliverables — it implements the slice,
   runs `review`, and opens the sub-PR. Same isolation `epic-lifecycle` uses across issues,
   one level down. Cap parallelism to the VM (a few at a time).
3. **Dependent ready** sub-PRs → branch off the dependency's branch so review can start
   before the dep merges; rebase onto the dep when it merges. A dependency's **merge
   event** re-enters the lifecycle and unblocks its dependents.
4. Once **every** sub-PR in the plan is merged, run the spec's **end-to-end goal check on the
   fully-assembled work** before marking the issue DONE. Each per-sub-PR `issue-implement` run
   only proved its own slice (and any slice-level goal); the assembled goal is the proof no
   single sub-PR could give, and the merge events are the only point it becomes runnable — so it
   is required verification, not optional. Dispatch a bounded sub-agent to run it against the
   merged result (a real model when the goal declares one; a model-free goal runs as-is) and
   confirm PASS; **only then is the issue DONE.** If the spec's PR plan instead **designates a
   specific integrating sub-PR to own the assembled goal**, that sub-PR's run proves it and this
   step just confirms the verdict was recorded — don't double-run. If it fails, the issue isn't
   done: file the gap (`issue-manager`) and open a **new fix PR** owned by the breaking slice —
   the sub-PRs are already merged, so they can't be reopened (a merged PR's branch may be gone) —
   and keep the issue out of DONE until that fix lands and the assembled goal re-passes.

**Handle-cache extension:** the `.orchestration/<ISSUE>.md` record adds one row per
sub-PR — `id · depends_on · branch · PR# · status (pending / building / open / merged)`
— alongside the issue-level fields. The coordinator holds only this table, never sub-PR
content (same token discipline).

**Optional team-backed burst.** When agent teams are enabled and the independent
sub-PRs share interfaces that benefit from live coordination, the parallel build can
run as a team (the DAG is the shared task board) instead of independent workers.
Default is independent worktree workers — no team required.

Single-PR issues are just a one-node plan: no change to their flow.

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
- Gates are fixed: **spec approval in, merge out.** Everything between runs without
  hand-holding, surfacing blockers when a sub-agent reports one.
