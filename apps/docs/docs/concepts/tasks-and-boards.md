---
title: Tasks and boards
type: concept
description: A board is a stored list of tasks and the loop that works through it, in dependency order.
---

import Figure from "@site/src/components/Figure";
import Board from "./figures/board.svg";

# Tasks and boards

Some work is a list. Research three competitors, then write the comparison. The three can run at once. The comparison has to wait for all of them, and if one fails you want to know before the writer starts.

A board is that list, stored, plus the loop that works through it, called the drain. You add tasks and say which ones depend on which. The drain takes whatever is ready and runs it. It stops when every task is done or nothing left can run.

<Figure svg={Board} caption="A board is a list and a loop, the list on a resource" description={"On the left, the list of tasks, drawn as the resource-stored variant from \"How long the list lasts\", so it is hatched: it outlives the request. The smallest board below keeps the default instead, which lives on the request. acme is completed, globex and initech are in progress, and compare is pending because it waits on the other three; that row is highlighted as the one that cannot start yet. On the right, the drain, board.drain, drawn with a dashed outline because it lasts one action run. It claims a ready task, runs its block, records the result, and does that again until nothing is ready. Two arrows run from the drain to the list, one for the claim and one for the recorded result. When the drain ends the list stays, and a task added later waits for the next drain. Stored on the request instead, which is the default, the list ends when that request does."} />

## The smallest board

```ts title="src/flows/research/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { analyst } from "./blocks/analyst";
import { writer } from "./blocks/writer";

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
  actions: { run: board.drain },
})();
```

`analyst` and `writer` are blocks, the framework's units of work: a model call, a function, or a chain of them. Each lives in its own file beside the flow. `workers` maps each `assignee` name to the block that does that kind of task.

```ts title="src/flows/research/blocks/analyst.ts"
import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";

export const analyst = handler({
  name: "analyst",
  inputSchema: taskWorkerInputSchema,
  execute: (input): unknown => ({ findings: `Notes on: ${input.goal}` }),
});
```

```ts title="src/flows/research/blocks/writer.ts"
import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";

export const writer = handler({
  name: "writer",
  inputSchema: taskWorkerInputSchema,
  execute: (input): unknown => ({ report: JSON.stringify(input.deps) }),
});
```

Here both are plain functions, so the page runs without a model. A block that calls a model works in the same place. The board hands each block the task as its input: `goal`, and for `compare`, what the three research tasks produced on `input.deps`, keyed by task id.

`board.drain` is the drain, and it is a block too. Here the flow exposes it as an action named `run` that a client can call. It could as easily be one step in a longer chain.

## What a task carries

| Field | What it is |
| --- | --- |
| `id` | A name for the task, unique on its board |
| `goal` | What to do, in words |
| `assignee` | Which block does it |
| `deps` | The tasks that must be `completed` first |
| `status` | `pending`, then `in_progress`, then `completed` or `errored`; `cancelled` for a task that will not run. [Every status and what moves a task between them](../reference/task-board.md) is in the reference |

A task is ready when every task in its `deps` is `completed`. The drain runs up to four ready tasks at a time unless you set another limit, and a task never runs in two places at once.

## When a task fails

A failed task is marked `errored` and the board carries on with whatever else is ready. Tasks that depended on it are cancelled, and so are the tasks that depend on those, so none of them runs. A failed task is not retried unless you allow it; [Retries](../reference/task-board.md) covers how.

When nothing else is ready, the drain stops and says why. It ends by emitting an item, the unit a flow streams to its caller, that carries a `terminationReason`: `all-completed` when every task finished, `blocked-by-failures` when some could not. Your flow reads that and decides what to tell the user. The [other stop reasons](../reference/task-board.md) are in the reference.

## How long the list lasts

The tasks are stored data, and you choose where. That choice is the board's lifetime. A resource is stored data, kept for one session (the record a flow keeps across many requests), one user, or one organization.

| Stored on | Lasts for | Use it when |
| --- | --- | --- |
| The request (the default) | One request | The work starts and finishes in one go |
| A resource in session, user or org scope | Across requests | People add tasks over time, or come back for results |

To keep the list, declare a task collection and give it to the board. Nothing else changes: `initialTasks` and `board.drain` stay as they were.

```ts title="src/flows/research/flow.ts"
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";

const research = defineTaskCollection({ id: "research", scope: "session" });

const board = taskBoard({
  name: "competitor-research",
  collection: research,
  workers: { analyst, writer },
  initialTasks: [/* the same four tasks */],
});
```

`scope: "session"` gives each conversation its own list. A `user` list is shared by every session of that user, and an `org` list by everyone in the organization. Each drain applies `initialTasks` again but skips a task whose `id` is already in the list, so a second request does not add the four tasks twice. A task with no `id` would be added again on every drain.

The drain has no lifetime of its own. It runs while a request is running `board.drain`, and then it is gone. Nothing runs it on its own, and nothing wakes it when a task is added. Tasks added afterwards wait where they are until a request runs a drain again. So a board on its own is not a background queue.

## Who does the work

In the example, two blocks in the same flow do everything. A task can also go to one of your named [workers](./workers.md), or run in a session of its own, a separate session the board starts for that one task. The list and the dependency rules stay the same.

By default the drain waits for the task to finish there. A board can also hand tasks out and return at once, so the work outlives the request; [Background work](./background-work.md) covers it, and the [reference](../reference/task-board.md) has the details.

## Start with a pattern

Patterns are ready-made compositions that build the board for you:

- [Parallel Tasks](../catalog/patterns/parallel-tasks.md) splits a job into tasks once and runs them side by side.
- [Supervisor](../catalog/patterns/supervisor.md) adds a review of each result before it is accepted.
- [Plan and Execute](../catalog/patterns/plan-and-execute.md) can plan again between rounds, using what came back.

Use `taskBoard` directly when tasks arrive from outside while the board is working, or when you are building a pattern of your own.

## What it gets you

Plain code could run the three researchers with `Promise.all` and then call the writer. A board adds what that leaves out:

- **The comparison never starts on partial research.** `compare` waits until `acme`, `globex` and `initech` are all `completed`, and the three run together.
- **A failed competitor stops the writer.** If `initech` fails, `compare` is cancelled and its block never runs. `acme` and `globex` finish, and the flow is told why the drain stopped.
- **Results arrive handed over.** `compare` reads the three outputs on `input.deps`, with no query to write.
- **A stored board can be picked up later.** On a resource, a later request runs the drain over the same list, and a task added in between is worked then.

## How it fits with the others

A board is a list and a loop, not a scheduler. A job that has to start at night needs a schedule or a queue to start it: a scheduled action can run a block, and `board.drain` is a block. [Background work](./background-work.md) covers what runs outside a request.

## Next

- [Build a research team](../build/research-team.md) builds the example above with real models and adds a competitor list that arrives at run time.
- [Workers](./workers.md) covers handing tasks to named agents.
- [Task board reference](../reference/task-board.md) has every option, status and stop rule.
