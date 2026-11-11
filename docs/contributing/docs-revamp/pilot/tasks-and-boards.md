---
title: Tasks and boards
type: concept
description: A board is a stored list of tasks and the loop that works through it, in dependency order.
---

# Tasks and boards

Some work is a list. Research three competitors, then write the comparison. The three can run at once. The comparison has to wait for all of them, and if one fails you want to know before the writer starts.

A board is that list, stored, plus the loop that works through it, called the drain. You add tasks and say which ones depend on which. The drain takes whatever is ready and runs it. It stops when every task is done or nothing left can run.

![A board: a stored list of tasks, and a drain that works through it](./figures/board.svg)

*A board is a list and a loop. Description for the site's `Figure`: On the left, the stored list of tasks: acme is completed, globex and initech are in progress, and compare is pending because it waits on the other three. On the right, the drain, which runs inside a request: it claims a ready task, runs its block, records the result, and repeats. Several of these loops run at once, and they stop when every task is done or nothing left can run.*

## The smallest board

```ts
import { defineFlow } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";

const board = taskBoard({
  name: "competitor-research",
  workers: { analyst, writer },
  initialTasks: [
    { id: "acme", goal: "Research Acme", assignee: "analyst" },
    { id: "globex", goal: "Research Globex", assignee: "analyst" },
    { id: "initech", goal: "Research Initech", assignee: "analyst" },
    {
      id: "compare",
      goal: "Write the comparison",
      assignee: "writer",
      deps: ["acme", "globex", "initech"],
    },
  ],
});

export default defineFlow({
  kind: "research",
  actions: { run: { block: board.drain } },
})();
```

`analyst` and `writer` are blocks, the framework's units of work: a model call, a function, or a chain of them. `workers` maps each `assignee` name to the block that does that kind of task.

`board.drain` is the drain, and it is a block too. Here the flow exposes it as an action named `run` that a client can call. It could as easily be one step in a longer chain.

When `compare` runs, its block receives what the three research tasks produced on `input.deps`, keyed by task id.

## What a task carries

| Field | What it is |
| --- | --- |
| `id` | A name for the task, unique on its board |
| `goal` | What to do, in words |
| `assignee` | Which block does it |
| `deps` | The tasks that must be `completed` first |
| `status` | `pending`, then `in_progress`, then `completed` or `errored` |

A task is ready when every task in its `deps` is `completed`. The drain runs up to four ready tasks at a time unless you set another limit, and a task is only ever claimed once.

## When a task fails

A failed task is marked `errored` and the board carries on with whatever else is ready. Tasks that depended on it are cancelled, so they never run.

When nothing else is ready, the drain stops and says why. It ends by emitting an item, the unit a flow streams to its caller, that carries a `terminationReason`: `all-completed` when every task finished, `blocked-by-failures` when some could not. Your flow reads that and decides what to tell the user. There are a few other reasons, such as a task waiting on a user, and the reference lists them.

## How long the list lasts

The tasks are stored data, and you choose where. That choice is the board's lifetime. A resource is stored data a flow declares, kept for one conversation (a session), one user, or one organization.

| Stored on | Lasts for | Use it when |
| --- | --- | --- |
| The request (the default) | One request | The work starts and finishes in one go |
| A resource in session, user or org scope | Across requests | People add tasks over time, or come back for results |

The drain has no lifetime of its own. It runs while a request is running `board.drain`, and then it is gone. Tasks added afterwards wait where they are until a drain runs again. So a board on its own is not a background queue.

## Who does the work

In the example, two blocks in the same flow do everything. A task can also go to one of your named [workers](./workers.md), or run in a session of its own. The list and the dependency rules stay the same.

By default the drain waits for that session to finish. A board in delegation mode returns as soon as its tasks are handed out, and each session settles its task later. That is how work outlives the request that asked for it, and [Background work](./background-work.md) covers it.

## Start with a pattern

Three common shapes ship as patterns, ready-made compositions that build the board for you:

- [Parallel Tasks](../catalog/patterns/parallel-tasks.md) splits a job into tasks once and runs them side by side.
- [Supervisor](../catalog/patterns/supervisor.md) adds a review of each result before it is accepted.
- [Plan and Execute](../catalog/patterns/plan-and-execute.md) plans again between rounds, using what came back.

Use `taskBoard` directly when tasks arrive from outside while the board is working, or when you are building a pattern of your own.

## What a board won't do

- Run on its own. Something has to run the drain.
- Retry a failed task, unless the task sets `maxAttempts`.

## Next

- [Build a research team](../build/research-team.md) builds the example above with real models and adds a competitor list that arrives at run time.
- [Workers](./workers.md) covers handing tasks to named agents.
- [Task board reference](../reference/task-board.md) has every option, status and stop rule.
