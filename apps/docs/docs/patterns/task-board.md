---
sidebar_position: 2
title: Task Board
description: The shared task-drain substrate used by higher-level patterns.
---

# Task Board

Task Board is the shared substrate behind several ecosystem patterns. It stores work as `Task` records in a `TaskCollection`, claims ready tasks with CAS-safe updates, runs workers with bounded concurrency, and emits keyed component snapshots for live progress.

Most applications use Task Board through a higher-level pattern:

- [Parallel Tasks](./parallelTasks) for one-pass fan-out and synthesis.
- [Supervisor](./supervisor) for fan-out with per-task review.
- [Plan and Execute](./plan-and-execute) for dependency-ordered execution and replanning.
- [Event Actors](./event-actors) for event-driven actor fan-out.

Use the substrate directly when you are building a new pattern factory, or when you need the queue semantics without the planning and synthesis layers.

## What it provides

| Surface | Purpose |
| --- | --- |
| `TaskCollection` | Request-scoped or resource-backed task records. |
| Claiming | Workers take tasks atomically so concurrent workers do not double-run the same task. |
| Dependency gating | A task can wait for other tasks before becoming runnable. |
| Keyed progress items | `task-change` and `task-board-meta` component items update live renderers without polling. |
| Capability access | The board capability exposes the collection to blocks running inside the board scope. |

## When to stay higher level

If your flow starts with a user goal, stay with a pattern. The patterns give you planner, worker, reviewer, and synthesis wiring. Direct Task Board usage is for library authors and advanced flows where tasks already exist as data.

## Related pages

- [Patterns overview](./overview)
- [Event Actors](./event-actors)
- [Flow-aware UI components](/docs/ui/flow-aware-components)
