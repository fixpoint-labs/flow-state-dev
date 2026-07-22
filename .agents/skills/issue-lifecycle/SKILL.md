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
- **Handle cache:** a compact record at `.agents/orchestration/<ISSUE-ID>.md` — issue
  ID, spec PR#, impl PR#, branch, worktree path, current phase, and the last action
  taken. A few lines. Update it at the end of every step. It is a cache of handles,
  not a log of content.

Never rebuild state by re-reading prior sub-agent output. If you need detail, the
next sub-agent fetches it.

## Phases (take the ONE next action, then end the turn)

| Phase (derived) | Next bounded action | Then |
|---|---|---|
| **NEEDS_SPEC** — no spec / not yet in spec review | Dispatch a sub-agent: *run `fsd:create-spec <issue>`*. It researches, opens the spec PR, and returns Part I ("The Case") + open questions + spec PR link, then exits. | Surface Part I + open questions to the user for review; record handles; end turn → AWAITING_SPEC_APPROVAL. |
| **AWAITING_SPEC_APPROVAL** — spec PR open | On a **spec-PR review event**: dispatch a bounded sub-agent to run `fsd:create-spec` Step 6.5 for that batch (apply clear fixes, escalate debatable), returns what changed, exits. On **your approval**: advance. | End turn between events. Do not implement until the user signs off (the one required gate in). |
| **NEEDS_IMPLEMENTATION** — spec approved | Dispatch a sub-agent: *run `fsd:implement-issue <issue>`*. It closes the spec PR, implements on the fix branch (its worktree, under the fleet), runs `fsd:review`, opens the impl PR, returns summary + key decisions + PR link, exits. | Record impl PR#; subscribe to it; end turn → PR_FEEDBACK. |
| **PR_FEEDBACK** — impl PR open | On each **PR event** (new review comments / CI): dispatch a fresh bounded sub-agent to run `fsd:implement-issue` Step 10 for that batch — react, fix, reply, push — and exit. | End turn between events. When the PR is approved + green: surface **"ready to merge"** and stop. **Do not merge** — merge is the user's. |
| **DONE** — impl PR merged | none | Update the cache to DONE; report completion. |

## Waking

Subscribe to both PRs' activity so review/CI events re-enter this loop
(`subscribe_pr_activity`). As a fallback heartbeat for transitions webhooks don't
cover (CI success, merge, spec approval you gave elsewhere), schedule a check-in
(`send_later`, ~30–60 min) and re-arm it while the issue is live; stop once the impl
PR is merged or closed. Never poll with `sleep`.

## Token discipline (the point of this skill)

- **Never** read a full spec, diff, or file into this orchestrator's context. Pass
  the issue ID / PR# to the sub-agent; it fetches what it needs.
- Every phase sub-agent returns **≤ a screen**. If it would return more, it is doing
  the orchestrator's job — tighten its prompt.
- Persist state as a handful of fields (the handle cache), so re-entry costs a small
  read, not a replay.
- Prefer event-driven wakes over scheduled ones; the heartbeat is a backstop.

## Boundaries

- One issue. For several in parallel, use `fsd:issue-fleet` (it composes this skill,
  one worktree per issue).
- This is the *coordinated, single-session, event-driven* lifecycle. It differs from
  `fsd:dispatch-remote`, which routes an issue to a *separate* cloud task by Linear
  state and doesn't hold the lifecycle. Use dispatch-remote for fire-and-forget;
  use this when one session should shepherd the whole issue.
- Gates are fixed: **spec approval in, merge out.** Everything between runs without
  hand-holding, surfacing blockers when a sub-agent reports one.
