---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/workforce": minor
---

Consolidate the orchestration substrate into a single package,
`@flow-state-dev/orchestration`. It merges the former `@flow-state-dev/tasks`
(task collections, dispatchers, workers, flow policy), the `task-board` primitive
(previously `@flow-state-dev/patterns/task-board`), and `@flow-state-dev/skills`
(the `SKILL.md` runtime and the `taskTools` surface). Task board is a primitive,
not a pattern — this puts it beside the substrate it drains, while the composed
wrappers (`supervisor`, `parallelTasks`, `planAndExecute`, …) stay in
`@flow-state-dev/patterns`, now built on top of orchestration.

Migration — update imports:

- `@flow-state-dev/tasks` → `@flow-state-dev/orchestration`
- `@flow-state-dev/skills` → `@flow-state-dev/orchestration`
- `@flow-state-dev/patterns/task-board` → `@flow-state-dev/orchestration/task-board`

`@flow-state-dev/patterns` no longer re-exports the task-board API from its main
entry and no longer exposes the `./task-board` subpath — import the board from
`@flow-state-dev/orchestration/task-board`. `@flow-state-dev/workforce` now depends
on `@flow-state-dev/orchestration` in place of `@flow-state-dev/skills`. Package
layering is unchanged in shape (`core → orchestration → patterns`,
`workforce → orchestration`) with one fewer boundary; the `defaultPatternRegistry`
and `materializeAgent` injection seams are preserved, so no dependency cycle is
introduced.
