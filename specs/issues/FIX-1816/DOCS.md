# FIX-1816 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic owns the shared opening ([FIX-1815 DOCS.md](../../epics/FIX-1815/DOCS.md)); this issue
publishes it, with the names and limits below. Prose is proposed reader-facing text.

## UPDATE · `apps/docs/docs/server/background-work.md` · new section after "Starting a job on another flow"

> ### Waiting for the answer
>
> A dispatch returns before the work it started has run. That is right for a job that outlives
> the turn, and wrong when the next step needs the result. For that case, a worker asks instead
> of filing.
>
> An ask files the work as a task on the worker's own task board, the same way `addTask` does,
> then parks the turn on it. When the task ends, the turn picks up where it stopped, with the
> task's output as the tool's result. Nothing holds the request open in between, so a server
> restart while the turn waits loses nothing: the turn resumes after the restart, and the task
> was filed once.
>
> Every ask has a time limit, ten minutes unless the call sets one, up to twenty-four hours. Asks
> also count toward the board chain's depth limit of five. If two workers ask each other, both
> get a timeout error instead of waiting forever. Cancelling the turn that asked cancels the
> task it is waiting on.
>
> Each answer replays the asking turn once, so an ask costs one extra replay. Use one when the
> answer changes what this turn says or does next. When it doesn't, file the task and let the
> turn end.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · new subsection after "Which run is working a task"

> ### Asking, and waiting for the answer
>
> A worker that holds the task tools also gets `askTask` when the server has durable execution.
> It files a task exactly as `addTask` does, then parks the worker's turn until the task ends,
> and returns the task's output as the tool's result.
>
> | Input | |
> |---|---|
> | `goal`, `assignee` | As for `addTask`. An assignee `addTask` would refuse is refused the same way, and nothing parks |
> | `timeoutMs` | Optional. Default 600000 (ten minutes), at most 86400000 (a day) |
>
> | Error | When |
> |---|---|
> | `ask_timed_out` | The task did not end in time. It is cancelled |
> | `ask_task_failed` | The task failed for good |
> | `ask_task_cancelled` | The task was cancelled, or the turn that asked was |
>
> An asked task is an ordinary row: `listTasks` shows it, marked `asked`, and the board's limits
> and the chain's depth limit apply to it. If the turn that asked is itself working a task, that
> task parks until the answer comes back, and its filer is not told about the park. There is no
> `askTask_<board>` action: an app files with `addTask_<board>`.

## UPDATE · `packages/orchestration/README.md` · task tools

> `askTask` files a task and parks the calling turn until it ends, then returns the task's
> output. It needs a durability provider. See the task board page for limits and errors.

## UPDATE · `packages/testing/README.md` · new section "Testing a worker that asks"

> A worker that calls `askTask` parks until its colleague answers. In a unit test, answer the ask
> yourself instead of running the colleague:
>
> ```ts
> const run = await testFlow(flow).send("chat", { message: "Is ACME's SOC 2 current?" })
> await run.answerAsk({ assignee: "researcher", output: "Yes, renewed 2026-08." })
> expect(await run.output()).toContain("renewed 2026-08")
> ```
>
> To prove the ask survives a restart, run it on the SQLite store and open a fresh store
> registry on the same file between the park and the answer.

The helper's final name is the implementer's; the example is reconciled against it before
publishing.

## Not changed

The "Which session a task runs in" section is FIX-1817's. The delegation guide that FIX-1814
removes is not restored.
