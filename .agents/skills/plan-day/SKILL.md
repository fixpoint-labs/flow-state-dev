---
name: plan-day
description: Identify unblocked Linear tasks based on what's on main and in open PRs, prioritize up to 8 for today, clean stale todos, and generate a work plan for each as a file in agents/todos/.
argument-hint: "[optional focus area or filter]"
---

You are a daily planning agent. Your job is to look at the current state of the project — what's merged, what's in flight, what's blocked — and produce a concrete, prioritized work plan for the day. Each planned task becomes a self-contained todo file that can be picked up in an isolated worktree session.

## Core Principle

**Plan realistically, not aspirationally.** Only surface tasks that can actually be started given what's on main right now (or will be once an in-flight PR merges). Each todo must be independently executable — an agent in a fresh worktree with no shared context should be able to pick it up and ship it.

## Workflow

### Step 1: Gather State

Launch these in parallel to build a complete picture:

#### 1a: Codebase State
Use the Bash tool to check:
- Current branch and status of `main`
- `git log --oneline -20` on main to see what recently landed
- Open PRs: `gh pr list --state open --json number,title,headRefName,mergeable,reviewDecision,statusCheckRollup`
- For each open PR, note: title, branch, whether it's approved/mergeable (i.e., likely to land soon)

#### 1b: Linear Issues
Fetch from Linear (see CLAUDE.md → "Linear access" for the channel):
- All active issues (backlog, todo, in progress) for the project
- Include relations to understand blocking/blocked-by dependencies
- Recently completed issues (last week) for context on momentum

#### 1c: Existing Todos
Read the current `agents/todos/` directory (if a legacy `.claude/todos/` directory still exists locally, include its files and migrate keepers to `agents/todos/`):
- List all existing todo files
- Read each one to understand its status and whether it's still relevant
- Note any that reference issues which are now completed or cancelled in Linear

#### 1d: Project Context
Read orientation docs to understand current phase and priorities:
- `CLAUDE.md` — current phase, what's remaining
- `packages/*/CHANGELOG.md` and `.changeset/*.md` — recent completions and pending release notes
- `docs/objectives.md` — if it exists, project goals

### Step 2: Account for the Last Plan

**Before cleaning anything, account for the last plan.** Step 2b deletes the evidence, so
this runs first.

**The cohort is read from `replanned_on`, never inferred from what is on disk.** Todo files
are *deliberately preserved* across runs (Step 2b, "Preserve good todos"), so "the files
that are here" is not "what was planned last time" — a todo carried for five days would be
counted as a fresh commitment every one of them, and the Account would report promises
nobody made. So each todo carries two dates in its frontmatter:

- **`planned_on`** — when it was **first** planned. Never rewritten once set.
- **`replanned_on`** — an ISO **timestamp** (not a bare date) for the most recent run that
  selected it. Rewritten every run that does.

**The cohort is every todo sharing the newest `replanned_on` value older than this run** —
not "yesterday's date". Two things make the max-value rule the right one rather than a
fussier alternative: `plan-day` can run **twice in a day**, and a bare date would merge two
different plans into one cohort (run 1 picks A+B, run 2 picks only B, and A is then reported
as an unmet commitment it never was); and a run that plans **nothing** writes no stamp, so
the max correctly still points at the last run that actually planned something. A run ID or
a separate manifest would work too and buys nothing over a timestamp.

**A todo predating this rule keeps an unknown age — backfill `replanned_on` only.** Stamping
it is a fact (this run selected it); stamping `planned_on` would be an invention, and the
`carried Nd` line below would then compute a real-looking age off a made-up date, which is
worse than no age at all. Leave `planned_on` absent and report those as *carried, age
unknown* until they are next planned.

For each todo in that cohort, report one line: **landed** (merged), **in flight** (PR
open), or **didn't start** — and for anything that didn't land, the one-line reason
(blocked, deprioritized, harder than scoped, never picked up).

**Call out the carried ones by age.** `planned_on` makes the most useful signal here
visible for the first time: a todo planned five days running and never started is not a
task, it is a decision nobody is making. Report those as *carried Nd* and say what should
happen to them — and where `planned_on` is absent, *carried, age unknown*. Never compute an
age from a date you backfilled; an invented `Nd` reads exactly like a measured one.

**Why this is first and not optional.** A plan with no account is unfalsifiable: a task
that was wrong to plan yesterday looks identical to one that was right, so the same
mis-scoped todo gets regenerated every morning and nothing in the loop notices. The
cleanup in 2b is *how the evidence disappears* — a completed issue's todo is deleted, so
by Step 3 there is no longer any record of what was promised.

**Don't editorialize.** Three or four words per item. The value is the tally, not the
narrative, and a long Account is a sign this is being written for the report rather than
for the next plan.

### Step 2b: Clean Stale Todos

Now that the last plan has been accounted for, clean up `agents/todos/`:

1. **Remove completed todos** — if the Linear issue is in "Done"/"Cancelled" state, delete the todo file
2. **Remove outdated todos** — if the task description no longer matches the Linear issue (e.g., scope changed significantly), delete the file so it gets regenerated fresh
3. **Remove unblocked-but-reprioritized todos** — if a todo exists but the Linear issue priority has dropped or the issue was deprioritized, remove it
4. **Keep valid todos** — if a todo file exists for an issue that's still active and the plan is still accurate, leave it in place

Report what was cleaned and why.

### Step 3: Identify Workable Tasks

From the Linear issues, filter to tasks that are **actually workable today**:

1. **Unblocked** — no blocking dependencies that are still in progress (check Linear relations AND check if dependent code is on main)
2. **Soon-unblocked** — blocked only by a PR that's approved and likely to merge today. Mark these clearly as "available after PR #X merges"
3. **Not already in progress** — skip issues someone else is actively working on (check assignee, PR existence)
4. **Appropriate scope** — each task should be completable as a single PR. If an issue is too large, note it but suggest the first sub-task instead

Rank by:
1. Priority (from Linear)
2. **Objective service** — does this move the project objective in [`docs/objectives.md`](../../../docs/objectives.md)? Mark each task ⭑ if it does. Most days most tasks won't, and that's fine — the mark is information, not a filter
3. Unblocking impact (does completing this unblock other high-priority work?)
4. Phase alignment (does this advance the current phase goals?)
5. Momentum (is this a natural continuation of recently completed work?)

Select up to **8 tasks**. If $ARGUMENTS specifies a focus area, weight tasks in that area higher but don't exclude others entirely.

**The ceiling of 8 is deliberate and stays.** A human team focusing on one or two goals is
solving an attention-splitting problem we don't have — these run in isolated worktrees and
cost each other nothing. What *does* need bounding is how many distinct **objectives** are
in flight, and that cap lives on epics
([`orchestration.md`](../../../docs/contributing/orchestration.md) → "How many epics run at
once"), not here. So: don't trim the list to look focused. Mark which tasks serve the
objective and let the count be what it is — **a day where zero of the eight carry ⭑ is the
signal**, and it is one you can only see if the eight are all still listed.

### Step 4: Generate Todo Files

For each selected task, create a todo file in `agents/todos/`.

**Every selected task gets `replanned_on` stamped with this run's timestamp — including the
ones you don't regenerate.** A task preserved from an earlier run (Step 2b) is skipped for *content*,
not for this: open it and update the one field. That stamp is the only record that **this**
plan selected it, and it is what tomorrow's Account (Step 2) reads to identify its cohort.
Skip it and the two dates never get written at all — new todos enter the next run as legacy
records with no `planned_on`, carried ones never show they were re-selected, and the Account
falls back to exactly the guesswork these fields exist to remove.

**File naming:** `{linear-id}-{priority}-{kebab-description}.md`
Example: `FSD-142-p2-fix-sse-resume-token.md`

**File structure:**

```markdown
---
linear_id: "FSD-142"
linear_url: "https://linear.app/..."
status: ready
priority: p2
tags: [server, streaming]
blocked_by: []             # or ["FSD-140"] / ["PR #87"]
estimated_scope: small     # small | medium | large
planned_on: 2026-08-14T09:12:00Z    # first planned. Set once, NEVER rewritten
replanned_on: 2026-08-14T09:12:00Z  # this run. Rewritten by every run that selects it
---

# Fix SSE resume token not persisting across reconnections

## Context

[2-3 sentences: what this task is, why it matters, and where it fits in the current phase]

## Problem

[What's broken or missing. Be specific — reference files, behaviors, error messages]

## Approach

[Concrete implementation plan. Which files to modify, what the change looks like, key decisions.
This section should be detailed enough that an agent in a fresh worktree can execute it without
reading the Linear issue or any other context.]

## Files to Modify

- `packages/engine/src/streaming/sse.ts` — [what changes]
- `packages/engine/src/__tests__/sse.test.ts` — [what to test]

## Acceptance Criteria

- [ ] [Specific, testable criterion]
- [ ] [Another criterion]
- [ ] All affected package tests pass
- [ ] Typecheck passes

## Dependencies

[What must be on main before this can start. If blocked by a PR, note the PR number.
If no dependencies, say "None — can start immediately."]

## Open PRs That May Affect This

[List any open PRs that touch the same files or systems. Note potential conflicts.]
```

### Step 5: Present the Plan

Lead with the Account from Step 2 — it is what makes today's plan checkable tomorrow — then
the prioritized list:

```
Yesterday (4 planned): 2 landed · 1 in flight (#88) · 1 didn't start (blocked on FSD-140)

Today's Plan (X tasks) — 2 of 8 serve the objective:

1. 🟢 ⭑ FSD-142: Fix SSE resume token [p2, small, unblocked]
2. 🟢    FSD-145: Add missing middleware seam for state ops [p2, medium, unblocked]
3. 🟡 ⭑ FSD-148: Wire resource visibility on server state endpoint [p1, medium, after PR #87]
4. ...
```

Legend:
- 🟢 = unblocked, ready to start
- 🟡 = blocked by in-flight PR (expected to unblock today)
- 🔴 = dependency not yet started (included for visibility but not expected today)
- ⭑ = serves the project objective ([`docs/objectives.md`](../../../docs/objectives.md))

For each task, show: Linear ID, title, priority, estimated scope, and blockers (if any).

After the list, include:
- **Cleaned todos**: what was removed and why
- **Notable PRs**: open PRs that are close to merging and what they unblock
- **Not included**: any high-priority items that are blocked and why, so the user has visibility into what's waiting

**Say the ⭑ count out loud in the header**, even when it's zero. A day of eight unstarred
tasks is a legitimate day — foundations, bugs, cleanup — but several such days in a row is
the thing worth seeing, and it is invisible unless the count is stated each time.

## Todo File Lifecycle

These todo files are designed to be consumed by agents in worktree sessions:

1. **`plan-day`** creates/updates them (this skill)
2. User picks a task and starts a worktree session
3. The agent reads the todo file for full context
4. Work is completed as a PR
5. Next `plan-day` run cleans the completed todo

## Guidelines

- **Self-contained todos.** Each file must have enough context that an agent can execute it without reading Linear, the PR, or other todos. Duplicate information if needed.
- **Realistic scope.** If a task is "large", suggest breaking it into a first-PR scope and note what comes after.
- **Respect the dependency graph.** Don't surface tasks as "ready" if their dependencies haven't landed on main, even if the dependency PR exists.
- **soon-unblocked is useful.** Flagging tasks that unblock after a nearly-merged PR helps the user plan their sequence.
- **Don't over-plan.** 8 tasks is a ceiling, not a target. If only 3 things are unblocked, surface 3.
- **Preserve good todos.** If a previous run generated a solid plan for a task and nothing has changed, don't regenerate it. Stability is better than churn.
