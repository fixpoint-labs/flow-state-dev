---
title: Tasks and boards
sidebar_label: Tasks and boards
description: "A board is a stored list of tasks and the loop that works through it. How a task is claimed, run, waited on, and how it ends."
---

import Figure from "@site/src/components/Figure";
import TaskLifeDrawing from "./figures/task-life.svg";

# Tasks and boards

Some work is a list. Research two competitors, then write the comparison. The two can run at once. The comparison has to wait for both, and if one fails you want to know before the writer starts.

A **task** is one item on that list: a goal, who should do it, and which other tasks it waits for. A **board** is the list, stored, plus the loop that works through it. You add tasks and say which depend on which. The board hands each ready task to its **assignee**, the block or worker named to do it. The loop stops when every task is done or nothing left can run.

```ts
import { sequencer } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { researcher, writer } from "./blocks";

const board = taskBoard({
  name: "comparison",
  workers: { researcher, writer },
  initialTasks: [
    { id: "acme", goal: "Find Acme's pricing", assignee: "researcher" },
    { id: "globex", goal: "Find Globex's pricing", assignee: "researcher" },
    { id: "compare", goal: "Compare the two", assignee: "writer", deps: ["acme", "globex"] },
  ],
});

export const compare = sequencer({ name: "compare" }).step(board.drain);
```

`researcher` and `writer` are blocks, registered as the board's assignees under its `workers` option. The board runs `acme` and `globex` side by side, then hands `compare` to the writer with both results in its input. The writer reads them from `input.deps`, keyed by task id.

## Stored tasks and the drain

A board's tasks and the loop that runs them live for different lengths of time.

The **tasks** are data: goal, status, assignee, input and output. By default they last one request. Kept in a collection at session, user or org scope, they last across requests.

The **drain**, `board.drain`, is a block. It does work only while a request is running it. When it returns, nothing processes the board until a request runs the drain again. A board is not a background queue: a task added by another request wakes nothing.

To run work after the request that filed it has ended, start a run that drains the board.

## Who files tasks

In the example above, the code filed every task up front. Often a model does it instead. Give a generator the task tools and it can plan on the board as it goes:

- `createTask` files a task, with a goal, an assignee and its dependencies.
- `listTasks` and `getTask` read the board.
- `updateTask` changes a task before it starts, sends a message to one that is running, or cancels one.

No tool marks a task done: a task ends when its assignee returns or throws. Once a task starts, what it was asked to do is fixed. You can send it a message or cancel it.

## How a task is claimed

<Figure svg={TaskLifeDrawing} caption="The life of a task" description={"A task is filed pending. It can be filed held instead, and stays held until someone releases it. A pending task is claimed once its dependencies have completed and nothing holds it, and becomes in progress. An in-progress task ends in one of three ways: completed when its assignee returns, errored when its assignee throws with no attempts left, cancelled when someone cancels it or a task it depends on ends without completing. A throw with attempts left sends it back to pending. A task waits without changing status on its dependencies, on a person answering a question, or on an event such as a pull request merging. If the process running it dies, its claim runs out and the task is claimed again. A retry puts an errored or cancelled task back to pending as the same task."} />

A task is claimed by one assignee at a time. A `pending` task is claimed only when every task it depends on has completed and nothing is holding it. Among the ready tasks, the board takes them in the order they were filed, or by priority if you ask for that.

If the process running a task dies, its claim runs out after about two minutes and the task is claimed again as a fresh attempt. A task abandoned this way three times ends `errored`.

The board runs up to four tasks at once unless you set `concurrency`.

## How a task runs

The board routes each task by its `assignee`. On the board above, `assignee: "researcher"` names a key in `workers`, and the board runs that block with the task as its input. That is a **plan** board: every task runs inside the drain, and the drain waits for each one.

A board can also hand every task to another session and wait on none of them. That is how a coordinator works in the [workforce kit](./workers): its conversation keeps a board, and each task is assigned to one of your workers by id. The task runs in a session of that worker, one run per task, and the conversation hears the result when it ends.

## How a task waits

Waiting is not failing: a task can wait on any of these without ending.

**Other tasks.** A task whose dependencies haven't completed stays `pending`. If a dependency fails for good or is cancelled, every task that depends on it is cancelled too, and each one names the task that caused it.

**A person.** An assignee that can't go on without an answer asks for one. The task keeps its place, and nothing else claims it while the question is open. The answer can come from your app's inbox screen, from a line the user types in the task's session, or from whoever filed the task. Once the answer arrives, the task gets one more turn on the same attempt, starting from its brief and the answer.

A task can be filed **held**, too: it doesn't start until someone releases it.

**An event.** A coding task can wait for its pull request to merge. The task stays open and the board moves on to other work.

The filer can wait too: `getTask` with `wait: true` pauses its turn until the task ends or a deadline passes. Otherwise the ending reaches its session as a notice.

## How a task ends

Each ending is final:

- `completed`: its assignee returned. Its output never changes.
- `errored`: its assignee threw and the task has no attempts left. Set `maxAttempts` on a task to give it more. Each retry gets the previous error as feedback.
- `cancelled`: someone cancelled it, or a task it depended on ended without completing.

A completed task doesn't reopen. To correct or extend one, file a follow-up that names it. An errored or cancelled task can be retried, which puts it back to `pending` as the same task, keeping its id and what it has done so far.

When the drain stops, its last item says why, so your app can tell a finished board from a stuck one:

| Reason | What it means |
| --- | --- |
| `all-completed` | Every task completed. |
| `blocked-by-failures` | Something failed or is held, and nothing left can run without it. |
| `waiting-on-a-user` | The remaining work waits on a person's answer. |
| `waiting-on-an-event` | The remaining work waits on something outside the board. |
| `dispatched` | Every remaining task is running in another session. |
| `retry-budget-exhausted` | The board's limit on retries across all its tasks was reached. |

A board stopped on `waiting-on-a-user` has done everything it can until someone answers.

## What a board won't do

- It doesn't run on its own. Work happens only inside a request that runs the drain.
- It doesn't record two results for one attempt. Only the assignee holding the claim can settle a task; a late result from one that lost it is dropped.
- It doesn't choose an assignee. The filer names one. A task naming an assignee the board doesn't know fails, unless you gave the board a `defaultWorker` to run it.

## Next

- [Workers](./workers): the named workers your users talk to, and how a task assigned to one reaches it.
- [Background work](./background-work): running a board after the request that started it has ended.
- The task reference lists every status move and every refusal.
