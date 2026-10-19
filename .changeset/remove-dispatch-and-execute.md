---
"@flow-state-dev/orchestration": minor
---

Removed `dispatchAndExecuteBlock` and `taskLoopBack`, a second claim-and-run loop that nothing outside its own tests used. `taskBoard()` is the claim loop. Removed exports: `dispatchAndExecuteBlock`, `DispatchAndExecuteOptions`, `DispatchAndExecuteResult`, `taskLoopBack`, `defaultTaskLoopUntil`, `DEFAULT_TASK_LOOP_MAX_ITERATIONS`, `TaskLoopBackOptions`, `TaskLoopBackHandle`. If you drove `dispatchAndExecuteBlock` in a sequencer `loopBack`, use `taskBoard({ workers, collection }).drain` instead.
