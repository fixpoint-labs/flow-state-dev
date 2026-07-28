# Design — Multi-PR issues (+ agent-memory & teams positioning)

**Date:** 2026-07-23
**Status:** implemented — `create-spec` emits the PR plan; `issue-lifecycle` advances the DAG.

> **Historical naming note:** skill names below reflect what they were called when this
> was written. Since then: `create-spec` → `issue-spec`, `implement-issue` →
> `issue-implement`, and **`issue-fleet` → `epic-lifecycle`** (with "the fleet" → "the
> coordinator"; a multi-issue run now always happens under an **epic**). Don't invoke the
> old names — this doc is a point-in-time design record, not current reference. Current
> reference is [`docs/contributing/orchestration.md`](../../contributing/orchestration.md).

Raised together: (1) persistent agent memory, (2) agent teams, (3) splitting one
issue into multiple PRs. (1) and (2) are positioning decisions; (3) is the new
architecture. They interrelate — teams' natural home turns out to be (3).

## Decisions recorded (from review)

- **Self-improvement store = the cycle-ledger + `distill-lessons`, single writer.**
  The git-tracked ledger is the system of record: one writer (the self-improvement
  engine), it gates against bloat, and it pushes durable fixes *upstream* into
  philosophy / BPs / skills. **Agent `memory:` is selective tacit input that FEEDS
  distill-lessons** — not the system of record. Reasons it isn't primary: memory is
  one `MEMORY.md` per *agent type* with **no write lock**, so it must never go on a
  many-in-parallel agent (see below), and per-agent memory files are another way to
  grow the ungrounded, granular sprawl the philosophy fights (tenets 2–3).
  - **Never on `issue-worker`** — the fleet runs many workers of that type in
    parallel; they'd clobber the same `MEMORY.md` and cause git merge conflicts.
  - Candidate memory holders (later, if earned): a *non-parallel* reflector/
    coordinator agent, or a singly-run implementer. Memory there is read by
    `distill-lessons` as one input among transcripts and the ledger.

- **Agent teams: the multi-ISSUE fleet stays sub-agents; teams are for in-session
  bursts.** Teammates are ephemeral and **don't survive `/resume`**; our fleet is
  event-driven and idles for hours/days across the spec-approval gate and PR events.
  A teammate can't wait days. So the fleet keeps its event-driven lead + worktree
  workers. **Agent Teams are reserved for bursty, in-session parallelism** — chiefly
  the multi-PR builds below, where teammates coordinate on shared interfaces within
  one bounded session.

## Multi-PR issues

### Why

Some issues are too big for one PR, and parts are independently buildable. Today:
one issue → one spec → one impl PR. We want the spec to *plan* the split and the
lifecycle to build independent sub-PRs in parallel, sequencing dependent ones.

### The spec declares a PR plan (a small DAG)

`create-spec`, when Size = **Large**, upgrades today's "Large — split as X, then Y"
line into a structured **PR plan** in Part II: a list of sub-PRs, each
`{ id, deliverables, depends_on: [ids] }`. Independent = no unmet deps. The human
signs off on the plan in Part I (it's a Decision); the implementing agent executes
it from Part II. Keep it lean: most issues have a one-node plan; only Large issues
get a real DAG. The plan's *shape* (how many PRs, what's independent) is a
load-bearing decision, so it belongs in Part I's numbered decisions, not buried.

### The lifecycle builds the DAG

`issue-lifecycle`'s `NEEDS_IMPLEMENTATION` phase generalizes from "open the impl PR"
to "advance the PR plan":

- **Ready** sub-PRs (all `depends_on` satisfied) with no unmet deps are buildable now.
- **Independent ready** sub-PRs build **in parallel** — each in its own
  worktree/branch, each its own PR — reusing the fleet's worktree-worker machinery
  (the same isolation pattern, now *intra*-issue).
- **Dependent** sub-PRs wait until their deps land (branch off the dep so review can
  start early; rebase when the dep merges), then become ready — a merge event
  re-enters the lifecycle and unblocks them.
- **Gates unchanged:** one spec-approval up front covers the whole plan; stop before
  merge on each sub-PR (the human merges; merging a dep unblocks dependents).
- Each sub-PR runs the existing per-PR machinery (implement → `review` →
  PR-feedback). The lifecycle coordinates the DAG and holds only the plan + per-sub-PR
  status (handles), never content — same token discipline as the fleet.

### Where agent teams plug in (optional, experimental)

The parallel build of independent ready sub-PRs is a bounded, in-session burst — the
one place teams fit (no idle-across-gates): the file-locked task board *is* the sub-PR
DAG, and teammate messaging handles shared-interface decisions between sub-PRs. So:

- **Default (stable): worktree sub-agents.** The lifecycle dispatches independent
  ready sub-PRs as parallel `issue-worker`-style workers — no team required.
- **Opt-in (when the flag is on and sub-PRs share interfaces that benefit from live
  coordination): a team-backed burst.** Same DAG, teammates coordinating directly.

This is the fleet↔intra-issue symmetry: worktree-isolated parallel work, one level
down (sub-PRs of an issue instead of issues).

### Composition — minimal new surface (tenet 2)

Reused: worktree-worker isolation (the `issue-worker` pattern), `implement-issue` per
sub-PR, `review` per sub-PR, the event-driven lifecycle. **New** surface is only:
(a) the PR-plan DAG in the spec, and (b) the DAG-advancing logic in the lifecycle.

### Build-time questions — resolved

- **DAG representation:** a small `id · deliverables · depends_on` table in Part II §8
  (spec template), with the plan's shape recorded as a Part I §6 decision.
- **Branch/PR naming:** sub-PR branches are `fix/<ISSUE>-<id>`.
- **Dependent builds:** branch-off-dep (review early, rebase on merge). A dependency's
  merge event re-enters the lifecycle and unblocks its dependents.
- **DAG state:** the lifecycle's `.orchestration/<ISSUE>.md` handle cache gains one row
  per sub-PR (`id · depends_on · branch · PR# · status`); never sub-PR content.
- **Where the logic lives:** `create-spec` (Agent E validates the DAG) + `spec-template`
  (§8 PR plan, §6 decision) + `issue-lifecycle` ("Multi-PR issues" section) +
  `implement-issue` (Step 3 sub-PR scoping). Independent sub-PRs build as parallel
  worktree workers by default; team-backed burst is an opt-in.

## Verification

Dogfood a real Large issue: confirm the spec produces a sensible PR plan the human
signs off on; independent sub-PRs build in parallel in isolated worktrees; dependent
sub-PRs sequence correctly and unblock on merge; and the coordinator holds only
plan + status, not content.
