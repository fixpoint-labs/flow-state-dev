---
title: Orchestration
sidebar_position: 1
sidebar_label: Overview
description: How flow-state-dev coordinates many units of work — the task substrate, the task board, the patterns built on it, and agents.
---

# Orchestration

Most agent frameworks give you one loop and hope your problem fits inside it. Real work rarely does. You fan out to several workers, some of them depend on others, one fails and you have to decide whether the rest can still run, and partway through you discover three more tasks you didn't know about at the start.

Orchestration in flow-state-dev is the machinery for exactly that: many units of work, coordinated. It lives in one package, `@flow-state-dev/orchestration`, and it's built in layers you can enter at whatever height your problem needs.

## The layers

```
Agents            (workforce)     — named participants you assign work to
  ▲
Patterns          (patterns)      — supervisor, parallelTasks, planAndExecute, …
  ▲
Task board        (orchestration) — a concurrent drain over a collection
  ▲
Task substrate    (orchestration) — the Task record + TaskCollection + dispatchers
```

Read it bottom-up.

**Task substrate.** A `Task` is one unit of work: a goal, a status, optional dependencies, a typed input and output. A `TaskCollection` holds a set of them with safe concurrent access — two workers can never claim the same task. This is the foundation. Everything above is a way of putting tasks into a collection and taking results out. See [Task substrate](./task-substrate).

**Task board.** A board runs a pool of workers that pull ready tasks from a collection, respect dependencies, and drain until nothing is left to run. It's the orchestration primitive. When you need concurrent, dependency-aware execution and none of the higher-level patterns fit, you reach for the board directly. See [Task board](./task-board).

**Patterns.** The common shapes are already built for you, in `@flow-state-dev/patterns`. `parallelTasks` fans out once and collects. `supervisor` adds a review step before each result is written back. `planAndExecute` re-plans across drains. Each is a thin composition over the task board. Start here; drop to the board only when your coordination doesn't match one of them.

**Agents.** A worker can be a plain block, or it can be an agent: a named, reusable participant with a persona, a model, and a set of tools. Register an agent once and assign board tasks to it by name. See [Agents](./agents).

## Two ways to drive a board

You wire orchestration one of two ways, depending on who's in charge.

**Code-first.** You define the board in TypeScript — its workers, its initial tasks, its dependency graph — and mount it as a step in a flow. You know the shape of the work up front, or your code decides it. This is the `taskBoard(...)` factory.

**Agent-first.** An agent decides what work to create at runtime. You give it the `taskTools` capability — eight tools like `addTask` and `completeTask` — and it enqueues tasks as it discovers them. A discoverer agent might search, find twelve items, and queue one analysis task per item plus a synthesis task that waits on all twelve. This path usually rides on a `pattern: task-board` skill. See [Pattern skills](../skills/pattern-skills).

Both paths drive the same substrate. You can mix them: a code-defined board whose workers call `taskTools` to enqueue follow-up work mid-run.

## Where work blocks, and where it doesn't

Dependencies are how you say "this can't start until that finishes." A task lists the ids it depends on, and the default dispatcher won't hand it to a worker until every dependency has completed. That's how a synthesizer waits for its analysts without any glue code on your side.

A board also needs a rule for when to stop. By default it drains until either every task completed or nothing runnable is left (a failure upstream can strand the tasks that depended on it). You can also tell a board to wait indefinitely for work that arrives from outside. Those termination modes are covered in [Task board](./task-board).

## Start here

- **[Task board](./task-board)** — the primitive, its config, and its termination modes.
- **[Build a research team](/guides/building-a-research-team)** — a guide that goes from an empty flow to a running multi-agent board, both the code-first and agent-first way.
- **[Task substrate](./task-substrate)** — the `Task` and `TaskCollection` contracts underneath it all.

## Related pages

- [Patterns overview](../patterns/overview) — the coordination patterns built on the task board.
- [Agents](./agents) — named participants you can assign work to.
- [Pattern skills](../skills/pattern-skills) — the agent-first path and the `taskTools` surface.
