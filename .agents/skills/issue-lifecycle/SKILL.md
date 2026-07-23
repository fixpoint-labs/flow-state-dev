---
name: fsd:issue-lifecycle
description: Drive ONE Linear issue through its full lifecycle in a single session — spec (create-spec) → human spec-approval gate → implementation (implement-issue) → PR review-feedback rounds → stop before merge. A THIN, event-driven orchestrator: every heavy phase runs in a fresh bounded sub-agent that returns a compact summary and exits, so the orchestrator's own token cost stays small across the whole lifecycle. Advances one bounded step per invocation; re-enters on events (PR activity, your approval, a scheduled check-in). Composed per-issue by fsd:issue-fleet for parallel multi-issue runs.
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

> Standalone, *this session's* event loop re-invokes the skill. Under `fsd:issue-fleet`,
> the fleet is the event loop and dispatches a worktree-isolated worker to run the
> next step. Same step logic either way — so keep every step a self-contained,
> re-enterable unit.

## State — derive it, don't store a transcript

On each invocation, reconstruct the phase from a **small** read:

- **Durable truth:** the Linear issue state + whether a spec PR / impl PR exist and
  their status (open / review / CI / merged). Fetch these compactly (Linear MCP; the
  GitHub `pull_request_read` methods `get`, `get_check_runs`, `get_review_comments`).
  **Two spec-PR signals are load-bearing, both read from `pull_request_read` `get`:**
  - The **`draft` flag** — `draft: true` = the Case (Part I) is under first-pass review
    (AWAITING_CASE_APPROVAL); `draft: false` = the human promoted it, so Part II should
    exist or be building (AWAITING_SPEC_APPROVAL).
  - The **`spec approved` label** on the spec PR — the human's durable sign-off on the
    full spec. Its presence is the gate to advance to NEEDS_IMPLEMENTATION — and what
    authorizes the lifecycle to **close the spec PR** (unmerged) at that transition (only
    once the PR is ready and Part II is present; a `spec approved` label on a still-draft
    Case is premature — surface it, don't implement).
- **Handle cache:** a compact record at `.orchestration/<ISSUE-ID>.md` (a **gitignored,
  session-only** directory — never `git add`/commit/PR it) — issue
  ID, spec PR#, impl PR#, branch, worktree path, current phase, and the last action
  taken. A few lines. Update it at the end of every step. It is a cache of handles,
  not a log of content.

Never rebuild state by re-reading prior sub-agent output. If you need detail, the
next sub-agent fetches it.

## Phases (take the ONE next action, then end the turn)

| Phase (derived) | Next bounded action | Then |
|---|---|---|
| **NEEDS_SPEC** — no spec / not yet in spec review | Dispatch a sub-agent: *run `fsd:create-spec <issue>`* (Stage 1). It researches, drafts **Part I ("The Case")**, opens the spec PR **as a draft** (Part I only), and returns Part I + open questions + spec PR link, then exits. | Surface Part I + the **draft** spec PR to the user for a first-pass review (and note that marking it ready triggers Part II); record handles; end turn → AWAITING_CASE_APPROVAL. |
| **AWAITING_CASE_APPROVAL** — spec PR is a **draft** (Part I only) | On a **spec-PR review event**: dispatch a bounded sub-agent to run `fsd:create-spec` Step 6.5 for that batch, scoped to Part I (apply clear fixes, escalate debatable), returns what changed, exits. On the spec PR's **draft→ready-for-review promotion** (the human's signal the Case holds): dispatch a sub-agent to run `fsd:create-spec` **Step 6.6** — author **Part II ("The Build Plan")**, append it, push to the same PR — returns what it added, exits. | End turn between events. The promotion is the trigger to build Part II → AWAITING_SPEC_APPROVAL once it's pushed. |
| **AWAITING_SPEC_APPROVAL** — spec PR is **ready** (Part I + II) | On a **spec-PR review event**: dispatch a bounded sub-agent to run `fsd:create-spec` Step 6.5 for that batch (now covering Part II too), returns what changed, exits. When the **`spec approved` label is applied** to the spec PR (the human's durable sign-off): **close the spec PR** (unmerged, delete the branch — the label is what authorizes the close) with a comment pointing to the Linear document as the canonical spec, then advance. If the user conveys sign-off in-session instead of applying the label, apply the `spec approved` label yourself first. | End turn between events. The label is the one required gate in — don't implement without it. |
| **NEEDS_IMPLEMENTATION** — spec approved | **Single-PR (default):** dispatch a sub-agent to *run `fsd:implement-issue <issue>`* — implements on `fix/<ISSUE>` (the spec PR was already closed at the approval gate; `fsd:implement-issue` skips the close when it finds it already closed), runs `fsd:review`, opens the impl PR, returns summary + key decisions + PR link, exits. **Multi-PR (the spec declares a PR plan):** advance the plan by one bounded step — see [Multi-PR issues](#multi-pr-issues-pr-plan) below. | Record impl PR#(s); subscribe; end turn → PR_FEEDBACK. |
| **PR_FEEDBACK** — impl PR(s) open | On each **PR event** (new review comments / CI) on any open impl / sub-PR: dispatch a fresh bounded sub-agent to run `fsd:implement-issue` Step 10 for that batch — react, fix, reply, push — exit. | End turn between events. When a PR is approved + green: surface **"ready to merge"** and stop (merge is the user's). Multi-PR: a merged dependency unblocks its dependents (they return to NEEDS_IMPLEMENTATION); the issue is DONE only when every sub-PR is merged. |
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
| NEEDS_SPEC picked up (dispatching `create-spec`) | **In Spec Dev** | `16091670-e146-42a6-ac19-df1c13cd42c8` |
| Draft spec PR opened (→ AWAITING_CASE_APPROVAL) | **In Spec Review** | `520c428e-9e4d-41f9-bcf2-f6e84b6d1ec2` |
| Spec PR ready / Part II building (→ AWAITING_SPEC_APPROVAL) | **In Spec Review** (unchanged) | `520c428e-9e4d-41f9-bcf2-f6e84b6d1ec2` |
| `spec approved` label detected (→ NEEDS_IMPLEMENTATION) | **Spec Approved** | `dfe5f095-467b-4b08-9494-693b928d0b86` |
| Implementation dispatched (`implement-issue` starts) | **In Development** | `53d6fd64-8136-42ea-b33c-65fd97d9dbf5` |
| Impl PR opened (→ PR_FEEDBACK) | **In Review** | `91df31a4-b3fd-4a3a-afd8-1b0496e7956e` |
| Impl PR merged (→ DONE) | **Done** | `f5983dd3-92a5-4a9a-84d8-23e775b7fa8f` |

**Who writes it:** whichever agent effects or detects the transition, in the same step —
the worker sets it for a transition it *causes* (it opened the PR); the orchestrator sets
it inline (one cheap `save_issue` call) for a transition it *detects* on refresh (the
`spec approved` label, a merge). Set it **idempotently** — if the issue is already in the
target state, leave it. On a multi-PR issue the status tracks the **whole** issue: In
Review while any impl sub-PR is open, Done only when every sub-PR is merged (a spec PR
never counts). If these IDs ever stop resolving (a workflow edit), re-fetch with
`list_issue_statuses` for team `flow-state` and update this table — don't guess.

## Multi-PR issues (PR plan)

When the spec declares a **PR plan** (a DAG of sub-PRs — `fsd:create-spec` Large
issues, Part II §8), the `NEEDS_IMPLEMENTATION` and `PR_FEEDBACK` phases generalize
from one PR to the plan. The single spec-approval up front covers the whole plan; you
still stop before merge on each sub-PR.

Each invocation advances the plan by **one bounded step**:

1. **Read** the plan (the §8 sub-PR table) and per-sub-PR status from the handle cache.
2. **Independent ready** sub-PRs (no unmet `depends_on`, not yet built) → build in
   **parallel**, each in its own worktree on branch `fix/<ISSUE>-<id>`: dispatch a
   worktree-isolated worker (Agent tool `isolation: worktree`) that runs
   `fsd:implement-issue` scoped to that sub-PR's deliverables — it implements the slice,
   runs `fsd:review`, and opens the sub-PR. Same isolation the fleet uses across issues,
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

Subscribe to both PRs' activity so review/CI events re-enter this loop
(`subscribe_pr_activity`). As a fallback heartbeat for transitions webhooks don't
cover — CI success, merge, **the spec PR's draft→ready-for-review promotion**, and
**the `spec approved` label being applied** — schedule a check-in (`send_later`,
~30–60 min) and re-arm it while the issue is live; stop once the impl PR is merged or
closed. On each wake, re-read the two spec-PR signals rather than trusting a webhook
arrived: in AWAITING_CASE_APPROVAL, a `draft` flip to `false` is the promotion; in
AWAITING_SPEC_APPROVAL, the `spec approved` label present is the go-ahead. Never poll
with `sleep`.

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
  **`scout`** agent (Haiku); phase work runs through `fsd:create-spec` /
  `fsd:implement-issue`, which tier their own sub-agents (Sonnet for decided execution).

## Boundaries

- **Discovered gaps/blockers** during the work get **filed via the `issue-manager` agent** (related to this issue, same project) — never dropped or scope-crept into it. It returns a ready/blocked verdict; under the fleet, an unblocked related one can join the active set.
- One issue. For several in parallel, use `fsd:issue-fleet` (it composes this skill,
  one worktree per issue).
- This is the *coordinated, single-session, event-driven* lifecycle. It differs from
  `fsd:dispatch-remote`, which routes an issue to a *separate* cloud task by Linear
  state and doesn't hold the lifecycle. Use dispatch-remote for fire-and-forget;
  use this when one session should shepherd the whole issue.
- Gates are fixed: **spec approval in, merge out.** Everything between runs without
  hand-holding, surfacing blockers when a sub-agent reports one.
