# Design — issue-lifecycle & issue-fleet orchestrators

**Date:** 2026-07-22
**Status:** implemented (this PR)

## Why

We can shepherd an issue end-to-end (spec → approval → implement → PR feedback) and,
better, run several issues at once in one Cloud session with each on its own branch.
The risk is **token cost**: a lifecycle spans spec review, implementation, and
several PR-feedback rounds, and naively that all accumulates in one context. These
two skills make it affordable by keeping the coordinator thin and pushing every heavy
phase into a sub-agent whose context is discarded once it returns a compact summary.

## The token-isolation model (the whole point)

- **Thin orchestrator, heavy sub-agents.** The orchestrator holds handles + a few
  lines of state, never spec text or diffs. Each phase (create-spec, implement-issue,
  a PR-feedback round) runs in a **fresh sub-agent** that returns ≤ a screen and
  exits; its transcript never enters the orchestrator.
- **One bounded step per invocation; event-driven waits.** An invocation takes the
  single next action and ends the turn. Waiting (spec approval, CI, review) happens
  *between* invocations — the session idles at ~zero context and re-enters on a PR
  event / user message / scheduled check-in, re-deriving phase from Linear + PR
  state (durable truth) plus a compact handle cache (`.agents/orchestration/<ISSUE>.md`).
- **Fleet = same discipline, one level up.** `issue-fleet` holds a per-issue status
  table only; each issue's worker is a **worktree-isolated** sub-agent that advances
  one step and returns one status line. Workers are the token sink and are isolated.

## Decisions (confirmed with the user)

- **Event-driven state machine**, not a stay-live polling loop — lowest token cost,
  matches Cloud sessions + PR watching.
- **Gates: spec-approval in, merge out.** Human signs off the spec before
  implementation; implement + PR-feedback run autonomously; stop before merge.
- **Fleet composes `issue-lifecycle`** (one lifecycle definition reused per issue),
  each issue in its own worktree so parallel commits don't collide.

## Capability facts this relies on (verified against Claude Code docs)

- Sub-agent nesting is allowed up to **5 levels**; our deepest path (fleet → worker →
  phase skill → its fan-out → review lenses) fits.
- **`isolation: worktree`** gives a sub-agent its own worktree + branch; it can
  commit and push; unchanged worktrees auto-clean. Works in a Cloud session.
- Cloud VM ceiling: **4 vCPU / 16 GB / 30 GB disk** — the real limit on concurrency,
  since each worktree is a full checkout. Default fleet N ≈ 3–4.

## Relationship to existing skills

- `fsd:dispatch-remote` routes an issue to a *separate* cloud task by Linear state
  (fire-and-forget); these orchestrators *hold the lifecycle* in one session.
- `issue-lifecycle` composes `fsd:create-spec`, `fsd:implement-issue` (which itself
  composes `fsd:review`). No lifecycle logic is duplicated.

## Verification

Dogfood: run `fsd:issue-lifecycle` on one real issue end-to-end and confirm (a) the
orchestrator's context stays small across the phases (it only ever holds summaries),
(b) it pauses correctly at spec approval and before merge, (c) it re-enters on PR
events. Then run `fsd:issue-fleet` on 2–3 issues and confirm isolated worktrees/branches
and independent per-issue gates.
