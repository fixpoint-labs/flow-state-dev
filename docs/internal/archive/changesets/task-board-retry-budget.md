---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": minor
---

Task boards can now bound cumulative retries with `maxTotalRetries`.

`maxTotalTasks` and `maxEnqueuedTasks` count only tasks a board *creates*. A retry re-runs a task that already exists, so a task looping on a permissive `maxAttempts` kept spending model calls while both counts held still. `maxTotalRetries` counts failure retries across the whole board; at the bound the next failing task settles terminal `errored` with an error naming the budget, and the board's completion item reports `terminationReason: "retry-budget-exhausted"` alongside `counts.retries` and the limit in force.

Available on `taskBoard`, `getOrCreateTaskCollection`'s sequencer/request backings, and the `supervisor`, `planAndExecute`, and `parallelTasks` patterns. `0` is legal and means "run every task once, never retry"; `null` opts out.

**The default is `50`, and it is a behaviour change.** It is roughly twenty times tighter than the implicit bound it replaces (`maxTotalTasks × maxAttempts`, about 1000 at the defaults), and it will bind large boards under ordinary flakiness — a 25-task board where every task fails twice spends exactly 50. `supervisor` is affected out of the box, since its `maxAttemptsPerTask` defaults to 3. A board that legitimately needs more will start settling tasks terminally with no call-site change: raise `maxTotalRetries`, or pass `null`.

New public `Task.retryLedger` field (`{ granted, deniedByBudget }`) records what each task was authorized and whether the budget refused it. Read it with `task.retryLedger?.granted ?? 0` — it is absent on tasks that have never failed and on records stored before this release, and counting begins at upgrade rather than being reconstructed from `attempts`.

`TaskCollectionRef` gains a required readonly `maxTotalRetries: number | null` reporting the budget that ref enforces, so a supplied collection reports its real limit instead of a confident `null`. Custom `TaskCollectionRef` implementations must add it; return `null` if you enforce no budget.

Retries are counted but **not** enforced on the durable (resource-backed) backing, which reports `maxTotalRetries: null` so a non-zero count is never mistaken for an applied budget. Enforcement there is tracked as follow-up work.

The `== null` guard on `Task.retryLedger` is transitional. It can collapse to a plain read once no task records predating this release can still be in flight — bounded by request/ledger lifetime on the sequencer and request backings, and by whatever durable records exist on the resource backing.
