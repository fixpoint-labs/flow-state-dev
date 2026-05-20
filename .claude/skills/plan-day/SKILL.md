---
name: fsd:plan_day
description: Identify unblocked Linear tasks based on what's on main and in open PRs, prioritize up to 8 for today, clean stale todos, and generate a work plan for each as a file in .claude/todos/.
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
Use Linear MCP tools to fetch:
- All active issues (backlog, todo, in progress) for the project
- Include relations to understand blocking/blocked-by dependencies
- Recently completed issues (last week) for context on momentum

#### 1c: Existing Todos
Read the current `.claude/todos/` directory:
- List all existing todo files
- Read each one to understand its status and whether it's still relevant
- Note any that reference issues which are now completed or cancelled in Linear

#### 1d: Project Context
Read orientation docs to understand current phase and priorities:
- `CLAUDE.md` — current phase, what's remaining
- `packages/*/CHANGELOG.md` and `.changeset/*.md` — recent completions and pending release notes
- `docs/objectives.md` — if it exists, project goals

### Step 2: Clean Stale Todos

Before generating new plans, clean up `.claude/todos/`:

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
2. Unblocking impact (does completing this unblock other high-priority work?)
3. Phase alignment (does this advance the current phase goals?)
4. Momentum (is this a natural continuation of recently completed work?)

Select up to **8 tasks**. If $ARGUMENTS specifies a focus area, weight tasks in that area higher but don't exclude others entirely.

### Step 4: Generate Todo Files

For each selected task, create a todo file in `.claude/todos/`. Skip tasks that already have a valid, up-to-date todo file (preserved in Step 2).

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
blocked_by: []           # or ["FSD-140"] / ["PR #87"]
estimated_scope: small   # small | medium | large
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

- `packages/server/src/streaming/sse.ts` — [what changes]
- `packages/server/src/__tests__/sse.test.ts` — [what to test]

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

Present the day's plan to the user as a prioritized list:

```
Today's Plan (X tasks):

1. 🟢 FSD-142: Fix SSE resume token [p2, small, unblocked]
2. 🟢 FSD-145: Add missing middleware seam for state ops [p2, medium, unblocked]
3. 🟡 FSD-148: Wire resource visibility on server state endpoint [p1, medium, after PR #87]
4. ...
```

Legend:
- 🟢 = unblocked, ready to start
- 🟡 = blocked by in-flight PR (expected to unblock today)
- 🔴 = dependency not yet started (included for visibility but not expected today)

For each task, show: Linear ID, title, priority, estimated scope, and blockers (if any).

After the list, include:
- **Cleaned todos**: what was removed and why
- **Notable PRs**: open PRs that are close to merging and what they unblock
- **Not included**: any high-priority items that are blocked and why, so the user has visibility into what's waiting

## Todo File Lifecycle

These todo files are designed to be consumed by agents in worktree sessions:

1. **`fsd:plan_day`** creates/updates them (this skill)
2. User picks a task and starts a worktree session
3. The agent reads the todo file for full context
4. Work is completed as a PR
5. Next `fsd:plan_day` run cleans the completed todo

## Guidelines

- **Self-contained todos.** Each file must have enough context that an agent can execute it without reading Linear, the PR, or other todos. Duplicate information if needed.
- **Realistic scope.** If a task is "large", suggest breaking it into a first-PR scope and note what comes after.
- **Respect the dependency graph.** Don't surface tasks as "ready" if their dependencies haven't landed on main, even if the dependency PR exists.
- **soon-unblocked is useful.** Flagging tasks that unblock after a nearly-merged PR helps the user plan their sequence.
- **Don't over-plan.** 8 tasks is a ceiling, not a target. If only 3 things are unblocked, surface 3.
- **Preserve good todos.** If a previous run generated a solid plan for a task and nothing has changed, don't regenerate it. Stability is better than churn.
