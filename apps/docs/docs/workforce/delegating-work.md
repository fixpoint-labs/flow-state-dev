---
title: Delegating work
sidebar_position: 3.6
sidebar_label: Delegating work
description: "Any worker can file tasks for the workers on your roster that work for it, its delegates, and a worker given a task can split it into pieces for its own delegates."
---

# Delegating work

A worker can hand work to other workers on your roster. The workers it hands work to are its **delegates**, and handing work to one is **delegation**. Every hand-over is checked against your roster.

There are two ways to hand something over. A [coordinator](./coordinators.md) passes a question on as a **post**, and the delegate answers it. Work that has to be done, like a change made, a report written or a run that takes an hour, goes as a **task**: the worker files it on a board, for one of its delegates. The delegate works it in a new session of its own, a **task session**, and the worker that filed it hears how it ended.

A worker files tasks when one of its delegates can take a task. There's no switch to flip. Who the worker hands work to decides it.

To ask another worker something without handing it work, a worker sends a message instead. See [Messaging other workers](./messaging-workers.md#message-or-delegate).

## Giving a worker the task tools

List the delegates in the worker's `WORKER.md`:

```md title="workforce/teams/eng/workers/em/WORKER.md"
---
description: Leads the feature. Files the work, never does it.
delegates: [eng.coder, eng.reviewer]
---
```

`delegates:` is who works for this worker, and the only workers it can give work to. A coordinator hands posts to this list, and any worker dispatches tasks to it. Each session starts from the file's list, and you change one session's list with the `addDelegate` and `removeDelegate` actions, described under [Changing the delegates](./coordinators.md#changing-the-delegates). A delegate has to be on the same user's roster.

The worker itself changes its list only when it is a coordinator whose file sets `managesOwnDelegates: true`. Every worker with a board can read its list with `listDelegates`.

`delegates: all` gives the worker every worker on your roster, itself included:

```md title="workforce/org/workers/router/WORKER.md"
---
description: Hands any job to whoever does it.
delegates: all
---
```

The roster is read on every call, so a worker you hire partway through a conversation can be handed work on the next call, and a worker you fire drops off. Removing one delegate from such a session turns its list into the roster as it stands then, less that worker, and it stops following the roster. Only the worker's file sets `all`; no action or tool switches a list to it. `all` isn't bounded by the 25-delegate limit a written list has.

When at least one of a session's delegates can take a task, the worker gets the [task board](../orchestration/task-board.md)'s task tools in that session: `createTask`, `getTask`, `listTasks` and `updateTask` ([one task, five tools](../orchestration/task-board.md#one-task-five-tools)), `answerTask`, and `dispatchTask`, which starts work on a delegate now. `createTask` with `held: true` files a task that doesn't start until `updateTask` releases it. Your app can send the same tools as actions on any of that worker's sessions, named for the board, `tasks`: `createTask_tasks`, `updateTask_tasks` and so on. They act as the signed-in user, and another user's call to them is refused.

A worker working a task also gets `reportProgress`, which writes a status note and a checkpoint of its output on that task, and `parkOnQuestion`. Neither is an action.

A worker whose delegates only take posts, like a coordinator that routes questions, has no one to hand a task to, and neither does a worker with no delegates. On a session of either, the app's actions answer:

```json
{ "ok": false, "error": "no_delegation_board" }
```

The worker's own turn still gets the tools on the built-in and coordinator flows, for the steps it files for itself: see [Working in steps](#working-in-steps).

A task session follows the same rule: a worker working a task hands pieces only to its own delegates. See [Splitting a task](#splitting-a-task).

Add a delegate that takes tasks partway through a conversation and it can be handed tasks on the next call; remove the last one and the actions answer `no_delegation_board` again.

### On your own worker flow

Workers on the [built-in worker](./built-in-worker.md) flow and the coordinator flow have all of this already. A [worker flow of your own](./workers-on-disk.md#which-flows-can-run-workers) gets it from `defineSessionBoard`, built over your installation and the flow's kind:

```ts
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import { defineSessionBoard, workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";
import { z } from "zod";

const messageInput = z.object({ message: z.string() });

export const emFlow = workerFlow((installation) => {
  const board = defineSessionBoard({ installation, flowKind: "em" });

  const loadWorker = handler({
    name: "em-load-worker",
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      await installation.resolveWorker(ctx, "em");
    },
  });

  const answer = generator({
    name: "em-answer",
    model: "openai/gpt-6-luna",
    inputSchema: messageInput,
    uses: [board.tools, board.messages],
    prompt: "You lead the feature. File the work for your delegates; never do it yourself.",
    user: (input) => input.message,
  });

  return defineFlow({
    kind: "em",
    configSchema: workerConfigSchema(),
    session: {
      ...installation.session(board.sessionStateShape),
      serverOwned: [...board.serverOwned],
    },
    resources: { ...installation.resources, ...board.resources },
    request: { onStarted: loadWorker },
    actions: {
      run: { inputSchema: messageInput, block: answer, userMessage: (input) => input.message },
      ...board.actions,
    },
    internal: { actions: board.entries(answer) },
  });
});
```

Pass it in `workerFlows` like any worker flow: `createWorkerInstallation({ standardWorkers: workers, workerFlows: { em: emFlow } })`.

What the kit gives you, and where each piece goes:

| Field | Put it in |
|-------|-----------|
| `tools` | The `uses` of the block that runs the model. It carries the task tools only while the session files, and nothing otherwise. |
| `messages` | The same `uses`. It carries `messageWorker`, which [messages another worker](./messaging-workers.md). Leave it out and the flow's workers can receive messages but not send them. |
| `actions` | The flow's `actions`: the task tools as `<tool>_tasks`, plus `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`. |
| `progress` | The same `uses`. It carries `reportProgress` on a turn working a task. |
| `delegateTools` | The same `uses`. It carries `listDelegates`, and `addDelegate`, `removeDelegate` and `setFallback` on a worker set to `managesOwnDelegates: true`. |
| `resources` | The flow's `resources`. |
| `sessionStateShape` | `installation.session(...)`. |
| `serverOwned` | The flow's `session.serverOwned`. |
| `planned(turn)` | Wrap the block that answers a message, and use what it returns wherever that block runs as the worker: the `run` action, the task entry's `turn`, and `entries`. The steps the worker files for itself then run in the same request. See [Working in steps](#working-in-steps). Leave it out and the flow's workers file no steps. |
| `entries(turn)` | The flow's `internal: { actions }`. Pass the block that answers a message; it is woken with a line when a task the session filed ends, and when another worker messages this one. |
| `files(ctx)` | Read it when you need to know whether the running session files now. |
| `taskDelegates(ctx)` | The session's delegates as a task sees them: `available` (worker id to flow) and `unavailable` (worker id to why). |

Compose `board.tools` once on a block. A block that also gets the task tools another way, such as Orchestration's `createTaskToolsCapability`, has two tools of the same name, and the turn is refused.

A flow that leaves the kit out gives its workers no task tools, whatever their delegates.

## Working in steps

A worker can plan its own work. A task it files naming **itself** is a **step**: it isn't handed to anyone, and no new session opens for it. When the worker's turn ends, the same request works the steps, one at a time and in order, each as a turn of the worker in the same session. A step sees the conversation so far, the steps before it included, and the results of the steps listed in its `deps`. Then the worker answers once more, told how each step ended, and that answer is what the request returns: your reply in a conversation, or the task's result in a task session.

```json title="Three dispatchTask calls: the steps the worker files for itself"
{ "goal": "Outline the post", "assignee": "eng.writer" }
{ "goal": "Draft the post", "assignee": "eng.writer", "deps": ["<the outline's taskId>"] }
{ "goal": "Tighten the draft", "assignee": "eng.writer", "deps": ["<the draft's taskId>"] }
```

A step can report its progress with `reportProgress`, on its own row: its checkpoint is that step's output. A step can't be held.

A step that fails isn't tried again, and a step waiting on it is cancelled. The worker's last turn hears both, and can do the work itself, explain, or carry on. A request that files no step costs nothing extra. One that does costs a model turn for each step, and one more for the answer.

The worker gets the task tools for its steps on the built-in and coordinator flows even with no delegates. A few rules keep a step the worker's own:

- Only the worker's own turn files one. An action naming the worker, or a filing from anywhere else, is refused.
- A step's own turn files no step for itself. A step that finds more work says so in its answer, and the answer after the steps deals with it.
- A step depends only on other steps, and a delegate's task only on other tasks: a step whose `deps` names a delegate's task, or a delegate's task whose `deps` names a step, is refused when it is filed.
- The turn that answers after the steps can't file another step for itself. It can still hand a task to a delegate.
- A step can't be waited on (`dispatchTask` with `wait`) or held, and no tool call finishes it: it ends when its turn answers. It can be changed with `updateTask` before it starts, or cancelled.
- A step stays the worker's, and a delegate's task stays a delegate's: `updateTask` won't move one into the other. Cancel it and file it again.

The worker's `listTasks` lists the session's steps beside the tasks it dispatched; a step's `assignee` is the worker itself. Steps sit on a ledger of their own, `plan`, which your app reads the same way it reads `tasks` ([Showing a user's boards in your app](#showing-a-users-boards-in-your-app)). On a worker with no delegate that takes tasks, the app's `<tool>_tasks` actions answer `no_delegation_board`, so read the `plan` ledger to show its steps. They count toward [the 100 tasks under one top task](#how-far-it-goes), and add no depth.

## Where the tasks go

Every session of a worker that files keeps its own board: a conversation with you, a session another worker posted to, or a task session. A worker files onto the board of the session it's in, never another's. Two sessions of one worker never see each other's tasks.

A worker that files from a session it was **posted** to still answers the post as usual. The tasks it filed report back to that session, not to whoever posted. If the result has to come back to you, file the work rather than posting it.

How a filed task runs, how the filing session hears it ended, and how to manage it from your app are on the coordinators page, under [Handing out tasks](./coordinators.md#handing-out-tasks). They work the same for every worker.

### Where a task runs, and where its result goes

Code that files on a conversation's board through the collection (`addTask` on the board's ref) can choose two more things per task:

- `session`: `"new"` (the default) runs the task in a task session of its own. `"ongoing"` runs it in the session where that delegate works for this conversation, so it starts from everything that session already knows. A session works one task at a time, so a second task for the same session waits until the first ends.
- `resultTo`: `"filer"` (the default) means the result is for whoever filed the task. `"conversation"` marks a result that belongs to the conversation itself. Such a task runs once: it takes one attempt, any other `maxAttempts` is refused, and so is a wait on it.

Both settings are for a conversation's own board. A worker filing from a task session can't use either, and the filing is refused with `setting_not_from_task_session`. A follow-up always runs in the session of the task it follows, so it takes no `session`.

## Showing a user's boards in your app

A browser reads a user's boards through the `tasks` collection on any of that user's sessions. The session has to be on a flow that keeps boards: the built-in worker flow, the coordinator flow, or your own flow built with `defineSessionBoard`. On any other session the read fails with a 404, `Unknown resource "tasks"`. The read covers the task rows of every session that user has filed from, on any of the three flows above, so you don't need a request per session. It never returns another user's rows.

Pass the first segment of a row's `topic`, URI-decoded, to `sessionIdOfFiling` to get the id of the session that filed the task. `clientData` holds the board's fields: `id`, `title`, `goal`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`, `updatedAt`, `startedAt` and `completedAt`. A task's input, output and metadata are never sent.

```ts
import { createResourceClient, readEveryCollectionPage } from "@flow-state-dev/client";
import { sessionIdOfFiling } from "@flow-state-dev/workforce/browser";

const resources = createResourceClient();

async function tasksBySession(anySessionId: string) {
  const rows = await readEveryCollectionPage(resources, anySessionId, "tasks", { limit: 200 });
  const bySession = new Map<string, unknown[]>();
  for (const row of rows) {
    const filedFrom = sessionIdOfFiling(decodeURIComponent(row.topic.split("/")[0]!));
    const tasks = bySession.get(filedFrom) ?? [];
    tasks.push(row.clientData);
    bySession.set(filedFrom, tasks);
  }
  return bySession;
}
```

The read answers in pages: 50 rows by default, up to 200 if you pass `limit`. `readEveryCollectionPage` follows `nextCursor` to the last page. To page yourself, call `resources.listCollectionItems(sessionId, "tasks", { cursor })` with each page's `nextCursor`.

## Splitting a task

A worker given a task can split it into pieces, for its own delegates. A piece for any other worker is refused with `unknown_assignee`, and nothing is filed: when the task needs a worker that isn't a delegate, the worker says so in its answer, and whoever filed the task decides. A piece filed with no assignee goes to the worker's delegate when it has exactly one. `listTasks({ filedByTask })` lists the pieces one task filed.

The pieces go on the task session's own board. The worker's turn ends, and its task waits, with nothing running, until every piece has ended. Each piece's ending wakes the worker for a turn in the task session, where it reads the result. Once no piece is left open, the task completes with the answer the worker gave in the last of those turns, with the pieces' outputs listed under it:

```json
{
  "answer": "The codename is Bluebird.",
  "pieces": [
    { "taskId": "task_8f2…", "goal": "Ask the archivist for the codename", "assignee": "archivist", "status": "completed", "output": "Bluebird" }
  ]
}
```

If the worker didn't get a turn after the last piece ended (after a server restart, for example), the output is `{ pieces }` with no `answer`, so treat `answer` as optional. A task with a piece that failed for good fails, naming it. Only the session that filed the task hears it end; it doesn't hear each piece.

The pieces live only as long as the attempt that filed them. When a task fails, is retried, or is cancelled, every piece it filed that is still open is cancelled within seconds. A retry doesn't wait on the pieces of the attempt before it.

```text
your conversation ── task ──▶ lead's task session ── pieces ──▶ two task sessions
        ◀── "completed, with lead's answer" ──┘
```

A worker on a task can't wait for a piece inside its turn: `dispatchTask` with `wait` is refused there. It files the piece without `wait` and ends its turn, and the piece's ending wakes it.

When a piece fails for good, the turn its ending woke can dispatch the work again, to the same worker or another. A piece dispatched in that turn is the failed piece's retry: the failure stops counting, and the retry takes its place. The task completes once the retry and every other piece complete. If the retry fails for good too, and the turn its failure woke doesn't dispatch it again, the task fails naming the retry.

Only the turn a failure woke can retry it. A piece dispatched in any later turn is new work, so a failure the worker left alone still fails the task.

Every session in the chain is yours, and only your own workers appear in it.

## How far it goes

A chain stops at **five boards deep**, counting the board of the session that filed the first task. It also stops at **100 tasks under one top task**, counting every depth together, finished tasks included. A filing past either limit is refused, and nothing is filed:

```json
{ "ok": false, "error": "total_task_cap_exceeded" }
```

Each task is a session and at least one model turn, so a worker that splits at every level gets expensive fast. A [step](#working-in-steps) counts toward the 100 too, but it opens no session and adds no depth.

If your jobs need more than 100 tasks under one top task, raise the limit when you register the flows:

```ts
const flows = hireWorkforce(installation, { taskChainLimit: 250 });
```

`taskChainLimit` must be a whole number of at least 1, or `hireWorkforce` throws. The depth of five doesn't change.

## Related pages

- [Coordinators](./coordinators.md): a worker that hands each post to its delegates, and how a filed task runs and reports back.
- [Messaging other workers](./messaging-workers.md): asking another worker something without filing a task.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, worker flows and `hireWorkforce`.
- [Task board](../orchestration/task-board.md): the board and the task tools underneath.
