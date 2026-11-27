---
title: Tasks and boards
sidebar_label: Tasks and boards
type: concept
description: A task is a stored unit of work. A board is the list of them plus the loop that works through it. How a task is claimed, run, waited on and ended.
---

import Figure from "@site/src/components/Figure";
import LifecycleDrawing from "./figures/task-lifecycle.svg";

# Tasks and boards

Some work is a list. Research three competitors, then write the comparison. The three can run at once. The comparison has to wait for all of them, and if one fails you want to know before the writer starts.

A board is that list, stored, plus the loop that works through it. You add tasks and say which ones depend on which. Assignees take whatever is ready. The loop stops when every task is done or nothing left can run.

## A task

A task is one stored unit of work. The fields you meet first:

- `goal`: what to do, in words.
- `assignee`: who does it. A key in the board's `workers` map, or the id of a [worker](./workers).
- `deps`: ids of tasks that must complete first.
- `input` and `output`: typed payloads in and out.
- `status`: where it is in its life, covered below.

Code files tasks when the flow starts, or any block can add more while the board runs. A model files them too, through four task tools: `createTask`, `getTask`, `listTasks` and `updateTask`. A fifth, `reportProgress`, is offered only to the turn that is working a task.

## A board

```ts
const analyst = generator({
  name: "analyst",
  model: "openai/gpt-6-luna",
  prompt: "Research the subject you are given. Report findings.",
  inputSchema: taskWorkerInputSchema,
  user: (task) => task.goal,
});

const writer = generator({
  name: "writer",
  model: "openai/gpt-6-luna",
  prompt: "Write a comparison from the findings you are given.",
  inputSchema: taskWorkerInputSchema,
  user: (task) => JSON.stringify(task.deps),
});

const board = taskBoard({
  name: "comparison",
  workers: { analyst, writer },
  initialTasks: [
    { id: "a", goal: "Competitor A", assignee: "analyst" },
    { id: "b", goal: "Competitor B", assignee: "analyst" },
    { id: "c", goal: "Competitor C", assignee: "analyst" },
    { id: "write", goal: "Write the comparison", assignee: "writer", deps: ["a", "b", "c"] },
  ],
});

export default defineFlow({
  kind: "comparison",
  actions: { compare: { block: board.drain } },
})();
```

`board.drain` is a block like any other. Mount it as an action, or as a step in a sequencer. Each assignee is a block too, and a task reaches the block its `assignee` names. The writer reads its dependencies' outputs from `task.deps`, keyed by task id, so no step between them needs gluing.

## Claimed, run, ended

A task is always in one of six statuses.

<Figure svg={LifecycleDrawing} caption="A task's life" description={"A task starts pending, or held if it was filed on hold. A held task is released to pending, or cancelled. A pending task is claimed and becomes in progress, or is cancelled. An in-progress task completes, errors, is cancelled, or returns to pending when it fails with attempts left or its claim lapses. Completed, errored and cancelled are final. When a task errors or is cancelled, the tasks that depend on it are cancelled too."} />

**Claimed.** An idle assignee asks for the next ready task. A task is ready when it is `pending` and every task in its `deps` has completed. The claim is a single atomic write, so two assignees never run the same task: one wins and the other moves on to the next. A board runs up to four at once by default, set by `concurrency`.

**Run.** The claim carries a lease, two minutes by default, which the board renews while the work runs. If the process dies, the renewals stop, the lease lapses, and the next claim takes the task back. A task taken back this way is not charged against its failure retries.

**Ended.** No tool finishes a task. It ends when its block returns or throws:

- The return value becomes its `output`, and the task is `completed`.
- A throw ends it `errored`, unless the task has `maxAttempts` left. Then it goes back to `pending` with the error attached as feedback, and the next attempt sees it.
- A cancel, from the filer or a person, ends it `cancelled` at any point before it finishes.

When a task errors or is cancelled, every task that depends on it, and every task that depends on those, is cancelled and labelled `skipped`. The writer above never starts with a hole where competitor B should be.

## Waiting

A task can wait without being stuck.

- **Held.** File a task with `held: true` and it sits in `held` until someone releases it. Nothing starts it, and it can still be cancelled or edited.
- **Waiting on a person.** File a task with `questions` and it stays `pending` until each is answered. The answers join its brief. A worker can also ask midway with `holdTaskForUser`. The turn ends, the task keeps its attempt and its work so far, and the person's answer starts one more turn on the same attempt.
- **Waiting on a decision.** A run can stop with `suspendForUser` for an approval or a review. The task stays `in_progress`, shows the stop in its `holds`, and resumes where it left off when the person answers.

A person answers from an inbox, or by typing a line into the task's session, which answers its oldest open question. A task that waits on a person does not hold the board open. If every task left is waiting on one, the board stops with the reason `waiting-on-a-user`, and the next drain after the answer picks up whatever depends on it.

## When a board stops

By default a board stops when every task has completed, or when nothing left can run: no assignee is working, and no pending task has all its dependencies done. It reports why: `all-completed`, `blocked-by-failures`, `waiting-on-a-user` or `retry-budget-exhausted`. `onIdle: "wait"` keeps a board open for work that arrives from outside, until a predicate you supply says stop.

## What a board is not

A board is stored tasks plus a drain that works them, and the two last for different times. The drain runs only while a request is executing it. Tasks added while nothing drains wait where they are, and adding one wakes nothing.

Where the tasks live is your choice. By default they last for the request. Declare a collection at session, user or org scope and they outlive it, ready for the next drain.

So a board is not a background queue. To run work outside the request that asked for it, start a separate run of a flow that builds and drains its own board. [Background work](./background-work) covers the options.

## Next

On a Workforce conversation, the board is already there: a coordinator files tasks on it for the workers it can hand work to. [Workers](./workers) covers who those are.
