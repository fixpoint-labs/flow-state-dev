---
title: Delegating work
sidebar_position: 3.6
sidebar_label: Delegating work
description: "Any worker can file tasks for the workers on your roster that work for it, its delegates, and a worker given a task can split it into pieces for its own delegates."
---

# Delegating work

A worker can hand work to other workers on your roster. The workers it hands work to are its **delegates**, and handing work to one is **delegation**. Every hand-over is checked against your roster.

Every hand-over is a **task**: the worker files it on a board, for one of its delegates. Work that has to be done, like a change made, a report written or a run that takes an hour, goes as a task the delegate works in a new session of its own, a **task session**, and the worker that filed it hears how it ended. A [coordinator](./coordinators.md) passes your message on as a **routed task**: a task the delegate works in its one session for your conversation, whose answer lands in that conversation under the delegate's name.

A worker files tasks when one of its delegates can take a task. There's no switch to flip. Who the worker hands work to decides it.

To ask another worker something without handing it work, a worker sends a message instead. See [Messaging other workers](./messaging-workers.md#message-consult-or-delegate).

## Giving a worker the task tools

List the delegates in the worker's `WORKER.md`:

```md title="workforce/teams/eng/workers/em/WORKER.md"
---
description: Leads the feature. Files the work, never does it.
delegates: [eng.coder, eng.reviewer]
---
```

`delegates:` is who works for this worker, and the only workers it can give work to. A coordinator hands your messages to this list as routed tasks, and any worker dispatches tasks to it. Each session starts from the file's list, and you change one session's list with the `addDelegate` and `removeDelegate` actions, described under [Changing the delegates](./coordinators.md#changing-the-delegates). A delegate has to be on the same user's roster.

The worker itself changes its list only when it is a coordinator whose file sets `editsOwnDelegates: true`. Every worker with a board can read its list with `listDelegates`.

`delegates: all` gives the worker every worker on your roster, itself included:

```md title="workforce/org/workers/router/WORKER.md"
---
description: Hands any job to whoever does it.
delegates: all
---
```

The roster is read on every call, so a worker you hire partway through a conversation can be handed work on the next call, and a worker you fire drops off. Removing one delegate from such a session turns its list into the roster as it stands then, less that worker, and it stops following the roster. Only the worker's file sets `all`; no action or tool switches a list to it. `all` isn't bounded by the 25-delegate limit a written list has.

When at least one of a session's delegates can take a task, the worker gets the [task board](../orchestration/task-board.md)'s task tools in that session: `createTask`, `getTask`, `listTasks` and `updateTask` ([one task, five tools](../orchestration/task-board.md#one-task-five-tools)). `createTask` starts work on a delegate now. With `held: true` it files a task that doesn't start until `updateTask` releases it. With `questions` it files one that doesn't start until the user has answered them from their Inbox, and the answers join the delegate's brief; see [a task's questions](../orchestration/task-board.md#a-tasks-questions). Your app can send the same tools as actions on any of that worker's sessions, named for the board, `tasks`: `createTask_tasks`, `updateTask_tasks` and so on. They act as the signed-in user, and another user's call to them is refused.

A worker working a task also gets `reportProgress`, which writes a status note and a checkpoint of its output on that task, `askQuestion`, which asks the user a question the task then waits on, and `waitForUser`, which stops its turn for the user's approval or review. None is an action.

A worker with no delegate that takes tasks has no one to hand a task to. On a session of one, the app's actions answer:

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
      respond: { inputSchema: messageInput, block: answer, userMessage: (input) => input.message },
      ...board.actions,
    },
    internal: { actions: board.entries(answer) },
  });
}, { roles: ["manager"] });
```

`roles: ["manager"]` declares that the flow files tasks. When you register it, `hireWorkforce` checks that the board's `dispatch` and `onTaskSettled` are among its internal entries, and refuses the flow, naming what's missing, if they aren't. A flow that also takes tasks adds `"contributor"` and a `work` entry from `workerTaskEntry`. See [A worker flow's roles](./workers-on-disk.md#a-worker-flows-roles).

Pass it in `workerFlows` like any worker flow: `createWorkerInstallation({ standardWorkers: workers, workerFlows: { em: emFlow } })`.

What the factory gives you, and where each piece goes:

| Field | Put it in |
|-------|-----------|
| `tools` | The `uses` of the block that runs the model. It carries the task tools only while the session files, and nothing otherwise. |
| `messages` | The same `uses`. It carries `sendMessage`, which [messages another worker](./messaging-workers.md). Leave it out and the flow's workers can receive messages but not send them. |
| `actions` | The flow's `actions`: the task tools as `<tool>_tasks`, plus `addDelegate`, `removeDelegate`, `setFallback` and `listDelegates`. |
| `progress` | The same `uses`. It carries `reportProgress` on a turn working a task. |
| `delegateTools` | The same `uses`. It carries `listDelegates`, and `addDelegate`, `removeDelegate` and `setFallback` on a worker set to `editsOwnDelegates: true`. |
| `resources` | The flow's `resources`. |
| `sessionStateShape` | `installation.session(...)`. |
| `serverOwned` | The flow's `session.serverOwned`. |
| `planned(turn)` | Wrap the block that answers a message, and use what it returns wherever that block runs as the worker: the `respond` action, the task entry's `turn`, and `entries`. The steps the worker files for itself then run in the same request. See [Working in steps](#working-in-steps). Leave it out and the flow's workers file no steps. |
| `entries(turn)` | The flow's `internal: { actions }`. Pass the block that answers a message; it is woken with a line when a task the session filed ends, and when another worker messages this one. The entries include `dispatch`, which runs the session's board one pass at a time, `onTaskSettled`, where each of those endings arrives, and `onMessageReceived`, where another worker's message arrives. |
| `files(ctx)` | Read it when you need to know whether the running session files now. |
| `taskDelegates(ctx)` | The session's delegates as a task sees them: `available` (worker id to flow) and `unavailable` (worker id to why). |

Compose `board.tools` once on a block. A block that also gets the task tools another way, such as Orchestration's `createTaskToolsCapability`, has two tools of the same name, and the turn is refused.

A flow that leaves the factory out gives its workers no task tools, whatever their delegates.

## Working in steps

A worker can plan its own work. A task it files naming **itself** is a **step**: it isn't handed to anyone, and no new session opens for it. When the worker's turn ends, the same request works the steps, one at a time and in order, each as a turn of the worker in the same session. A step sees the conversation so far, the steps before it included, and the results of the steps listed in its `deps`. Then the worker answers once more, told how each step ended, and that answer is what the request returns: your reply in a conversation, or the task's result in a task session.

```json title="Three createTask calls: the steps the worker files for itself"
{ "goal": "Outline the post", "assignee": "eng.writer" }
{ "goal": "Draft the post", "assignee": "eng.writer", "deps": ["<the outline's taskId>"] }
{ "goal": "Tighten the draft", "assignee": "eng.writer", "deps": ["<the draft's taskId>"] }
```

A step can report its progress with `reportProgress`, on its own row: its checkpoint is that step's output. A step can't be held, or filed with questions.

A step that needs a fresh start runs in a session of its own: file it with `session: "new"`. When the request reaches it, the step is handed to a new session of the same worker. The request waits for the step to end, however many [deadlines](../orchestration/task-board.md#waiting-on-a-task) that takes, before it starts the steps that depend on it. No completion notice is sent for the step. The steps after it see its result, as they see any step's. A step filed with no `session` runs here, in this session. A step in its own session counts toward [how far it goes](#how-far-it-goes) one board deeper, as a task for a delegate does. It needs the worker's flow to take tasks through its own `work` entry, as the built-in flows do; elsewhere the filing is refused with `step_session_new_unsupported`.

```json title="A step in a session of its own"
{ "goal": "Fact-check the draft", "assignee": "eng.writer", "session": "new", "deps": ["<the draft's taskId>"] }
```

A step that fails isn't tried again, and a step waiting on it is cancelled. The worker's last turn hears both, and can do the work itself, explain, or carry on. A request that files no step costs nothing extra. One that does costs a model turn for each step, and one more for the answer.

The worker gets the task tools for its steps on the built-in and coordinator flows even with no delegates. A few rules keep a step the worker's own:

- Only the worker's own turn files one. An action naming the worker, or a filing from anywhere else, is refused.
- A step's own turn files no step for itself. A step that finds more work says so in its answer, and the answer after the steps deals with it.
- A step depends only on other steps, and a delegate's task only on other tasks: a step whose `deps` names a delegate's task, or a delegate's task whose `deps` names a step, is refused when it is filed.
- The turn that answers after the steps can't file another step for itself. It can still hand a task to a delegate.
- A step can't be waited on (`getTask` with `wait` is refused `step_cannot_wait`: it runs after the turn, in its request) or held, and no tool call finishes it: it ends when its turn answers. It can be changed with `updateTask` before it starts, or cancelled.
- A step runs here or in a session of its own: `session: "ongoing"` is refused with `step_session_ongoing`.
- A step stays the worker's, and a delegate's task stays a delegate's: `updateTask` won't move one into the other. Cancel it and file it again.

The worker's `listTasks` lists the session's steps beside the tasks it dispatched; a step's `assignee` is the worker itself. Steps sit on a ledger of their own, `plan`, which your app reads the same way it reads `tasks` ([Showing a user's boards in your app](#showing-a-users-boards-in-your-app)). On a worker with no delegate that takes tasks, the app's `<tool>_tasks` actions answer `no_delegation_board`, so read the `plan` ledger to show its steps. They count toward [the 100 tasks under one top task](#how-far-it-goes), and add no depth.

## Where the tasks go

Every session of a worker that files keeps its own board: a conversation with you, the session a coordinator routes your messages to, or a task session. A worker files onto the board of the session it's in, never another's. Two sessions of one worker never see each other's tasks.

A delegate that files work from the session a coordinator routed your message to answers that message once the work has ended, from the turn that hears it end, so its answer can carry what the work came back with. The tasks it filed report back to that session; its answer is what lands in your conversation with the coordinator.

### Where a task runs, and where its result goes

Code that files on a conversation's board through the collection (`createTask` on the board's ref) can choose two more things per task:

- `session`: `"new"` (the default) runs the task in a task session of its own. `"ongoing"` runs it in the session where that delegate works for this conversation, so it starts from everything that session already knows. A session works one task at a time, so a second task for the same session waits until the first ends.
- `resultTo`: `"filer"` (the default) means the result is for whoever filed the task. `"conversation"` marks a result that belongs to the conversation itself. Such a task runs once: it takes one attempt, any other `maxAttempts` is refused, and so is a wait on it.

Both settings are for a conversation's own board. A worker filing from a task session can't use either, and the filing is refused with `setting_not_from_task_session`. A follow-up always runs in the session of the task it follows, so it takes no `session`.

## Following a filed task

Once a task is filed, the session that filed it hears how it ends, and your app can read it, change it before it starts, answer its questions, steer it and follow it up. The examples send the board's tools as actions on the filing session, here a conversation with a coordinator. They use the `fsd`, `workforce`, `session` and `help` set up in [Talking to it](./coordinators.md#talking-to-it): `help` is `fsd.flow(session.flowKind)`, sent on the filing session. Filing, and what a filing is refused for, are under [Handing out tasks](./coordinators.md#handing-out-tasks).

### Hearing how it went

The conversation that filed a task hears once when it ends, in a line under the delegate's name:

```text
Task "Audit our dependencies' licenses" (task_…) completed by licenses: All 214 dependencies are MIT or Apache-2.0.
```

It hears when a task completes, with what came back; when it fails for good, with the error; when it stops on a question, with the question; and when it's cancelled, unless the filing worker cancelled it with its own `updateTask` tool. A cancel your app sends through `updateTask_tasks` is heard like any other ending. A failure or a cancel that took dependent tasks with it names them in the same line, and they send no line of their own. When the line arrives, a coordinator that routes by `judgment` or `best-fit` takes a turn to read it and decide what to do next, such as filing a failed task again. Its model reads the ending as a `getTask` call for that task and its result, not as the line: the task whole, as `getTask_tasks` returns it, with `cancelled` naming any dependents it took with it. One that routes by `round-robin` or `everyone` has no turn of its own, so it shows the line and nothing more. If the coordinator is in the middle of a reply to you, the line starts a second turn at once, and both replies appear in the conversation, each as its own message. Every task gets two attempts, a number you can't change, and a first failure just runs it again without a word. A task whose result goes to the conversation, such as a routed task or its follow-up, gets one.

The filing session hears each ending once, even if the server stops just after the task ends. On a host with durable execution, an ending whose notice didn't go out is heard within seconds, without anyone opening the conversation: about two seconds after the ending, or as soon as the server is running again. See [Hearing how a task ended](../orchestration/task-board.md#hearing-how-a-task-ended) for the guarantee and what it needs from the host.

### Managing tasks

| Action | What it does |
| --- | --- |
| `listTasks_tasks` | This session's tasks only, even when another session has the same worker and the same delegates |
| `getTask_tasks` | One task whole: its brief, its fields, how it stands, its delegate's status note, and its output |
| `createTask_tasks` | Files a task: it starts at once, after its `deps`, or, with `held: true`, when you release it |
| `updateTask_tasks` | Before the task starts: changes any of its fields, its delegate included, holds it (`status: "held"`) or releases it (`status: "pending"`). Until it finishes: sends it a `message`, or cancels it (`status: "cancelled"`), with nothing said in the conversation |

A task that has started can't be changed, only steered with a message or cancelled: `updateTask_tasks` answers `field_locked_after_start`, naming the fields. A running task keeps its delegate; to move it, cancel it and file it again. Cancelling a running task takes effect: when its delegate finishes, the result is turned away. A finished task, a failed one included, changes no more, and `updateTask_tasks` answers `task_finished`. To have someone take on a failed task, file it again (`createTask_tasks`).

To open the session working a task, look it up by the task's id and the conversation's `filingSessionId`, which `listDelegates` returns:

```ts
const run = await workforce.findWorkerSession({ worker: "licenses", taskId, filingSessionId });
```

Two conversations can file a task with the same id for the same worker, and each finds only its own task's session. A lookup without `taskId` never returns a task session, so a message routed to the same worker in this conversation still lands in the session where that delegate works your messages. `ensureWorkerSession` with a `taskId` never creates a session: until the board hands the task over, it throws.

### When a task stops on a question

A delegate working a task sometimes can't go on without you: which region, which account, whether it may delete something. It asks you instead of guessing, with its `askQuestion` tool. The task waits on the question, nothing runs while it waits, and the question shows in your Inbox.

Answer it from the Inbox, or by typing the answer in the task's session: a line there answers the task's oldest open question. An app answers with the board's `updateTask` action, naming the question (`getTask_tasks` lists it under `questions`):

```ts
await help.send(
  "updateTask_tasks",
  { id: taskId, answers: questionId, message: "Use eu-west." },
  { sessionId: session.id },
)
```

The worker that filed the task, here the coordinator, can answer a question its delegate asked midway, with its `updateTask` tool; it hears the question [as a message](./messaging-workers.md#when-a-task-asks-a-question). It answers a question only when the task runs in a session of its own. When the task runs in the delegate's ongoing session, you answer it. The first answer wins; a later one is kept as an ordinary message to the task. The task takes one more turn in its own task session, the one that asked, on the same attempt, with everything it did before and your answer. When it finishes, the conversation hears that.

An answer doesn't use up the task's retries, and the task can ask again. It has started, so it can't be reassigned. A question waits for as long as it takes, unless your host sets a deadline for the user's answer; cancel the task if nobody will answer. A delegate can also stop for your approval or your review of its work, with its `waitForUser` tool; that shows in your Inbox as well, and only you answer it there. See [A task waiting on a user](../orchestration/task-board.md#a-task-waiting-on-a-user).

### Steering a task while it runs

Changed your mind, or forgot a detail? Send the task a message. It's kept on the task and reaches its delegate's work without starting over or using a retry:

```ts
await help.send(
  "updateTask_tasks",
  { id: taskId, message: "Also flag anything under AGPL." },
  { sessionId: session.id },
)
```

A task that hasn't started gets every message in its brief. A running one takes it before its delegate's next model call. A task waiting on work it handed on gets a turn with the message right away. And a message that lands just after the delegate's last model call gets one more turn before the task finishes. The conversation hears one ending, after that turn. See [Sending a message to an open task](../orchestration/task-board.md#sending-a-message-to-an-open-task) for the rules.

Typing in the task's own session does the same. For a worker on the built-in `agent` flow, or a coding worker built on a [harness manager](../orchestration/harness-manager.md#talking-to-a-run), a line there while the task is unfinished is a message to the task, and no separate reply runs:

```ts
const run = await workforce.findWorkerSession({ worker: "licenses", taskId, filingSessionId })
await fsd.flow(run.flowKind).send("respond", { message: "Also flag anything under AGPL." }, { sessionId: run.id })
// output: { steered: <the task's id> }
```

### After a task finishes

A finished task's session stays open, and the task stays as it ended. A line in that session is an ordinary turn: the worker answers from everything the session holds, and the task, its output and its retries don't change. A worker flow you build yourself handles the line however its `respond` action does.

A finished task takes no message: `updateTask_tasks` answers `task_finished`. To correct or build on the work, file a follow-up task that names it:

```ts
await help.send(
  "createTask_tasks",
  { goal: "Now write it up for the team", followUpOf: taskId },
  { sessionId: session.id },
)
```

The follow-up is a new task with its own id, and the conversation hears how it ends. It runs in the same session as the task it follows, with the same worker, so it starts from everything that session already knows. A routed task's follow-up runs where the routed task ran: the delegate's session for this conversation, or the workstream's session. Its answer lands the way the routed task's did, as the delegate's line. If that session is gone, the follow-up fails and the conversation hears it. Once it completes, `getTask_tasks` on the original shows the follow-up's output as `current`, beside the original's own output, which never changes. It keeps that worker: it can't be reassigned. You can file it while the task it follows is still running. A session works one task at a time, so the follow-up waits, unstarted, until that task ends, and then runs. `createTask` refuses the follow-up, filing nothing, if the task it names never ran with a worker, or if you pass an `assignee`, a `session`, a `target` or a `resultTo`:

```json
{ "ok": false, "error": "follow_up_of_unrun: task \"task_…\" never ran with a worker, so there is no session to follow up in. Nothing was filed." }
```

## Showing a user's boards in your app

A browser reads a user's boards through the `tasks` collection on any of that user's sessions. The session has to be on a flow that keeps boards: the built-in worker flow, the coordinator flow, or your own flow built with `defineSessionBoard`. On any other session the read fails with a 404, `Unknown resource "tasks"`. The read covers the task rows of every session that user has filed from, on any of the three flows above, so you don't need a request per session. It never returns another user's rows.

Pass the first segment of a row's `topic`, URI-decoded, to `sessionIdOfFiling` to get the id of the session that filed the task. `clientData` holds the board's fields: `id`, `title`, `goal`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`, `updatedAt`, `startedAt` and `completedAt`. A task's input, output and metadata are never sent.

```ts
import { createClient, readEveryCollectionPage } from "@flow-state-dev/client";
import { sessionIdOfFiling } from "@flow-state-dev/workforce/browser";

const fsd = createClient({ userId, baseUrl: "" });

async function tasksBySession(anySessionId: string) {
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

The read answers in pages: 50 rows by default, up to 200 if you pass `limit`. `readEveryCollectionPage` follows `nextCursor` to the last page. To page yourself, call `resources.listCollectionItems(sessionId, "tasks", { cursor })` with each page's `nextCursor`.

## Splitting a task

A worker given a task can split it into pieces for its own delegates. A piece for any other worker is refused with `unknown_assignee`, and nothing is filed. When the task needs a worker that isn't a delegate, the worker should say so in its answer, and whoever filed the task decides. A piece filed with no assignee goes to the worker's delegate when it has exactly one.

The pieces go on the task session's own board. The worker either waits on a piece in the same turn, with `getTask({ id, wait: true })`, or files them and ends its turn. Waits nest up to five deep, so a task's turn can wait on a piece whose own turn waits on another. When the turn ends instead, nothing runs for the task while the pieces are worked, but the task stays `in_progress`, with `keptOpenBy: "filed"` on its row, and it isn't handed out again while it waits. See [When a dispatched task is done](../orchestration/task-board.md#when-a-dispatched-task-is-done) for the rule every dispatched task follows.

Each piece's ending wakes the worker for a turn in the task session, where it reads the result and decides what it means. A turn can file more pieces, and the task waits on those too. A message to the worker in its task session doesn't hold the task and isn't part of it. While the task's turn is running, the worker hears it after that turn; while the task waits on its pieces, it may hear and answer it before the task is done. Either way its turn on the message can't write to the task, and a failure in it doesn't fail the task.

The task completes once no piece is open and the worker has had a turn on every piece's ending. Its output follows the same rule as any task's: the latest checkpoint the worker reported with `reportProgress`, or, with none, the answer from the last turn a piece's ending woke. A message's answer is never the output.

```text
your conversation ── task ──▶ lead's task session ── pieces ──▶ two task sessions
        ◀── "completed, with lead's answer" ──┘
```

To carry a piece's result into the task's output, have the worker put it in its answer, or read the piece's own row: `listTasks({ filedByTask })` lists the pieces one task filed, and `getTask` reads one.

A piece that fails for good doesn't fail the task by itself. Its ending wakes the worker like any other, and the worker's turn decides: file the work again, to the same delegate or another, or answer with what it has. If that turn throws, the task's attempt fails. A worker that ignores a failed piece completes its task anyway, so tell your workers what to do when a piece fails. Only the session that filed the task hears it end; it doesn't hear each piece.

The pieces belong to the attempt that filed them. When a task fails, is retried, or is cancelled, every piece it filed that is still open is cancelled within seconds. A retry doesn't wait on the pieces of the attempt before it.

Run delegating workforces on a host with [durable execution](../advanced/durable-execution.md#wakes). If the server stops after a piece ends but before its notice reaches the task session, a durable host delivers the notice once it is running again. A host without durable execution doesn't, and the split task stays `in_progress` with nothing left to wake it.

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

## Recurring work

Work that comes round on a schedule, like refreshing the adoption numbers every Monday, is a schedule in the user's schedule collection. Each time it is due, it files an ordinary task on the board of the worker it names, in the user's own conversation with that worker, as the user. The task runs, retries, reports and cancels like any task filed there, and the worker hears it end. No model turn decides what to file: the schedule says what lands.

Save one through the roster flow's `saveSchedule` action, on the user's roster session (`workforce-roster`), through the client's handle on that flow:

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({ userId, baseUrl });
// rosterSessionId: a session of workforce-roster that the user owns, the one
// your app already reads their roster through.
await fsd.flow("workforce-roster").send(
  "saveSchedule",
  {
    key: "adoption-numbers",
    cron: "0 9 * * 1",
    timezone: "Europe/London",
    input: {
      filer: "launch", // whose board the task lands on
      goal: "Refresh the adoption numbers",
      assignee: "researcher", // one of launch's delegates
    },
  },
  { sessionId: rosterSessionId },
);
```

`input` takes the task's `goal`, and optionally `assignee`, `title`, `priority`, `input` and `metadata`. With no `assignee`, the task goes to the filer's delegate when it has exactly one. Saving an existing `key` replaces it, and `enabled: false` keeps the schedule without firing it. The cron must be exactly five fields (minute hour day-of-month month day-of-week), and the time zone a known IANA zone. Anything else is refused, and nothing is saved:

```json
{ "ok": false, "error": "invalid_schedule: cron \"every monday\" in UTC doesn't parse. …" }
```

`deleteSchedule({ key })` removes one, with the record of the times it fired, so a schedule saved again under the same key starts fresh. `listSchedules({})` returns the user's schedules, each with `nextRunAt`, when it is next due, worked out from its cron and time zone as the list is read:

```json
{
  "schedules": [
    {
      "key": "adoption-numbers",
      "cron": "0 9 * * 1",
      "timezone": "Europe/London",
      "kind": "task",
      "enabled": true,
      "input": { "filer": "launch", "goal": "Refresh the adoption numbers", "assignee": "researcher" },
      "nextRunAt": "2026-10-26T09:00:00.000Z"
    }
  ]
}
```

`nextRunAt` says when the schedule is due, not that your host will fire it: on a host whose cron isn't running it still shows a time. It is `null` for a schedule that is off, and for a row whose cron doesn't parse.

### Firing them

Add `createScheduledTransportAdapter()` from `@flow-state-dev/scheduled` to the host's `adapters`. A schedule fires when your scheduler POSTs its dispatch endpoint on the roster flow, `/api/flows/workforce-roster/schedules/<id>/dispatch`, where `<id>` is `encodeURIComponent(formatScheduleId(orgId, userId, key))`. The endpoint fires each scheduled time at most once across retries, restarts and hosts that share a SQLite or Postgres store. See [At most once per scheduled time](../server/scheduled.md#at-most-once-per-scheduled-time).

To fire every user's schedules from one polling tick, give `hireWorkforce` a [schedule index](../server/schedule-index.md). Every saved schedule is mirrored into it:

```ts
const flows = hireWorkforce(installation, { schedules: { index: scheduleIndex } });
```

Without one, your scheduler POSTs each schedule's endpoint itself.

A fire files each time, even while last week's task is still open. A fire whose filing is refused files nothing, and isn't retried: a `filer` that isn't on the user's roster, an `assignee` that is the filer itself or isn't among its delegates, no `assignee` when the filer has more than one delegate, or a filer whose flow keeps no board. The fire's request on the roster flow fails, naming why. A schedule can't skip or reshape a week's work; to change it, save the schedule again.

## After upgrading

Boards written by an earlier version can hold endings their conversation hasn't heard yet, and a [split task](#splitting-a-task) whose pieces have all ended but which hasn't completed. Run `backfillBoardWakes` once when your host starts, after its stores are open. Each conversation that holds such a debt is then paid within seconds, without anyone touching it:

```ts
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import { backfillBoardWakes } from "@flow-state-dev/workforce";

const runtime = await flowState.getRuntime();
const woken = await backfillBoardWakes(runtime.stores, {
  userCell: (userId, orgId) => resolveUserStorageKey(userId, orgId, { id: "", isolateUserState: false }),
});
```

`userCell` maps a user and an org to the storage key of that user's state, where conversation boards keep their rows. Those rows sit in the user's shared state even on a flow that sets `isolateUserState`, so pass `isolateUserState: false` as shown; a flow-isolated key, `{ id: flowId, isolateUserState: true }`, points somewhere else and finds nothing.

It returns how many sessions it woke, and `0` on a store that keeps no wakes. Running it again is safe. A Shift Manager Lab runs it for you when it starts.

A split task stored by an earlier version reads as `in_progress` with `keptOpenBy: "filed"`. It settles like any split task: after the worker's turn on its last piece's ending, once nothing else keeps it open.

## Related pages

- [Coordinators](./coordinators.md): a worker that hands each message to its delegates as routed tasks.
- [Messaging other workers](./messaging-workers.md): asking another worker something without filing a task.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, worker flows and `hireWorkforce`.
- [Task board](../orchestration/task-board.md): the board and the task tools underneath.
