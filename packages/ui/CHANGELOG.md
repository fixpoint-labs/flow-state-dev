# @flow-state-dev/ui

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-18 — Moderated Debate (FIX-607)

New `<Debate />` container renderer (kitchen-sink + UI registry). Groups the transcript by round, opens each round with the moderator's decision card (speakers, briefing, focus), and closes with the judge's verdict.

### 2026-05-18 — Configurable downstream information flow on Task Board (FIX-610)

Task Board renderers carry the cache-hit attribution surfaced by the new utilities-task-flow package (`cached: true`, `cacheAgeMs`, `sourceTask`).

### 2026-05-16 — Round Robin pattern reshape (FIX-597)

Renderer updated to surface referee critiques per round and drop the judge's terminating summary now that the synthesizer is the terminal step.

### 2026-05-15 — Kitchen-sink in-flight status (FIX-600)

Generator/tool status snapshot-and-restore: a tool's status no longer lingers past its own execution. The "Using `<tool>`…" hint routes through the same slot so tools that don't emit their own status get a clean restore.

### 2026-04-30 — `taskBoard` follow-up (FIX-447)

`<TaskPlan />` row expansions render a vertical timeline of windowed items — compact tool-call rows, message lines, reasoning lines, and the worker's `task.output` Markdown. Tool-call summary extraction lifted into a shared `tool-summaries.ts` helper used by both reactive-blackboard and task-plan.

### 2026-04-29 — `<TaskPlan />` (FIX-445)

`TaskPlan` registered at `task-plan`. Section-grouped renderer for any TaskCollection — subscribes to `task-change` and `task-board-meta` items, latest-wins per task, sectioned by status. Pattern wrappers can extend the status vocabulary; consumers register pattern-specific icons / colors via `statusConfig` without forking. Optional `groupByAssignee` toggle adds sub-groups per assignee within each section.

### 2026-04-29 — Patterns migrated onto `taskBoard` (FIX-447) [BREAKING]

UI registry updated to consume `task-change` / `task-board-meta` items. Legacy `Plan` is unchanged in this release; both ship side-by-side.

### 2026-05-13 — Skills declare a pattern (FIX-450)

`<ActiveSkills>` badge renders the active pattern with a distinct icon.
