---
title: Orchestration
sidebar_position: 1
sidebar_label: Overview
description: How flow-state-dev coordinates many units of work — the task substrate, the task board, the patterns built on it, and agents.
---

# Orchestration

Real work rarely fits in a single loop. You fan out to several workers, some of them depend on others, one fails and you have to decide whether the rest can still run, and partway through you discover three more tasks you didn't know about at the start.

Orchestration in flow-state-dev is the machinery for exactly that: many units of work, coordinated. It lives in one package, `@flow-state-dev/orchestration`, and it's built in layers you can enter at whatever height your problem needs.

## The layers

```
Patterns          (patterns)      — supervisor, parallelTasks, planAndExecute, …
  ▲
Task board        (orchestration) — a concurrent drain over a collection
  ▲
Task substrate    (orchestration) — the Task record + TaskCollection + dispatchers
```

Read it bottom-up.

**Task substrate.** A `Task` is one unit of work: a goal, a status, optional dependencies, a typed input and output. A `TaskCollection` holds a set of them with safe concurrent access: two workers can never claim the same task. It's the foundation. Everything above is a way of putting tasks into a collection and taking results out. See [Task substrate](./task-substrate).

**Task board.** A board runs a pool of workers that pull ready tasks from a collection, respect dependencies, and drain until nothing is left to run. It's the orchestration primitive. When you need concurrent, dependency-aware execution and none of the higher-level patterns fit, you reach for the board directly. See [Task board](./task-board).

**Patterns.** The common shapes are already built for you, in `@flow-state-dev/patterns`. `parallelTasks` fans out once and collects. `supervisor` adds a review step before each result is written back. `planAndExecute` re-plans across drains. Each is a thin composition over the task board. Start here; drop to the board only when your coordination doesn't match one of them.

**Who does the work.** A board worker can be a plain block you wrote, a tool assigned by its catalog key, or an agent: a persona, a model, and a set of tools, declared in a skill's frontmatter and assigned board tasks by name. See [Agents](./agents) for the three and when each fits.

**Workers described in files.** Your app's workers can be described in a folder rather than written out one by one: one `WORKER.md` per worker, saying which of your flows it runs and how that copy is configured. `hireWorkforce` turns those records into one addressable flow copy each, which you register. A hired worker is an address you open a session against, not a participant you assign board tasks to. See [Workers on disk](./workers-on-disk).

**A worker built for coding agents.** Beside the patterns sits `@flow-state-dev/harness-manager`: a board worker that turns a task into a supervised coding run — its own checkout, a verdict read before the task settles, a question it can ask a person, and the coding agent itself as a slot you fill. See [Harness manager](./harness-manager) for the worker, and [Coding agents](../tools/coding-agents) for the agents it can drive and the handle they hand back.

## Two ways to drive a board

Which path you take depends on who decides the shape of the work.

**Code-first.** You define the board in TypeScript: its workers, its initial tasks, its dependency graph. Then you mount it as a step in a flow. You know the shape of the work up front, or your code decides it. This is the `taskBoard(...)` factory.

**Agent-first.** A generator decides what work to run at runtime. A skill that declares `agents:` installs a private task board, the `taskTools` capability (eight tools, `addTask` and `completeTask` among them), and a `runBoard` tool. The generator plans the work as tasks (`addTask` with an `assignee` naming one of the skill's agents, plus `deps`) and executes the whole graph by calling `runBoard`, which drains the board under concurrency and dependency gating. An assignee can also name one of the generator's own tools, which runs as a direct call with no model turn. [Authoring a delegating skill](/guides/agents-command-the-board) walks this path end to end; [Delegation](../skills/delegation) is the reference for the fields and the knobs.

Both paths drive the same substrate, and a worker can enqueue follow-up work mid-run either way. In a code-defined board, a worker resolves the collection with `getOrCreateTaskCollection` and calls `addTask`. Under a delegation skill, the `taskTools` resolve that skill's own board, and `runBoard` drains it.

## Where work blocks, and where it doesn't

Dependencies are how you say "this can't start until that finishes." A task lists the ids it depends on, and the default dispatcher won't hand it to a worker until every dependency has completed. That's how a synthesizer waits for its analysts without any glue code on your side.

A board also needs a rule for when to stop. By default it drains until either every task completed or nothing runnable is left (a failure upstream can strand the tasks that depended on it). You can also tell a board to wait indefinitely for work that arrives from outside, or to stop on a task that is waiting for a person and pick it up when the answer arrives. Those termination modes are covered in [Task board](./task-board), and the human-wait one in [Waiting on a person](./task-board#waiting-on-a-person-onreview).

A drain normally runs inside the request that mounted it, so every worker's task finishes before that request does. The exception is a worker declared to run in a child session instead of inline. The board claims a task for it as usual, hands the task to that child session, and moves on. The drain can finish while the task is still running, and the child session records the result when the worker is done. See [Seats that hand off](./task-board#seats-that-hand-off) for what such a board requires, and [Work that outlives the turn](/guides/background-work) for that path beside the other background-work surfaces.

## Start here

- **[Task board](./task-board)** — the primitive, its termination modes, and when to reach for it.
- **[Configuration](./configuration)** — field catalog for `taskBoard`, `goalSeekLoop`, `createSkillsLibrary`, and `skills.with`.
- **[Build a research team](/guides/building-a-research-team)** — a guide that goes from an empty flow to a running multi-agent board, both the code-first and agent-first way.
- **[Task substrate](./task-substrate)** — the `Task` and `TaskCollection` contracts underneath it all.

## Related pages

- [Patterns overview](../patterns/overview) — the coordination patterns built on the task board.
- [Agents](./agents) — the three things that can do a unit of work on a board.
- [Delegation](../skills/delegation) — the agent-first path and the `taskTools` surface.
- [Workers on disk](./workers-on-disk) — describing each worker in a folder, and hiring the tree as addressable flow copies.
- [Harness manager](./harness-manager) — a board worker that drives a coding agent to a settled verdict.
- [Coding agents](../tools/coding-agents) — the coding agents that worker drives, and the run handle they return.
