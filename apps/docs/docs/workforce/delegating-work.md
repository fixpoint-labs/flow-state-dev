---
title: Delegating work
sidebar_position: 3.6
sidebar_label: Delegating work
description: "Any worker can file tasks for the workers on your roster that work for it, and a worker given a task can split it into pieces for its own."
---

# Delegating work

A worker can hand work to other workers on your roster. The workers it hands work to are its **delegates**, and handing work to one is **delegation**. Every hand-over is checked against your roster.

There are two ways to hand something over. A [coordinator](./coordinators.md) passes a question on as a **post**, and the delegate answers it. Work that has to be done, like a change made, a report written or a run that takes an hour, goes as a **task**: the worker files it on a board, for one of its delegates. The delegate works it in a new session of its own, a **task session**, and the worker that filed it hears how it ended.

A worker files tasks when one of its delegates can take a task. There's no switch to flip. Who the worker hands work to decides it.

## Giving a worker the task tools

List the delegates in the worker's `WORKER.md`:

```md title="workforce/teams/eng/workers/em/WORKER.md"
---
description: Leads the feature. Files the work, never does it.
delegates: [eng.coder, eng.reviewer]
---
```

`delegates:` is who works for this worker. A coordinator hands posts to this list, and any worker files tasks for it. Each session starts from the file's list, and you change one session's list with the `addDelegate` and `removeDelegate` actions, described under [Changing the delegates](./coordinators.md#changing-the-delegates). A delegate has to be on the same user's roster.

When at least one of a session's delegates can take a task, the worker gets the [task board](../orchestration/task-board.md)'s task tools in that session: `dispatchTask`, which starts work on a delegate now, and `addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks` and `answerTask`, which keep the board. `addTask` records a task without starting it, until `dispatchTask` names it by its `taskId`. Your app can send the same tools as actions on any of that worker's sessions, named for the board, `tasks`: `dispatchTask_tasks`, `addTask_tasks` and so on.

A worker whose delegates only take posts, like a coordinator that routes questions, gets none of the tools. A worker with no delegates gets none either. On a session of either, the app's actions answer:

```json
{ "ok": false, "error": "no_delegation_board" }
```

Add a delegate that takes tasks partway through a conversation and the tools are there on the next call; remove the last one and they're gone.

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
    model: "openai/gpt-5.4-mini",
    inputSchema: messageInput,
    uses: [board.tools],
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
| `actions` | The flow's `actions`: the task tools as `<tool>_tasks`, plus `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`. |
| `resources` | The flow's `resources`. |
| `sessionStateShape` | `installation.session(...)`. |
| `serverOwned` | The flow's `session.serverOwned`. |
| `entries(turn)` | The flow's `internal: { actions }`. Pass the block that answers a message; it is woken with a line when a task the session filed ends. |
| `files(ctx)` | Read it when you need to know whether the running session files now. |
| `taskDelegates(ctx)` | The session's delegates as a task sees them: `available` (worker id to flow) and `unavailable` (worker id to why). |

Compose `board.tools` once on a block. A block that also gets the task tools another way, such as Orchestration's `createTaskToolsCapability`, has two tools of the same name, and the turn is refused.

A flow that leaves the kit out gives its workers no task tools, whatever their delegates.

## Where the tasks go

Every session of a worker that files keeps its own board: a conversation with you, a session another worker posted to, or a task session. A worker files onto the board of the session it's in, never another's. Two sessions of one worker never see each other's tasks.

A worker that files from a session it was **posted** to still answers the post as usual. The tasks it filed report back to that session, not to whoever posted. If the result has to come back to you, file the work rather than posting it.

How a filed task runs, how the filing session hears it ended, and how to manage it from your app are on the coordinators page, under [Handing out tasks](./coordinators.md#handing-out-tasks). They work the same for every worker.

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

A worker given a task can split it, as long as it has delegates of its own that take tasks. It files the pieces on its own task session's board, for its own delegates, and its task waits until every piece has ended. Then the task completes with what the pieces returned, or fails naming the pieces that failed for good, and the session above hears it.

```text
your conversation ── task ──▶ lead's task session ── pieces ──▶ two task sessions
        ◀── "completed, with both results" ──┘
```

Each piece's ending wakes the worker for a turn before it counts toward the task. When a piece fails for good, that turn can file the work again, for the same delegate or another. A piece filed in that turn is the failed piece's retry: the failure stops counting, and the retry takes its place. The task completes once the retry and every other piece complete. If the retry fails for good too, and the turn its failure woke doesn't file it again, the task fails naming the retry.

Only the turn a failure woke can retry it. A piece filed in any later turn is new work, so a failure the worker left alone still fails the task.

Every session in the chain is yours, and only your own workers appear in it.

## How far it goes

A chain stops at **five boards deep**, counting the board of the session that filed the first task. It also stops at **100 tasks under one top task**, counting every depth together, finished tasks included. A filing past either limit is refused, and nothing is filed:

```json
{ "ok": false, "error": "total_task_cap_exceeded" }
```

Each task is a session and at least one model turn, so a worker that splits at every level gets expensive fast.

If your jobs need more than 100 tasks under one top task, raise the limit when you register the flows:

```ts
const flows = hireWorkforce(installation, { taskChainLimit: 250 });
```

`taskChainLimit` must be a whole number of at least 1, or `hireWorkforce` throws. The depth of five doesn't change.

## Related pages

- [Coordinators](./coordinators.md): a worker that hands each post to its delegates, and how a filed task runs and reports back.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, worker flows and `hireWorkforce`.
- [Task board](../orchestration/task-board.md): the board and the task tools underneath.
