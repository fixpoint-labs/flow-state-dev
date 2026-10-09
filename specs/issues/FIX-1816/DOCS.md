# FIX-1816 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic owns the shared opening ([FIX-1815 DOCS.md](../../epics/FIX-1815/DOCS.md)); this issue
publishes it, with the names and limits below. Prose is proposed reader-facing text.

"A worker that is itself working a task" and `wait_unavailable` below put FIX-1817 S1's
single test, a turn the gate serves, in reader terms (BR-5a). They define nothing of their own;
reconcile the wording to that test as shipped.

## UPDATE · `apps/docs/docs/server/background-work.md` · new section after "Starting a job on another flow"

> ### Waiting for the answer
>
> A dispatch returns before the work it started has run. That is right for a job that outlives
> the turn, and wrong when the next step needs the result. For that case, a worker files the task
> and waits for it.
>
> A waiting `addTask` files the work on the worker's own task board as usual, then parks the
> turn on it. When the task ends, the turn picks up where it stopped, with the
> task's output as the tool's result. Nothing holds the request open in between, so a server
> restart while the turn waits loses nothing: the turn resumes after the restart, and the task
> was filed once.
>
> Every ask has a time limit: five minutes unless the worker sets its own, anywhere from 30
> seconds to an hour. If the task hasn't ended by then, the turn gets a timeout error at the next
> background sweep, and the task is cancelled. On a long-lived server the sweep wakes for the
> earliest deadline, so the error arrives within seconds of the limit. Where the sweep runs as an
> external cron job, as on a serverless host, a timeout fires no later than the next run, so a
> `timeoutMs` shorter than the cron's cadence can't fire sooner than that. Choose the limit with
> your host's sweep in mind: on a long-lived server it fires at the deadline.
> Stopping the conversation while it waits cancels the task and ends the turn. A worker that is itself
> working a task can't wait; it files without waiting, so asks never nest.
>
> Each answer replays the asking turn once, so an ask costs one extra replay. Use one when the
> answer changes what this turn says or does next. When it doesn't, file the task and let the
> turn end.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · new subsection after "Which run is working a task"

> ### Asking, and waiting for the answer
>
> When the server has durable execution and runs the durability sweeper, `addTask` takes a
> `waitForResponse` option. Set it and the task is filed as usual, then the worker's turn parks
> until the task ends, and the tool returns the task's output as its result. One wait per step:
> a second waiting `addTask` in the same step is refused.
>
> | Input | |
> |---|---|
> | `waitForResponse` | `true` to wait for the answer. Everything else is as for `addTask`, and an assignee it would refuse is refused the same way, with nothing parked |
> | `timeoutMs` | How long to wait, from 30 000 (30 seconds) to 3 600 000 (an hour). Defaults to five minutes. Only with `waitForResponse`. Fires at the deadline on a long-lived server; where the sweep is an external cron, not sooner than its next run |
>
> | Error | When |
> |---|---|
> | `wait_timed_out` | The task did not end within its time limit. It is cancelled |
> | `wait_timeout_out_of_range` | `timeoutMs` is under 30 seconds or over an hour. Nothing is filed |
> | `wait_task_failed` | The task failed for good |
> | `wait_task_cancelled` | The task was cancelled by someone else |
> | `wait_already_pending` | This step is already waiting on a task. Nothing is filed |
> | `wait_unavailable` | The turn is itself working a task, so it can't wait. Nothing is filed |
>
> Stopping the conversation while its turn waits ends the turn and cancels the task; the turn
> doesn't see an error, because it doesn't run again.
>
> An asked task is an ordinary row: `listTasks` shows it, marked `asked`, and the board's limits
> and the chain's depth limit apply to it. The `addTask_<board>` action has no wait option.

## UPDATE · `packages/orchestration/README.md` · task tools

> `addTask` with `waitForResponse: true` files a task and parks the calling turn until it ends,
> then returns the task's output. It needs a durability provider and a running durability sweeper. See the task board page for limits and errors.

## UPDATE · `apps/docs/docs/advanced/durable-execution.md` · new subsection after "Resuming a suspended request" (P2c)

> ### Stopping a suspended request
>
> The abort endpoint stops a suspended request as well as a running one. The request ends
> `aborted` and its pending suspension is closed, so a resume that arrives later gets a `409`,
> as it would for any suspension already resolved.
>
> A stop and a resume can race. Whichever reaches the suspension first wins. If the resume
> won, the request is running again and the stop answers `409`; stop it again to stop the
> running request.
>
> A request parked on an ask (see [the task board](/docs/orchestration/task-board)) also
> cancels the task it was waiting on. A run that has already started on that task is not
> interrupted; its result is discarded.

## UPDATE · `packages/engine/README.md` · request abort (P2c)

> `POST …/requests/:requestId/abort` stops a running or a suspended request. A suspended one
> ends `aborted` at once; its pending suspension is closed.

## UPDATE · `apps/docs/docs/server/connection-resilience.md` · the abort endpoint's answers (P2c)

> It returns `404` when no request exists under that id, and `409` when the request has already
> finished. A suspended request is stopped: it ends `aborted` at once, and the call returns `204`.

## UPDATE · `packages/client/README.md` · `client.abortRequest` (P2c)

> `client.abortRequest(requestId)` — Ask the server to stop a request that is running or
> suspended. A suspended request ends `aborted` at once.

## UPDATE · `docs/architecture/execution-and-errors.md` · cancellation (P2c, internal)

Add a fourth path to the `registered` list: a stop of a **suspended** request goes through
`recordRequestStop` too, but there is no controller to fire. It resolves the pending gate as
`stopped` under the gate's fence and ends the request `aborted`; on an ask gate it continues the
request only to the parked call, which cancels its row. The durability sweep re-drives a request
left `suspended` or `interrupted` behind a resolved ask gate, whatever its outcome, or behind any
gate resolved `stopped`.

## Not changed

The "Which session a task runs in" section is FIX-1817's. The delegation guide that FIX-1814
removes is not restored.
