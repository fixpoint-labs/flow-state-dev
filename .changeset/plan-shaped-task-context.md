---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/core": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/ui": minor
---

Tasks gain optional first-class `title` (a concise label) and `context` (readable per-task support text), carried end-to-end to workers and rendered as `title ?? goal` in the plan UI.

The `utility.decomposer` planner now emits `title` and `context` per task, prompting the model to copy the concrete facts each task needs into `context`.

Plan-shaped patterns (Plan & Execute, Supervisor) now supply per-task `context` by default — every task without planner-supplied context gets the goal copied in, with no extra model call — and gain an opt-in `synthesizeGoal` that rewrites a conversation-dependent request into a self-contained goal before planning, replanning, and synthesizing; both are configurable on `PlanAndExecuteConfig` and `SupervisorConfig` (`taskContext`: `"goal"` | `false` | a custom enricher block; `synthesizeGoal`: `true` | `false` | a custom synthesizer).

`<TaskPlan />` renders a task's `title` as the row label when present, falling back to the full `goal`.
