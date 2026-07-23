---
name: issue-lifecycle
description: Drive ONE Linear issue through its full lifecycle in a single session — spec (issue-spec) → human spec-approval gate → implementation (issue-implement) → PR review-feedback rounds → stop before merge. A THIN, event-driven orchestrator: every heavy phase runs in a fresh bounded sub-agent that returns a compact summary and exits, so the orchestrator's own token cost stays small across the whole lifecycle. Advances the issue to its next external wait per invocation (a satisfied gate is a release, not a stop — a just-approved spec chains straight into implementation); re-enters on events (PR activity, your approval, a scheduled check-in). Composed per-issue by issue-fleet for parallel multi-issue runs.
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

> Standalone, *this session's* event loop re-invokes the skill. Under `issue-fleet`,
> the fleet is the event loop and dispatches a worktree-isolated worker to run the
> next step. Same step logic either way — so keep every step a self-contained,
> re-enterable unit.

## State — derive it, don't store a transcript

On each invocation, reconstruct the phase from a **small** read:

- **Durable truth:** the Linear issue state + whether a spec PR / impl PR exist and
  their status (open / review / CI / merged). Fetch these compactly (Linear MCP; the
  GitHub `pull_request_read` methods `get`, `get_check_runs`, `get_comments` — the
  approval-comment read — `get_reviews` — the approval-review read — and
  `get_review_comments` for inline diff threads).
  **Two spec-PR signals are load-bearing, read from different calls:**
  - The **`draft` flag** (from `pull_request_read` `get`) — `draft: true` = the Case (Part I)
    is under first-pass review (AWAITING_CASE_APPROVAL); `draft: false` = the human promoted
    it, so Part II should exist or be building (AWAITING_SPEC_APPROVAL).
  - An **approving comment or GitHub Review from a human** on the spec PR (from the PR's
    comments — `pull_request_read` `get_comments` — or its reviews — `get_reviews`) — the
    human's durable sign-off on the full spec: either a comment saying "approved" authored
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
    the spec PR (unmerged), only once the PR is ready and Part II is present; an approval on a
    still-draft Case is premature — surface it, don't implement.
- **Handle cache:** a compact record at `.orchestration/<ISSUE-ID>.md` (a **gitignored,
  session-only** directory — never `git add`/commit/PR it) — issue
  ID, spec PR#, impl PR#, branch, worktree path, current phase, and the last action
  taken. A few lines. Update it at the end of every step. It is a cache of handles,
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
| **NEEDS_SPEC** — no spec / not yet in spec review | Dispatch a sub-agent: *run `issue-spec <issue>`* (Stage 1). It researches, drafts **Part I ("The Case")**, opens the spec PR **as a draft** (Part I only), and returns Part I + open questions + spec PR link, then exits. | Surface Part I + the **draft** spec PR to the user for a first-pass review (and note that marking it ready triggers Part II); record handles; end turn → AWAITING_CASE_APPROVAL. |
| **AWAITING_CASE_APPROVAL** — spec PR is a **draft** (Part I only) | On a **spec-PR review event**: dispatch a bounded sub-agent to run `issue-spec` Step 6.5 for that batch, scoped to Part I (apply clear fixes, escalate debatable), returns what changed, exits. On the spec PR's **draft→ready-for-review promotion** (the human's signal the Case holds): dispatch a sub-agent to run `issue-spec` **Step 6.6** — author **Part II ("The Build Plan")**, append it, push to the same PR — returns what it added, exits. | End turn between events. The promotion is the trigger to build Part II → AWAITING_SPEC_APPROVAL once it's pushed. |
| **AWAITING_SPEC_APPROVAL** — spec PR is **ready** (Part I + II) | On a **spec-PR review event**: dispatch a bounded sub-agent to run `issue-spec` Step 6.5 for that batch (now covering Part II too), returns what changed, exits. When an **approving human comment or Review is posted** on the spec PR (the durable sign-off — a comment saying "approved", or a Review whose latest state is `APPROVED` on the current head, from a human, not a bot, and for a review, not the PR's own author; see [`orchestration.md`](../../../docs/contributing/orchestration.md) → Gates): **mirror it to the `spec approved` label**, **close the spec PR** (unmerged, delete the branch) pointing to the Linear document as canonical, and — **without ending the turn** — proceed straight into NEEDS_IMPLEMENTATION and dispatch implementation. The approval is the release; nothing external separates approved from implementing. If the user conveys sign-off **in-session** instead of commenting or reviewing, that in-session sign-off satisfies the gate identically (the comment/review channel exists only for the *async* wake; a live "approved" needs none) — apply the `spec approved` label as the mirror and proceed the same way. | **Chain into NEEDS_IMPLEMENTATION in the same wake** — do not end the turn on the approval. (While *unapproved*, end the turn and wait: **human sign-off** — an approving comment/review or an in-session "approved" — is the one required gate in; don't implement without one.) |
| **NEEDS_IMPLEMENTATION** — spec approved | **Single-PR (default):** dispatch a sub-agent to *run `issue-implement <issue>`* — implements on `fix/<ISSUE>` (the spec PR was already closed at the approval gate; `issue-implement` skips the close when it finds it already closed), runs `review`, opens the impl PR, returns summary + key decisions + PR link, exits. **Multi-PR (the spec declares a PR plan):** advance the plan by one bounded step — see [Multi-PR issues](#multi-pr-issues-pr-plan) below. | Record impl PR#(s); subscribe; end turn → PR_FEEDBACK. |
| **PR_FEEDBACK** — impl PR(s) open | On each **PR event** (new review comments / CI) on any open impl / sub-PR: dispatch a fresh bounded sub-agent to run `issue-implement` Step 10 for that batch — react, fix, reply, push — exit. | End turn between events. When a PR is approved + green: surface **"ready to merge"** and stop (merge is the user's). Multi-PR: a merged dependency unblocks its dependents (they return to NEEDS_IMPLEMENTATION); the issue is DONE only when every sub-PR is merged. |
| **DONE** — impl PR merged | none | Update the cache to DONE; report completion. |

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
| Draft spec PR opened (→ AWAITING_CASE_APPROVAL) | **In Spec Review** | `520c428e-9e4d-41f9-bcf2-f6e84b6d1ec2` |
| Spec PR ready / Part II building (→ AWAITING_SPEC_APPROVAL) | **In Spec Review** (unchanged) | `520c428e-9e4d-41f9-bcf2-f6e84b6d1ec2` |
| Approving comment detected (→ NEEDS_IMPLEMENTATION) | **Spec Approved** | `dfe5f095-467b-4b08-9494-693b928d0b86` |
| Implementation dispatched (`issue-implement` starts) | **In Development** | `53d6fd64-8136-42ea-b33c-65fd97d9dbf5` |
| Impl PR opened (→ PR_FEEDBACK) | **In Review** | `91df31a4-b3fd-4a3a-afd8-1b0496e7956e` |
| Impl PR merged (→ DONE) | **Done** | `f5983dd3-92a5-4a9a-84d8-23e775b7fa8f` |

**Who writes it:** whichever agent effects or detects the transition, in the same step —
the worker sets it for a transition it *causes* (it opened the PR); the orchestrator sets
it inline (one cheap `save_issue` call) for a transition it *detects* on refresh (an
approving comment or review, a merge). Set it **idempotently** — if the issue is already in the
target state, leave it. On a multi-PR issue the status tracks the **whole** issue: In
Review while any impl sub-PR is open, Done only when every sub-PR is merged (a spec PR
never counts). If these IDs ever stop resolving (a workflow edit), re-fetch with
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
   runs `review`, and opens the sub-PR. Same isolation the fleet uses across issues,
   one level down. Cap parallelism to the VM (a few at a time).
3. **Dependent ready** sub-PRs → branch off the dependency's branch so review can start
   before the dep merges; rebase onto the dep when it merges. A dependency's **merge
   event** re-enters the lifecycle and unblocks its dependents.
4. Once **every** sub-PR in the plan is merged, the issue is DONE.

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
transitions webhooks *don't* cover — CI success, merge, and **the spec PR's
draft→ready-for-review promotion** (still label-like: no guaranteed `ready_for_review`
webhook) — schedule a check-in (`send_later`, ~30–60 min) and re-arm it while the issue is
live; stop once the impl PR is merged or closed. On each wake, re-read the two spec-PR
signals rather than trusting a webhook arrived: in AWAITING_CASE_APPROVAL, a `draft` flip to
`false` is the promotion; in AWAITING_SPEC_APPROVAL, an approving human comment or review on
the spec PR is the go-ahead (check the PR's comments and reviews — both small reads; not a
label). Never poll with `sleep`.

**Both `subscribe_pr_activity` and `send_later` are cloud-only** — neither works in a local
Claude Code session (no reachable webhook endpoint, no server-side scheduler). Check whether
you're in a cloud session before relying on either; if local, arm a **`Monitor` poll loop
(the `watch-pr` skill)** on the issue's PR(s) as the wake signal. It replaces both: its
continuous tick polls the PR's **`draft`/`state`** meta as well as comments/reviews/CI, so the
quiet **`draft→ready-for-review` promotion** wakes the loop even when nothing else lands — the
one transition the cloud path leans on the `send_later` heartbeat for. (For an *unattended*
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

- **Discovered gaps/blockers** during the work get **filed via the `issue-manager` agent** (related to this issue, same project) — never dropped or scope-crept into it. It returns a ready/blocked verdict; under the fleet, an unblocked related one can join the active set.
- One issue. For several in parallel, use `issue-fleet` (it composes this skill,
  one worktree per issue).
- This is the *coordinated, single-session, event-driven* lifecycle — one session
  shepherds the whole issue, start to merge-ready PR.
- Gates are fixed: **spec approval in, merge out.** Everything between runs without
  hand-holding, surfacing blockers when a sub-agent reports one.
