---
name: project-spec
description: Build or refresh a PROJECT-SPEC — the standing four-document set for one Linear project (the outcome, the cross-epic decisions, the rules every epic obeys, the arc against time), on a never-merged PR that stays open and true for the project's whole life. One altitude above the epic-spec. Dispatched by epic-lifecycle whenever an epic is created, approved, or wraps; runnable standalone. Use when the user asks to "stand up the project spec", "update the project", "where is this project at", wants a project-level picture across several epics, or names a Linear project that has epics running under it.
argument-hint: "<Linear project name or url> — optionally, the action (create | refresh | update)"
---

# Project Spec

A **project-spec** is the surface that says where a *Linear project* stands — its outcome, the
epics under it, the calls that bind more than one of them — and stays true whenever someone looks.
It is one altitude above the epic-spec and obeys the same law: the epics under it **reference and
align** to it, they do not derive from it.

**[`project-spec-template.md`](../../../docs/contributing/project-spec-template.md) is the
doctrine** — what each of the four documents carries, the budgets, the PR body, the refresh table,
and the publishing rules. **[`project-agent`](../../subagents/project-agent.md) is the procedure** —
one bounded action per dispatch, in its own worktree. Read those; this file is the entry point and
the wiring, and deliberately restates neither.

## Why there is no project-lifecycle

`epic-lifecycle` drives an epic because an epic has a shape that ends: a gate, a set of issues, a
wrap. A project has none of that. It runs for months, holds epics that start and finish far apart,
and outlives every session that touches it. Building a loop for it would mean a session that has to
stay alive for a quarter.

So the project-spec has **no lifecycle, no gate, and no owner process**. It is maintained by
whichever `epic-lifecycle` happens to be running, and it is correct in between because its status
is *derived from Linear* rather than accumulated — one query on the project returns its epics and
their states. That single property is what makes the artifact cheap: a refresh that is skipped,
raced, or lost costs nothing, because the next one recomputes the whole table from source.

## How it gets driven

**`epic-lifecycle` dispatches `project-agent` on epic-level transitions only** — the epic is
created under the project, its objective is approved, or it wraps. The full trigger table is in the
template; the rule that matters at the call site is the one it must never break:

> **Issue churn is not a trigger.** An issue opening, merging, or stalling moves the *epic* PR. A
> project-spec that refreshed on issue events would spend a worktree per transition and tell a
> reader nothing the epic PR does not already say.

**Two epics may run under one project**, and both may try to refresh it. They collide on
`project/<slug>`, so the second one **skips rather than queues** — safe for the same reason the
whole design is cheap: status is re-derived next time. The agent reports `skipped: branch busy` and
nothing is lost.

## Standalone use

Invoke it directly on a project — `/project-spec Workforce: Layer 2 Abstraction` — to stand one up
for a project that has epics but no spec yet, to refresh one that has drifted, or to **update** it
— the action that folds review feedback from its PR, records an answer, or carries an epic wrap. Resolve the project, then dispatch `project-agent` with the action; you hold
handles, never the spec text.

**Standing one up for a project with existing Linear content is the one action that needs care.**
Most projects carry hand-written `content`, sometimes thousands of words. The agent absorbs it
rather than overwriting it, and reports what it moved and what it dropped as stale — check that
report before you accept the build. Overwriting a human's project description is unrecoverable
through the API.

## What it is not

- **Not a second epic-spec.** If a call binds one epic, it is that epic's. Only calls that bind
  **two or more** belong here — otherwise this becomes a design nobody signed off.
- **Not a status dashboard.** Linear already computes `progress`, `state` and milestones. The spec
  reads those; it does not restate them. What it adds is the part Linear cannot hold: the outcome
  argued, the decisions with what they rejected, and the rules with owners.
- **Not gated.** There is no project approval. The epic objective gate is the only gate, and a
  change to the project outcome is an ask carried by whichever epic-lifecycle is running.
- **Not for every project.** Dozens exist and most are dormant. One is stood up the first time an
  epic runs beneath it.

## Verify (BP-003)

Run the figure and document checks from
[`spec-figures.md`](../../../docs/contributing/spec-figures.md) → "Verify" against
`spec/_projects/<slug>/` — they are altitude-independent and this set is subject to all of them.
**On a status-only refresh, scope them to what that pass actually edited** (the arc, the epics
table, the PR body) rather than the whole tree: the territory figure and the rules did not move,
and re-checking them every time an epic changes state is cost with nothing behind it.
Then the two checks specific to this altitude:

```bash
S=spec/_projects/<slug>
# 1. Status is derived, not stale: every epic row's state matches Linear right now.
#    Re-run the project query and diff the identifiers + states against SPEC.md's table.
grep -oE 'FIX-[0-9]+|LAB-[0-9]+|FIX-XXX' "$S/SPEC.md" | sort -u

# 2. No epic-altitude content leaked down. Every rule must name an owner epic;
#    a PR-n row with an empty owner cell is the seam this altitude exists to prevent.
awk -F'|' '/^\| \*\*PR-[0-9]+\*\*/ { gsub(/ /,"",$4); if ($4=="") print "NO OWNER: "$0 }' "$S/BUSINESS-RULES.md"
```

Both must come back clean: the first read against a live Linear query, the second printing nothing.
