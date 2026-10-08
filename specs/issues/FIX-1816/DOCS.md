# FIX-1816 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic owns the shared opening ([FIX-1815 DOCS.md](../../epics/FIX-1815/DOCS.md)); this issue
publishes it, with the names and limits below. Prose is proposed reader-facing text.

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
> Every ask has a ten-minute limit. If the task hasn't ended by then, the turn gets a timeout
> error at the next background sweep, so within twenty minutes, and the task is cancelled.
> Cancelling the turn that asked cancels the task it is waiting on. A worker that is itself
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
>
> | Error | When |
> |---|---|
> | `wait_timed_out` | The task did not end within ten minutes. It is cancelled |
> | `wait_task_failed` | The task failed for good |
> | `wait_task_cancelled` | The task was cancelled, or the turn that asked was |
> | `wait_already_pending` | This step is already waiting on a task. Nothing is filed |
> | `wait_unavailable` | The turn is itself working a task, so it can't wait. Nothing is filed |
>
> An asked task is an ordinary row: `listTasks` shows it, marked `asked`, and the board's limits
> and the chain's depth limit apply to it. The `addTask_<board>` action has no wait option.

## UPDATE · `packages/orchestration/README.md` · task tools

> `addTask` with `waitForResponse: true` files a task and parks the calling turn until it ends,
> then returns the task's output. It needs a durability provider and a running durability sweeper. See the task board page for limits and errors.

## Not changed

The "Which session a task runs in" section is FIX-1817's. The delegation guide that FIX-1814
removes is not restored.
