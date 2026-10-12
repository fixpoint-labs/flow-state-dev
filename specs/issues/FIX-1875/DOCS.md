# FIX-1875 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story ("Giving another worker work") is the epic's
[DOCS.md](../../epics/FIX-1870/DOCS.md); this issue publishes it with its names fixed, plus the
specifics below. Unchanged pages are not copied. P1 publishes the `dispatchTask` material; P2 the
"records, doesn't start" lines and every removal.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · replaces "Asking, and waiting for the answer"

> ### Giving another worker work
>
> `addTask` and `assignTask` record work and who owns it. They don't start it. When you want
> another worker to start now, dispatch the task:
>
> ```ts
> dispatchTask({ goal: "Draft the release note", assignee: "writer" })
> ```
>
> The work starts at once, and the call returns the task's id without waiting for it. When the
> task ends, you hear about it the same way you hear about any task you filed. To start a task
> you recorded earlier, name it instead of describing a new one:
>
> ```ts
> dispatchTask({ taskId: "task_8f2" })
> ```
>
> If your next step needs the result, wait for it:
>
> ```ts
> dispatchTask({ goal: "Which region is the outage in?", assignee: "ops", wait: true })
> ```
>
> Your turn pauses until the task ends, then carries on with the task's output as the tool's
> result, `{ ok: true, taskId, answer }`. Nothing holds a request open while it waits, so a server
> restart loses nothing. A wait has a time limit, five minutes unless you set `timeoutMs` between
> 30 000 (30 seconds) and 3 600 000 (an hour). When it runs out, the task is cancelled. A worker
> you're waiting on can't stop to ask you a question; it answers with what it has, or fails.
>
> Only wait when the result changes what you do next. Otherwise let the task run and carry on.
>
> `dispatchTask` is on a board that can start work at once, such as a conversation's board in
> Workforce. A board that a drain runs decides for itself when each task runs, so it has no
> `dispatchTask`. Waiting needs more: a board that wakes a waiting turn, and a server with
> durable execution and the
> [durability sweeper](/docs/advanced/durable-execution#retention-and-cleanup). Where it can't
> wait, `wait` isn't offered.
>
> | Input | |
> |---|---|
> | `goal`, `assignee`, `deps`, `priority`, `input`, `metadata`, `followUpOf` | A new task, exactly as for `addTask`, and refused the same way |
> | `taskId` | A task you recorded earlier on this board, instead of a new one. It must not have started |
> | `wait` | `true` to wait for the result |
> | `timeoutMs` | How long to wait: 30 000 to 3 600 000, five minutes by default. Only with `wait` |
>
> | Error | When |
> |---|---|
> | `assignee_required` | No `assignee`, and the conversation has more than one delegate to choose from. Nothing is filed |
> | `wait_timed_out` | The task didn't end in time. It is cancelled |
> | `wait_timeout_out_of_range` | `timeoutMs` is under 30 seconds or over an hour. Nothing is filed; the value is never clamped |
> | `wait_timeout_without_wait` | `timeoutMs` without `wait`. Nothing is filed |
> | `wait_task_failed` · `wait_task_cancelled` | The task failed for good, or someone else cancelled it |
> | `wait_already_pending` | This step already waits on a task. One wait per step |
> | `wait_unavailable` | The turn is itself working a task, so it can't wait. Nothing is filed |
>
> Stopping a conversation while its turn waits ends the turn and cancels the task. A task you
> wait on is an ordinary row: `listTasks` shows it, and the board's limits apply. The
> `dispatchTask_<board>` action starts work and never waits.
>
> **Moving from `waitForResponse`.** `addTask` no longer waits. Send the same fields to
> `dispatchTask`, with `wait` in place of `waitForResponse`. `addTask` refuses the old fields and
> says so, rather than filing a task that nobody waits for.

## UPDATE · `apps/docs/docs/server/background-work.md` · "Waiting for the answer", second and fourth paragraphs

> A worker dispatches the task and waits for it: `dispatchTask` with `wait: true`. The task lands
> on the board the worker's task tools write to (in Workforce, the conversation's own board),
> and the turn parks on it. …
>
> … A worker that is itself working a task can't wait: `dispatchTask` with `wait` is refused there
> with `wait_unavailable`, and nothing is filed.

The link at the end points at `task-board#giving-another-worker-work`. The rest of the section
stands.

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · "Handing out tasks" and "Managing tasks"

> `addTask_tasks` records a task and answers `{ ok: true, taskId, status: "recorded" }`. It doesn't start it. To have
> the delegate start now, send `dispatchTask_tasks` with the same fields, or with the `taskId` of a
> task you recorded. A dispatched task runs in a new session of its own, its **task session**, …

> | `assignTask_tasks` | Gives a task nobody is working on to another delegate. It keeps its id. A recorded task stays recorded until `dispatchTask_tasks` |
> | `dispatchTask_tasks` | Starts a new task, or one you recorded, on a delegate now |

The coordinator's `handOff` and the delivery ledger on this page are FIX-1872's.

## UPDATE · `apps/docs/docs/workforce/delegating-work.md` · the task tools sentence

> … the worker gets the [task board](../orchestration/task-board.md)'s task tools in that session:
> `dispatchTask`, which starts work on a delegate now, and `addTask`, `assignTask`, `completeTask`,
> `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks` and `answerTask`, which keep the
> board. Your app can send the same tools as actions, named for the board: `dispatchTask_tasks`,
> `addTask_tasks` and so on.

## UPDATE · `packages/orchestration/README.md` · the `waitForResponse` paragraph and the two functions under it

> `dispatchTask` starts work now, on a board whose owner passes a way to start a row
> (`TaskToolsOptions`). It takes `addTask`'s fields, or `taskId` for a recorded row, and `wait`
> to park the turn until the task ends. `wait` and `timeoutMs` are in the schema only on a board
> that resumes waits and a host that can hold one (`resumesAsks`, `canHoldWait`). On such a board
> `addTask` and `assignTask` record rows that wait for a dispatch.
>
> - `dispatchAndWait(ctx, collection, init, { timeoutMs? })`, from
>   `@flow-state-dev/orchestration/task-board`, files `init` and waits for its answer from
>   inside a generator's tool call. It refuses a host that can't bound the wait
>   (`canHoldWait(ctx)` is false), an out-of-range `timeoutMs`, a task turn and a second wait in
>   one step. Bounds: `MIN_WAIT_TIMEOUT_MS`, `MAX_WAIT_TIMEOUT_MS`, `DEFAULT_WAIT_TIMEOUT_MS`.

`resumeOwedAsks` keeps its paragraph; FIX-1876 renames it.

## UPDATE · `packages/workforce/README.md` · the coordinator's task board paragraph

> `addTask` records a task; `dispatchTask` starts it in its task session, which belongs to you.
> Find it with `findWorkerSession({ worker, taskId, filingSessionId })`.

## UPDATE · `packages/core/README.md` (the ask gate, around `parkOnAsk`) and `packages/engine/README.md` ("Stopping a suspended request")

Names only, from the [rename map](PLAN.md#pinned-names): `canHoldAsk` → `canHoldWait`,
`AskEndedError` → `WaitEndedError`, `AskStoppedError` → `WaitStoppedError`. The prose around
them, and `parkOnAsk` itself, stay until FIX-1876.

## Changesets

`@flow-state-dev/orchestration`, `@flow-state-dev/workforce`, `@flow-state-dev/core`, `minor`:
the rename map in [PLAN.md](PLAN.md#pinned-names), and one line for app authors: *a task filed
through `addTask_tasks` on a conversation's board no longer starts; send `dispatchTask_tasks`.*

## Ownership

| Material | Publisher |
|---|---|
| Everything above | FIX-1875 |
| The glossary rows, and "ask" or "hand-off" used for delivering work anywhere else | FIX-1876 |
| The coordinator's `handOff` and the ledger on `coordinators.md` and `packages/workforce/README.md` | FIX-1872 |
