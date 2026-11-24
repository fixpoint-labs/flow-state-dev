---
title: Delegating work
type: catalog
description: A worker files tasks for the workers that work for it, each done in a session of its own, and hears how each ended.
---

import Figure from "@site/src/components/Figure";
import TaskHandedDown from "./figures/task-handed-down.svg";

# Delegating work

Some requests are too big for the worker you are talking to. A lead that gets "fix the login redirect" should not make the change itself and go quiet for ten minutes. It should hand the change to a coder, keep talking to you, and be told when the coder is done.

Delegation is how a worker does that. A worker is a named agent defined in a Markdown file, and your roster is the workers you have. A worker's **delegates** are the roster workers it may hand work to, listed in its file. It hands work over as a **task**: a request stored on a board, the session's list of tasks. The delegate works the task in a **task session**, a new session of its own, and the worker that filed it hears how it ended.

The list is the whole rule. A worker can hand work only to its delegates, so a task never lands on a worker you did not put there.

<Figure svg={TaskHandedDown} caption="A task handed down and reported back" description={"Three boxes in a row, then a fourth below. On the left, the worker desk.lead calls createTask with the goal Fix the login redirect, for desk.coder. An arrow, numbered 01, runs to the middle box, the board, hatched because it outlives the request, which holds the task with status in_progress. An arrow, numbered 02, runs to the right box, a task session for desk.coder, also hatched, which is a new session of its own that sees the task's brief. Below the lead, a highlighted box, the result in the lead's conversation, reads Task Fix the login redirect completed by desk.coder, Fixed, tests pass. An arrow numbered 03 runs from the task session to that box. Notes say the lead files the task for a worker on its delegates list, that it starts at once, and that the lead hears the ending once, in a line under the coder's name."} />

## What you get

- **A closed list of who gets work.** A task for anyone else is refused, and nothing is stored.
- **The coder works elsewhere.** `createTask` answers as soon as the task is stored, and the coder works it in a session of its own. The lead stays free to talk to you.
- **The lead is told once.** When the task ends, a line in the lead's session says how, under the coder's name.
- **A board your app can read.** Every task is a row a browser can list.

## Install it

Delegation comes with the [workforce kit](./index.md). The built-in worker flow and the coordinator flow both carry the task tools, so a worker on either needs only a `delegates:` line.

## Use it

### Filing a task

List the delegates in the worker's `WORKER.md`. A worker's id is `<team>.<name>`, so `desk.coder` is the worker in `teams/desk/workers/coder/`.

```md title="workforce/teams/desk/workers/lead/WORKER.md"
---
description: Hands each request to a coder and keeps you posted.
delegates: [desk.researcher, desk.coder]
---

Split a request into pieces and file one task per piece with createTask. A piece that
changes code goes to desk.coder. Everything else goes to desk.researcher.

A delegate sees only its goal, so write each goal so it can be done with nothing else.
```

No setting turns filing on. A worker gets the task tools when at least one of its delegates takes tasks, which every worker on the built-in flows does. The [WORKER.md reference](../../reference/worker-md.md) has the rules for `delegates:`, including `all` and the roster.

The lead's model files a task with `createTask`:

```json title="A createTask call"
{ "title": "Fix the login redirect", "goal": "In the shop app, /login sends signed-in users to /. Send them to /orders.", "assignee": "desk.coder" }
```

It answers `{ "ok": true, "taskId": "…" }` once the task is stored, and the coder starts at once. Your app files tasks the same way through the `createTask_tasks` action. The [task board reference](../../reference/task-board.md) lists the default assignee, the other fields and the refusals.

A delegate must be on your own roster. Another user's worker gets the same `unknown_assignee` refusal as a worker that does not exist, so a lead can never file for someone else's coder. The task tools act as the signed-in user and refuse another user's call, so you only ever see tasks your own conversations filed.

### Splitting a task

A worker given a task can split it. `desk.coder` might file a piece for each of its own delegates, onto the task session's own board. A piece for any other worker is refused with `unknown_assignee`. When the job needs a worker that is not a delegate, the worker says so in its answer, and whoever filed the task decides.

The task stays in progress while its pieces run, and is not handed out again. Each piece's ending, a failure included, wakes the worker for a turn in the task session, where it reads the result and decides: file the piece again to the same or another delegate, or answer with what it has. The task completes once no piece is open and the worker has had a turn on every piece's ending. Its output is the latest `reportProgress` checkpoint or, with none, the answer from the last woken turn. The [task board reference](../../reference/task-board.md) has the completion rules and the limits on how deep and how large a chain may grow. Each task is a session and at least one model turn, so a worker that splits at every level gets expensive fast.

A piece that fails for good does not fail the task. Only a turn that throws fails the attempt, so a worker that ignores a failed piece completes its task anyway. Tell it what to do. The lead hears only that the coder's task ended, not each piece.

Run delegating workers on a [durable host](../../reference/durable-execution.md), which wakes a split task whose piece ended as the server stopped.

### Seeing what came back

The session that filed a task hears it end once, in a line under the delegate's name:

```text
Task "Fix the login redirect" (task_…) completed by desk.coder: Fixed, tests pass.
```

It hears when a task completes, fails for good, or stops on a question. It also hears a cancel, except one the filer's own model made through a task tool, since that call already answered. If the lead's model waited on the task with `getTask({ id, wait: true })`, no line arrives, because the `getTask` call returns the result. The [task board reference](../../reference/task-board.md) lists which endings raise the line.

Your app reads one session's board through `listTasks_tasks` and `getTask_tasks`. To show every task a user has filed, read the `tasks` collection on any of their sessions, on a flow that keeps boards, such as the built-in worker and coordinator flows. One read covers every session they filed from, and never returns another user's rows. Each row's `topic` starts with a segment naming the session that filed it, and `sessionIdOfFiling` turns that into the session id:

```ts title="src/lib/tasks-by-session.ts"
import { createClient, readEveryCollectionPage } from "@flow-state-dev/client";
import { sessionIdOfFiling } from "@flow-state-dev/workforce/browser";

export async function tasksBySession(userId: string, anySessionId: string) {
  const fsd = createClient({ userId, baseUrl: "" });
  const rows = await readEveryCollectionPage(fsd.resources, anySessionId, "tasks", { limit: 200 });
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

Each row's `clientData` carries `title`, `status` and `assignee`, among others. One session's tasks are also a view, `listTasks_tasks`, which a screen watches like any other [view](../../concepts/views.md). The [task board reference](../../reference/task-board.md) lists the row's fields.

## Change it

Each session starts with the `delegates:` list from its worker's `WORKER.md`. Your app changes that session's list with the `addDelegate` and `removeDelegate` actions, and the [Workforce reference](../../reference/workforce.md) lists what they take. A task filed before a removal runs to its end, and its ending is heard. Once no delegate that takes tasks is left, the app's `createTask_tasks` answers `{ "ok": false, "error": "no_delegation_board" }`. Add one back and it is available on the next call. To allow more tasks under one top task than the default, set `taskChainLimit` on the kit, as the same reference describes.

## Next

- [Coordinators](./coordinators.md), the workers that pass each of your messages to a delegate as a task.
- [Messaging between workers](./messaging.md), for asking another worker something without handing it work.
- [Tasks and boards](../../concepts/tasks-and-boards.md), the stored list a task sits on and how its tasks run.
- [The task board reference](../../reference/task-board.md), for statuses, the ending notice and the refusals.
